using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace SpotiKit.Services;

public class MacBundleSigner
{
    private const string LibraryValidation = "com.apple.security.cs.disable-library-validation";

    public virtual void SignAndVerify(string bundle)
    {
        MacBundleFiles.RequireMacOS();
        bundle = MacBundleFiles.RequireBundle(bundle);
        if (!MacBundleFiles.IsComplete(bundle))
            throw new InvalidOperationException("Signing needs a complete Spotify app, including its Chromium framework.");

        var displayed = MacBundleFiles.Run("/usr/bin/codesign", "-d", "--entitlements", "-", "--xml", bundle);
        if (displayed.ExitCode != 0 && !displayed.Error.Contains("not signed at all", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Spotify's existing signing entitlements could not be read: " + displayed.Error.Trim());
        var entitlements = WithLibraryValidationException(displayed.Output);
        var temporary = Path.Combine(Path.GetTempPath(), "spotikit-signing-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temporary);
        try
        {
            var file = Path.Combine(temporary, "entitlements.plist");
            File.WriteAllText(file, entitlements, new UTF8Encoding(false));
            // Apple's entitlement parser is stricter than a general XML reader.
            // Normalize empty tags and the plist header using the system serializer.
            MacBundleFiles.Run("/usr/bin/plutil", "-convert", "xml1", file)
                .EnsureSuccess("Spotify's signing entitlements could not be serialized");
            var signed = MacBundleFiles.Run("/usr/bin/codesign", "--force", "--sign", "-",
                "--preserve-metadata=identifier,flags,runtime", "--entitlements", file, bundle);
            signed.EnsureSuccess("Spotify could not be signed locally");
            Verify(bundle);
        }
        finally
        {
            MacBundleFiles.TryDelete(temporary);
        }
    }

    public virtual void Verify(string bundle)
    {
        MacBundleFiles.RequireMacOS();
        bundle = MacBundleFiles.RequireBundle(bundle);
        MacBundleFiles.Run("/usr/bin/codesign", "--verify", "--deep", "--strict", bundle)
            .EnsureSuccess("Spotify's application signature did not verify");
    }

    internal static string WithLibraryValidationException(string xml)
    {
        XDocument document;
        if (string.IsNullOrWhiteSpace(xml))
            document = new XDocument(new XElement("plist", new XAttribute("version", "1.0"), new XElement("dict")));
        else
        {
            using var reader = XmlReader.Create(new StringReader(xml), new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Ignore,
                XmlResolver = null,
            });
            document = XDocument.Load(reader);
        }
        var dictionary = document.Root?.Name.LocalName == "plist" ? document.Root.Element("dict") : null;
        if (dictionary is null)
            throw new InvalidDataException("Spotify's signing entitlements are not a property-list dictionary.");
        var key = dictionary.Elements("key").SingleOrDefault(element => element.Value == LibraryValidation);
        if (key is null)
            dictionary.Add(new XElement("key", LibraryValidation), new XElement("true"));
        else
        {
            var value = key.ElementsAfterSelf().FirstOrDefault()
                ?? throw new InvalidDataException("Spotify's library-validation entitlement has no value.");
            value.ReplaceWith(new XElement("true"));
        }
        return document.ToString(SaveOptions.DisableFormatting);
    }
}

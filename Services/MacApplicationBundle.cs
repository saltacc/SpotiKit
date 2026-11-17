using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Xml;
using System.Xml.Linq;

namespace SpotiKit.Services;

internal static class MacApplicationBundle
{
    public static string? FromResources(string resources)
    {
        var directory = new DirectoryInfo(Path.GetFullPath(resources));
        return directory.Name == "Resources" && directory.Parent is { Name: "Contents", Parent: { } bundle } &&
               bundle.Name.EndsWith(".app", StringComparison.OrdinalIgnoreCase)
            ? bundle.FullName
            : null;
    }

    public static string? ReadVersion(string resources)
    {
        if (FromResources(resources) is not { } bundle)
            return null;

        var plist = Path.Combine(bundle, "Contents", "Info.plist");
        try
        {
            var bytes = File.ReadAllBytes(plist);
            string xml;
            if (bytes.AsSpan().StartsWith("bplist"u8))
            {
                if (!OperatingSystem.IsMacOS())
                    return null;
                var start = new ProcessStartInfo("/usr/bin/plutil")
                {
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                foreach (var argument in new[] { "-convert", "xml1", "-o", "-", plist })
                    start.ArgumentList.Add(argument);
                using var process = Process.Start(start)!;
                var output = process.StandardOutput.ReadToEndAsync();
                var error = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(3000))
                {
                    process.Kill(entireProcessTree: true);
                    return null;
                }
                if (process.ExitCode != 0)
                    return null;
                xml = output.GetAwaiter().GetResult();
                _ = error.GetAwaiter().GetResult();
            }
            else
            {
                using var textReader = new StreamReader(new MemoryStream(bytes), System.Text.Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
                xml = textReader.ReadToEnd();
            }

            using var reader = XmlReader.Create(new StringReader(xml), new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Ignore,
                XmlResolver = null,
            });
            var values = XDocument.Load(reader).Root?.Element("dict")?.Elements().ToArray() ?? [];
            string? Value(string key) => values.Select((element, index) => (element, index))
                .Where(pair => pair.element.Name == "key" && pair.element.Value == key)
                .Select(pair => pair.index + 1 < values.Length && values[pair.index + 1].Name == "string"
                    ? Normalise(values[pair.index + 1].Value) : null).FirstOrDefault();

            var shortVersion = Value("CFBundleShortVersionString");
            var buildVersion = Value("CFBundleVersion");
            // Some bundles put the four-part Spotify version only in CFBundleVersion.
            return buildVersion is not null && shortVersion is not null && buildVersion.StartsWith(shortVersion + ".", StringComparison.Ordinal)
                ? buildVersion : shortVersion ?? buildVersion;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or XmlException or Win32Exception or InvalidOperationException)
        {
            return null;
        }
    }

    private static string? Normalise(string raw)
    {
        var parts = raw.Trim().Split('.').TakeWhile(part => part.Length > 0 && part.All(char.IsDigit)).ToArray();
        return parts.Length >= 2 ? string.Join('.', parts) : null;
    }
}

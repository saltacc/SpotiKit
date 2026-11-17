using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using SpotiKit.Models;

namespace SpotiKit.Services;

public static partial class XpuiPatcher
{
    public const string IndexEntry = "index.html";
    public const string LoaderEntry = "spotikit/loader.js";

    private const string BodyClose = "</body>";

    [GeneratedRegex(@"<!-- spotikit:begin v=(?<v>[^ ]+) -->.*?<!-- spotikit:end -->", RegexOptions.Singleline)]
    private static partial Regex MarkerBlock();

    public static string BuildMarker(string version, bool withClassMap = false, bool withConfig = false) =>
        $"<!-- spotikit:begin v={version} -->" +
        (withClassMap ? $"<script defer=\"defer\" src=\"/{ClassMapScriptEntry}\"></script>" : "") +
        (withConfig ? $"<script defer=\"defer\" src=\"/{ConfigScriptEntry}\"></script>" : "") +
        $"<script defer=\"defer\" src=\"/{LoaderEntry}\"></script><!-- spotikit:end -->";

    public static XpuiInspection Inspect(string spaPath)
    {
        try
        {
            using var stream = new FileStream(spaPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var zip = new ZipArchive(stream, ZipArchiveMode.Read);

            var index = zip.GetEntry(IndexEntry);
            var html = index is null ? null : ReadText(index).Text;
            var marker = html is null ? null : MarkerBlock().Match(html);

            var foreignMods = new List<string>();
            if (zip.Entries.Any(e => !e.FullName.StartsWith("spotikit/", StringComparison.Ordinal) &&
                                     e.FullName.Contains("spicetify", StringComparison.OrdinalIgnoreCase)) ||
                html?.Contains("spicetify", StringComparison.OrdinalIgnoreCase) == true)
                foreignMods.Add("Spicetify");
            if (html?.Contains("spotx", StringComparison.OrdinalIgnoreCase) == true)
                foreignMods.Add("SpotX");

            return new XpuiInspection(
                IsReadable: true,
                HasIndex: index is not null,
                HasBodyAnchor: html?.Contains(BodyClose, StringComparison.OrdinalIgnoreCase) == true,
                HasSpotiKit: marker?.Success == true,
                SpotiKitVersion: marker?.Success == true ? marker.Groups["v"].Value : null,
                HasLoaderFile: zip.GetEntry(LoaderEntry) is not null,
                ForeignMods: foreignMods,
                EntryCount: zip.Entries.Count)
            {
                HasClassMap = zip.GetEntry(ClassMapManifestEntry) is not null,
            };
        }
        catch (InvalidDataException)
        {
            return XpuiInspection.Unreadable("The file is damaged or is not a valid archive.");
        }
        catch (FileNotFoundException)
        {
            return XpuiInspection.Unreadable("The file does not exist.");
        }
        catch (UnauthorizedAccessException)
        {
            return XpuiInspection.Unreadable("Read access to the file was denied.");
        }
        catch (IOException ex)
        {
            return XpuiInspection.Unreadable($"The file could not be read: {ex.Message}");
        }
    }

    public static string? ReadLoader(string spaPath)
    {
        using var zip = ZipFile.OpenRead(spaPath);
        return zip.GetEntry(LoaderEntry) is { } entry ? ReadText(entry).Text : null;
    }

    public static ClassMapResult Inject(string spaPath, string loaderScript, string version,
        IReadOnlyList<ClassMapping>? classMap = null, string? spotifyVersion = null, AddonSet? addons = null,
        ClassMapSelection? selection = null)
    {
        var result = ClassMapResult.None(spotifyVersion ?? "unknown");
        RewriteSafely(spaPath, zip =>
        {
            var index = zip.GetEntry(IndexEntry) ?? throw new InvalidDataException("index.html is missing from xpui.spa.");
            var (html, hasBom) = ReadText(index);
            html = MarkerBlock().Replace(html, string.Empty);

            var at = html.LastIndexOf(BodyClose, StringComparison.OrdinalIgnoreCase);
            if (at < 0)
                throw new InvalidDataException("index.html has no closing body tag to attach the loader to.");

            RevertClassMap(zip);
            if (classMap is { Count: > 0 })
                result = ApplyClassMap(zip, spotifyVersion ?? "unknown", classMap, selection);

            if (addons is not null)
                WriteAddons(zip, addons);
            else
                RemoveAddons(zip);

            WriteText(zip, IndexEntry, html.Insert(at, BuildMarker(version,
                result.Applied.Count > 0 || result.ProfileId is not null, addons is not null)), hasBom);
            WriteText(zip, LoaderEntry, loaderScript, hasBom: false);
        },
        check => check.HasSpotiKit && check.HasLoaderFile && check.SpotiKitVersion == version &&
                 check.HasClassMap == (result.Applied.Count > 0 || result.ProfileId is not null),
        "The patched copy did not contain the loader, so the original was left untouched.");
        return result;
    }

    public static void Remove(string spaPath)
    {
        RewriteSafely(spaPath, zip =>
        {
            if (zip.GetEntry(IndexEntry) is { } index)
            {
                var (html, hasBom) = ReadText(index);
                var cleaned = MarkerBlock().Replace(html, string.Empty);
                if (cleaned != html)
                    WriteText(zip, IndexEntry, cleaned, hasBom);
            }

            RevertClassMap(zip);
            RemoveAddons(zip);
            zip.GetEntry(LoaderEntry)?.Delete();
        },
        check => !check.HasSpotiKit && !check.HasLoaderFile && !check.HasClassMap,
        "SpotiKit was still present in the cleaned copy, so the original was left untouched.");
    }

    public static IReadOnlyList<string> DifferingEntries(string spaA, string spaB)
    {
        static Dictionary<string, string> Hashes(string path)
        {
            using var zip = ZipFile.OpenRead(path);
            var hashes = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var entry in zip.Entries.Where(e => !e.FullName.EndsWith('/')))
            {
                using var stream = entry.Open();
                hashes[entry.FullName] = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(stream));
            }

            return hashes;
        }

        var a = Hashes(spaA);
        var b = Hashes(spaB);
        return a.Keys.Union(b.Keys)
            .Where(name => !a.TryGetValue(name, out var ha) || !b.TryGetValue(name, out var hb) || ha != hb)
            .Order(StringComparer.Ordinal)
            .ToList();
    }

    private static void RewriteSafely(string spaPath, Action<ZipArchive> edit, Func<XpuiInspection, bool> isValid,
        string invalidMessage)
    {
        var workingCopy = spaPath + ".spotikit-tmp";
        File.Copy(spaPath, workingCopy, overwrite: true);
        try
        {
            using (var zip = ZipFile.Open(workingCopy, ZipArchiveMode.Update))
                edit(zip);

            var check = Inspect(workingCopy);
            if (!check.IsReadable || !check.HasIndex)
                throw new InvalidDataException("The rewritten archive could not be read back, so the original was left untouched.");
            if (!isValid(check))
                throw new InvalidDataException(invalidMessage);

            File.Move(workingCopy, spaPath, overwrite: true);
        }
        finally
        {
            if (File.Exists(workingCopy))
                File.Delete(workingCopy);
        }
    }

    private static (string Text, bool HasBom) ReadText(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        var bytes = buffer.ToArray();
        var hasBom = bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;
        return (Encoding.UTF8.GetString(bytes, hasBom ? 3 : 0, bytes.Length - (hasBom ? 3 : 0)), hasBom);
    }

    private static void WriteText(ZipArchive zip, string name, string text, bool hasBom)
    {
        var lastWrite = zip.GetEntry(name)?.LastWriteTime ?? DateTimeOffset.Now;
        zip.GetEntry(name)?.Delete();

        var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
        entry.LastWriteTime = lastWrite;
        using var stream = entry.Open();
        if (hasBom)
            stream.Write([0xEF, 0xBB, 0xBF]);
        var bytes = new UTF8Encoding(false).GetBytes(text);
        stream.Write(bytes);
    }
}

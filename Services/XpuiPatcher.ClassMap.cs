using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace SpotiKit.Services;

public sealed record AppliedClassFile(string Entry, int Count);

public sealed record AppliedClassMapping(string Generated, string Stable, IReadOnlyList<AppliedClassFile> Files)
{
    public int Total => Files.Sum(f => f.Count);
}

public sealed record SkippedClassMapping(string Generated, string Stable, string Reason);

public sealed record ClassMapResult(string SpotifyVersion, IReadOnlyList<AppliedClassMapping> Applied, IReadOnlyList<SkippedClassMapping> Skipped)
{
    public static ClassMapResult None(string spotifyVersion) => new(spotifyVersion, [], []);
}

public static partial class XpuiPatcher
{
    public const string ClassMapManifestEntry = "spotikit/class-map.json";
    public const string ClassMapScriptEntry = "spotikit/class-map.js";

    [GeneratedRegex(@"\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)")]
    private static partial Regex ClassToken();

    private static IEnumerable<ZipArchiveEntry> Stylesheets(ZipArchive zip) =>
        zip.Entries
            .Where(e => e.FullName.EndsWith(".css", StringComparison.OrdinalIgnoreCase) &&
                        !e.FullName.StartsWith("spotikit/", StringComparison.Ordinal))
            .ToList();

    private static string Rename(string text, IReadOnlyDictionary<string, string> from, Dictionary<string, int> counts) =>
        ClassToken().Replace(text, m =>
        {
            if (!from.TryGetValue(m.Groups[1].Value, out var to))
                return m.Value;
            counts[m.Groups[1].Value] = counts.GetValueOrDefault(m.Groups[1].Value) + 1;
            return "." + to;
        });

    private static ClassMapResult ApplyClassMap(ZipArchive zip, string spotifyVersion, IReadOnlyList<ClassMapping> mappings)
    {
        var sheets = Stylesheets(zip).ToDictionary(e => e.FullName, ReadText, StringComparer.Ordinal);
        var present = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (text, _) in sheets.Values)
            foreach (Match m in ClassToken().Matches(text))
                present.Add(m.Groups[1].Value);

        var skipped = new List<SkippedClassMapping>();
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        var stableNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (var mapping in mappings)
        {
            var reason = present.Contains(mapping.Stable) ? $"{mapping.Stable} already exists in Spotify's styles."
                : !mapping.RuntimeOnly && !present.Contains(mapping.Generated) ? $"{mapping.Generated} was not found in this client's styles."
                : mapping.RuntimeOnly && present.Contains(mapping.Generated) ? $"{mapping.Generated} is in the styles, but the map says it has no rules."
                : map.ContainsKey(mapping.Generated) || !stableNames.Add(mapping.Stable) ? "Listed twice in the class map."
                : null;
            if (reason is not null)
                skipped.Add(new(mapping.Generated, mapping.Stable, reason));
            else
                map[mapping.Generated] = mapping.Stable;
        }

        if (map.Count == 0)
            return new ClassMapResult(spotifyVersion, [], skipped);

        var files = new Dictionary<string, List<AppliedClassFile>>(StringComparer.Ordinal);
        foreach (var (name, (text, hasBom)) in sheets.OrderBy(s => s.Key, StringComparer.Ordinal))
        {
            var counts = new Dictionary<string, int>(StringComparer.Ordinal);
            var renamed = Rename(text, map, counts);
            if (counts.Count == 0)
                continue;
            WriteText(zip, name, renamed, hasBom);
            foreach (var (generated, count) in counts)
                (files.TryGetValue(generated, out var list) ? list : files[generated] = []).Add(new(name, count));
        }

        var applied = mappings
            .Where(m => map.ContainsKey(m.Generated) && (m.RuntimeOnly || files.ContainsKey(m.Generated)))
            .Select(m => new AppliedClassMapping(m.Generated, m.Stable, files.TryGetValue(m.Generated, out var f) ? f : []))
            .ToList();
        var result = new ClassMapResult(spotifyVersion, applied, skipped);
        WriteText(zip, ClassMapManifestEntry, JsonSerializer.Serialize(result, ClassMapManifestJsonContext.Default.ClassMapResult), hasBom: false);
        WriteText(zip, ClassMapScriptEntry, BuildClassMapScript(result), hasBom: false);
        return result;
    }

    private static void RevertClassMap(ZipArchive zip)
    {
        if (zip.GetEntry(ClassMapManifestEntry) is not { } manifestEntry)
        {
            zip.GetEntry(ClassMapScriptEntry)?.Delete();
            return;
        }

        var manifest = JsonSerializer.Deserialize(ReadText(manifestEntry).Text, ClassMapManifestJsonContext.Default.ClassMapResult)
                       ?? throw new InvalidDataException("SpotiKit's class map record in xpui.spa is empty.");

        var perFile = new Dictionary<string, (Dictionary<string, string> Back, Dictionary<string, int> Expected)>(StringComparer.Ordinal);
        foreach (var mapping in manifest.Applied)
            foreach (var file in mapping.Files)
            {
                if (!perFile.TryGetValue(file.Entry, out var plan))
                    perFile[file.Entry] = plan = (new(StringComparer.Ordinal), new(StringComparer.Ordinal));
                plan.Back[mapping.Stable] = mapping.Generated;
                plan.Expected[mapping.Stable] = file.Count;
            }

        var restored = new List<(string Name, string Text, bool HasBom)>();
        foreach (var (name, (back, expected)) in perFile)
        {
            var entry = zip.GetEntry(name) ?? throw new InvalidDataException($"{name} is missing, so the class map can't be undone exactly.");
            var (text, hasBom) = ReadText(entry);
            var counts = new Dictionary<string, int>(StringComparer.Ordinal);
            var original = Rename(text, back, counts);
            foreach (var (stable, count) in expected)
                if (counts.GetValueOrDefault(stable) != count)
                    throw new InvalidDataException(
                        $"{name} has {counts.GetValueOrDefault(stable)} uses of .{stable}, but SpotiKit made {count}. It was left unchanged.");
            restored.Add((name, original, hasBom));
        }

        foreach (var (name, text, hasBom) in restored)
            WriteText(zip, name, text, hasBom);
        manifestEntry.Delete();
        zip.GetEntry(ClassMapScriptEntry)?.Delete();
    }

    public static ClassMapResult? ReadClassMap(string spaPath)
    {
        using var zip = ZipFile.OpenRead(spaPath);
        return zip.GetEntry(ClassMapManifestEntry) is { } entry
            ? JsonSerializer.Deserialize(ReadText(entry).Text, ClassMapManifestJsonContext.Default.ClassMapResult)
            : null;
    }

    private static string BuildClassMapScript(ClassMapResult result)
    {
        var map = result.Applied.ToDictionary(a => a.Generated, a => a.Stable);
        return $"/* SpotiKit class map for Spotify {result.SpotifyVersion}: {map.Count} classes */\n" +
               $"window.__spotikitClassMap = {JsonSerializer.Serialize(map, ClassMapManifestJsonContext.Default.DictionaryStringString)};\n";
    }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(ClassMapResult))]
[JsonSerializable(typeof(Dictionary<string, string>))]
internal partial class ClassMapManifestJsonContext : JsonSerializerContext;

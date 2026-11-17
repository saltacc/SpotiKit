using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace SpotiKit.Services;

public sealed record ProjectIssue(bool IsError, string File, int? Line, string Message)
{
    public string Text => $"{File}{(Line is { } l ? ":" + l : "")}: {Message}";
}

public sealed record ProjectReport(string Kind, string Name, string Folder, IReadOnlyList<ProjectIssue> Issues, bool Full)
{
    public int Errors => Issues.Count(i => i.IsError);
    public int Warnings => Issues.Count - Errors;
}

public sealed partial class ProjectChecker(KitRunner kit)
{
    private static readonly string[] Kinds = ["theme", "extension", "app", "snippet"];
    private static readonly Dictionary<string, string> DefaultMain = new() { ["extension"] = "extension.js", ["app"] = "index.js" };

    [GeneratedRegex(@"^\d+(\.\d+){0,3}$")]
    private static partial Regex Version();

    [GeneratedRegex(@"\.([A-Za-z0-9_-]{20})(?![A-Za-z0-9_-])")]
    private static partial Regex Hashed();

    [GeneratedRegex("[a-z]{5}")]
    private static partial Regex LowercaseRun();

    public async Task<ProjectReport> CheckAsync(AddonSource source, CancellationToken cancellationToken = default)
    {
        if (!source.IsFolder)
            return new ProjectReport(source.Kind, source.Folder, source.FullPath, [], false);
        if (KitRunner.CanRun(source.FullPath))
        {
            try
            {
                var result = await kit.RunAsync(source.FullPath, ["check", "--json"], TimeSpan.FromMinutes(2), cancellationToken);
                if (result is not null && result.Output.Trim().StartsWith('{'))
                    return FromKit(source, result.Output);
            }
            catch (Exception ex) when (ex is TimeoutException or InvalidOperationException or IOException or System.ComponentModel.Win32Exception)
            {
            }
        }
        return new ProjectReport(source.Kind, NameOf(source), source.FullPath, Check(source.FullPath, source.Kind), false);
    }

    private static string NameOf(AddonSource source)
    {
        try
        {
            using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(source.FullPath, AddonCatalog.ManifestFile)));
            return AddonCatalog.ReadName(json.RootElement) is { Length: > 0 } name ? name : source.Folder;
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            return source.Folder;
        }
    }

    private static ProjectReport FromKit(AddonSource source, string output)
    {
        using var json = JsonDocument.Parse(output.Trim().Split('\n').First(l => l.TrimStart().StartsWith('{')));
        var issues = json.RootElement.GetProperty("issues").EnumerateArray().Select(i => new ProjectIssue(
            i.GetProperty("level").GetString() == "error",
            i.GetProperty("file").GetString() ?? "",
            i.TryGetProperty("line", out var line) && line.ValueKind == JsonValueKind.Number ? line.GetInt32() : null,
            i.GetProperty("message").GetString() ?? "")).ToList();
        return new ProjectReport(source.Kind, NameOf(source), source.FullPath, issues, true);
    }

    public static IReadOnlyList<ProjectIssue> Check(string folder, string? expectedKind = null)
    {
        var issues = new List<ProjectIssue>();
        void Add(bool error, string file, string message, int? line = null) => issues.Add(new ProjectIssue(error, file, line, message));
        var manifestPath = Path.Combine(folder, AddonCatalog.ManifestFile);
        JsonElement root;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(manifestPath));
            root = doc.RootElement.Clone();
        }
        catch (FileNotFoundException)
        {
            Add(true, AddonCatalog.ManifestFile, "is missing");
            return issues;
        }
        catch (JsonException ex)
        {
            Add(true, AddonCatalog.ManifestFile, "isn't valid JSON: " + ex.Message);
            return issues;
        }

        bool Exists(string path) => path.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                                    path.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
                                    File.Exists(Path.Combine(folder, path));
        static List<string> Files(JsonElement e, string key) =>
            !e.TryGetProperty(key, out var v) ? [] :
            v.ValueKind == JsonValueKind.String ? [v.GetString()!] :
            v.ValueKind == JsonValueKind.Array ? v.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList() : [];
        static string? Text(JsonElement e, string key) =>
            e.TryGetProperty(key, out var v) ? v.ValueKind == JsonValueKind.String ? v.GetString() :
                v.ValueKind == JsonValueKind.Object && v.TryGetProperty("en", out var en) ? en.GetString() : null : null;

        var entries = root.ValueKind == JsonValueKind.Array ? root.EnumerateArray().ToList() : [root];
        for (var index = 0; index < entries.Count; index++)
        {
            var entry = entries[index];
            var where = entries.Count > 1 ? $"{AddonCatalog.ManifestFile} (entry {index + 1})" : AddonCatalog.ManifestFile;
            if (entry.ValueKind != JsonValueKind.Object)
            {
                Add(true, where, "every entry has to be an object");
                continue;
            }
            var type = Text(entry, "type");
            if (type is null || !Kinds.Contains(type))
                Add(true, where, "\"type\" has to be one of " + string.Join(", ", Kinds));
            else if (expectedKind is not null && type != expectedKind)
                Add(true, where, $"\"type\" is {type}, but it's in the {expectedKind} folder");
            if (string.IsNullOrWhiteSpace(Text(entry, "name")))
                Add(true, where, "\"name\" is missing; the Marketplace skips entries without one");
            if (string.IsNullOrWhiteSpace(Text(entry, "description")))
                Add(false, where, "\"description\" is empty; the Marketplace skips entries without one");
            if (!entry.TryGetProperty("spotify", out var spotify))
                Add(false, where, "\"spotify\" is missing, so people see \"compatibility not specified\"");
            else if (spotify.ValueKind != JsonValueKind.String ||
                     spotify.GetString()!.Split(" - ").Length > 2 ||
                     !spotify.GetString()!.Split(" - ").All(p => Version().IsMatch(p.Trim())))
                Add(true, where, $"\"spotify\" \"{spotify}\" isn't a version or a range like 1.3.5 - 1.3.6");

            var styles = Files(entry, "style");
            var mains = Files(entry, "main");
            if (type == "snippet")
            {
                if (styles.Count == 0)
                    Add(true, where, "a CSS snippet needs \"style\"");
                if (mains.Count > 0)
                    Add(true, where, "a CSS snippet can't have \"main\"; snippets are CSS only");
            }
            if (type == "theme" && styles.Count == 0)
                Add(true, where, "a theme needs \"style\" with at least one CSS file");
            if (mains.Count == 0 && type is not null && DefaultMain.TryGetValue(type, out var fallback))
                mains.Add(fallback);
            foreach (var f in styles.Where(f => !Exists(f)))
                Add(true, where, $"\"style\" names {f}, which doesn't exist");
            var source = Text(entry, "source");
            if (source is not null)
            {
                if (!Exists(source))
                    Add(true, where, $"\"source\" names {source}, which doesn't exist");
                else if (mains.Count == 0 || !Exists(mains[0]))
                    Add(true, where, $"{(mains.Count > 0 ? mains[0] : "main")} isn't built yet. Live preview and Apply build it with spotikit-kit");
            }
            else
                foreach (var f in mains.Where(f => !Exists(f)))
                    Add(true, where, $"\"main\" names {f}, which doesn't exist");
            var preview = Text(entry, "preview");
            if (preview is null)
                Add(false, where, "no \"preview\" image; the Marketplace card shows no picture");
            else if (!Exists(preview))
                Add(false, where, $"\"preview\" names {preview}, which doesn't exist; the Marketplace card shows no picture");
        }

        foreach (var (relative, path) in AddonCatalog.FilesOf(folder))
        {
            var ext = Path.GetExtension(path).ToLowerInvariant();
            if (ext is not (".css" or ".js" or ".mjs"))
                continue;
            var text = File.ReadAllText(path);
            foreach (Match m in Hashed().Matches(text))
            {
                var token = m.Groups[1].Value;
                var kinds = new[] { token.Any(char.IsLower), token.Any(char.IsUpper), token.Any(char.IsDigit), token.Any(c => c is '_' or '-') }.Count(b => b);
                if (kinds >= 3 && !LowercaseRun().IsMatch(token))
                    Add(false, relative,
                        $"\".{token}\" looks like one of Spotify's generated class names, which change with every update. Use SpotiKit's names instead",
                        text[..m.Index].Count(c => c == '\n') + 1);
            }
        }
        return issues;
    }
}

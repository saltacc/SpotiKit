using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace SpotiKit.Services;

public sealed record AddonFile(string Entry, byte[] Content);

public sealed record AddonInfo(string Id, string Name, string? Folder = null, string? Path = null);

public sealed record AddonSource(string Kind, string Id, string Folder, string FullPath, bool IsFolder)
{
    public string Directory => Kind switch
    {
        "theme" => "themes",
        "app" => "apps",
        "snippet" => "snippets",
        _ => "extensions",
    };
}

public sealed record AddonSet(
    IReadOnlyList<string> Extensions,
    IReadOnlyList<AddonInfo> Apps,
    IReadOnlyList<AddonInfo> Themes,
    IReadOnlyList<AddonFile> Files,
    IReadOnlyList<string> Skipped)
{
    public static AddonSet Empty { get; } = new([], [], [], [], []);

    public IReadOnlyList<AddonInfo> ExtensionInfo { get; init; } = [];

    public IReadOnlyList<AddonInfo> Snippets { get; init; } = [];

    public IReadOnlyList<string> Warnings { get; init; } = [];

    public long TotalBytes => Files.Sum(f => (long)f.Content.Length);
}

public sealed partial class AddonCatalog(SpotiKitPaths paths)
{
    public const string ManifestFile = "spotikit.json";
    public const long MaxFileBytes = 8 * 1024 * 1024;
    public const long MaxTotalBytes = 48 * 1024 * 1024;

    public static readonly HashSet<string> FolderFileTypes = new(StringComparer.OrdinalIgnoreCase)
        { ".js", ".mjs", ".css", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".woff", ".woff2", ".ttf", ".otf", ".txt" };

    [GeneratedRegex(@"[^a-z0-9]+")]
    private static partial Regex NonIdCharacters();

    [GeneratedRegex(@"^[^#%?\\/]+$")]
    private static partial Regex UsableFileName();

    public string ExtensionsDir => paths.ExtensionsDir;
    public string AppsDir => paths.AppsDir;
    public string ThemesDir => paths.ThemesDir;
    public string SnippetsDir => paths.SnippetsDir;

    public static string IdFor(string name)
    {
        var id = NonIdCharacters().Replace(name.ToLowerInvariant(), "-").Trim('-');
        if (id.Length > 40)
            id = id[..40].TrimEnd('-');
        return id.Length > 0 && char.IsDigit(id[0]) ? "x-" + id : id;
    }

    public IReadOnlyList<AddonSource> Sources()
    {
        var sources = new List<AddonSource>();
        void Add(string kind, string dir, bool folders)
        {
            if (!System.IO.Directory.Exists(dir))
                return;
            var taken = new HashSet<string>(StringComparer.Ordinal);
            var entries = folders
                ? System.IO.Directory.EnumerateDirectories(dir).Select(p => (Path: p, Name: Path.GetFileName(p), IsFolder: true))
                : System.IO.Directory.EnumerateFiles(dir, "*.js").Select(p => (Path: p, Name: Path.GetFileNameWithoutExtension(p), IsFolder: false));
            foreach (var entry in entries.OrderBy(e => e.Name, StringComparer.OrdinalIgnoreCase))
            {
                var id = IdFor(entry.Name);
                if (id.Length == 0)
                    id = "addon";
                var unique = id;
                for (var n = 2; !taken.Add(unique); n++)
                    unique = $"{id}-{n}";
                sources.Add(new AddonSource(kind, unique, entry.Name, entry.Path, entry.IsFolder));
            }
        }
        Add("extension", ExtensionsDir, folders: false);
        Add("extension", ExtensionsDir, folders: true);
        Add("app", AppsDir, folders: true);
        Add("theme", ThemesDir, folders: true);
        Add("snippet", SnippetsDir, folders: true);
        return sources;
    }

    public static IEnumerable<(string Relative, string FullPath)> FilesOf(string folder) =>
        System.IO.Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories)
            .Order(StringComparer.OrdinalIgnoreCase)
            .Select(path => (Relative: Path.GetRelativePath(folder, path).Replace('\\', '/'), FullPath: path))
            .Where(f => FolderFileTypes.Contains(Path.GetExtension(f.FullPath)) && !ToolingFiles.Contains(f.Relative) &&
                        f.Relative.Split('/').All(part => UsableFileName().IsMatch(part) && !part.StartsWith('.') && part != "node_modules"));

    private static readonly HashSet<string> ToolingFiles = new(StringComparer.OrdinalIgnoreCase)
        { "jsconfig.json", "tsconfig.json", "package.json", "package-lock.json" };

    private sealed record Manifest(string? Name, string? Main);

    public AddonSet Load(string? spotifyVersion = null)
    {
        var files = new List<AddonFile>();
        var skipped = new List<string>();
        var warnings = new List<string>();
        var extensions = new List<string>();
        var extensionInfo = new List<AddonInfo>();
        var apps = new List<AddonInfo>();
        var themes = new List<AddonInfo>();
        var snippets = new List<AddonInfo>();
        long total = 0;

        bool Take(string entry, byte[] content, string shownName)
        {
            if (content.LongLength > MaxFileBytes)
            {
                skipped.Add($"{shownName} is larger than {MaxFileBytes / 1024 / 1024} MB.");
                return false;
            }
            if (total + content.LongLength > MaxTotalBytes)
            {
                skipped.Add($"{shownName} was left out: your projects may use {MaxTotalBytes / 1024 / 1024} MB in total.");
                return false;
            }
            total += content.LongLength;
            files.Add(new AddonFile(entry, content));
            return true;
        }

        Manifest? TakeFolder(AddonSource source, string? defaultMain)
        {
            var folder = source.FullPath;
            var shown = source.Folder;
            var manifestPath = Path.Combine(folder, ManifestFile);
            if (!File.Exists(manifestPath))
            {
                skipped.Add($"{shown}: needs a {ManifestFile}.");
                return null;
            }

            string? name, main;
            var linked = new List<string>();
            try
            {
                using var json = JsonDocument.Parse(File.ReadAllText(manifestPath));
                var root = json.RootElement;
                if (root.ValueKind == JsonValueKind.Array)
                {
                    skipped.Add($"{shown}: {ManifestFile} lists several projects. Give each one its own folder.");
                    return null;
                }
                if (root.ValueKind != JsonValueKind.Object)
                    throw new JsonException();
                if (Text(root, "type") is { } t && !string.Equals(t, source.Kind, StringComparison.OrdinalIgnoreCase))
                {
                    skipped.Add($"{shown}: {ManifestFile} says \"{t}\", but it is in the {Path.GetFileName(Path.GetDirectoryName(folder))} folder.");
                    return null;
                }
                if (Text(root, "spotify") is { } range)
                {
                    if (!VersionRange.IsValid(range))
                        warnings.Add($"{shown}: \"{range}\" isn't a Spotify version range. Write it like 1.3.5 - 1.3.6.");
                    else if (spotifyVersion is not null && VersionRange.Contains(spotifyVersion, range) is false)
                        warnings.Add($"{shown}: made for Spotify {VersionRange.Describe(range)}, this is {spotifyVersion}. It's loaded anyway.");
                }
                if (Text(root, "version") is { } version && !VersionRange.IsValid(version))
                    warnings.Add($"{shown}: \"{version}\" isn't a version number like 1.2.0.");
                if (root.TryGetProperty("dependencies", out var dependencies) && dependencies.ValueKind == JsonValueKind.Object)
                    foreach (var dependency in dependencies.EnumerateObject())
                        if (dependency.Value.ValueKind == JsonValueKind.String && dependency.Value.GetString() is { Length: > 0 } wanted &&
                            wanted != "*" && !VersionRange.IsValid(wanted))
                            warnings.Add($"{shown}: \"{wanted}\" for {dependency.Name} isn't a version range like 1.0 - 1.4.");
                name = ReadName(root);
                main = source.Kind == "snippet" ? null : Text(root, "main") ?? defaultMain;
                if (source.Kind == "snippet" && !root.TryGetProperty("style", out _))
                {
                    skipped.Add($"{shown}: a snippet needs \"style\" in its {ManifestFile}.");
                    return null;
                }
                if (main is not null)
                    linked.Add(main);
                if (root.TryGetProperty("style", out var style))
                    linked.AddRange(style.ValueKind == JsonValueKind.Array
                        ? style.EnumerateArray().Where(s => s.ValueKind == JsonValueKind.String).Select(s => s.GetString()!)
                        : style.ValueKind == JsonValueKind.String ? [style.GetString()!] : []);
                if (source.Kind == "theme" && Text(root, "schemes") is { } schemes)
                    linked.Add(schemes);
            }
            catch (JsonException)
            {
                skipped.Add($"{shown}: {ManifestFile} isn't valid JSON.");
                return null;
            }

            if (linked.FirstOrDefault(f => !File.Exists(Path.Combine(folder, f))) is { } missing)
            {
                skipped.Add($"{shown}: {missing} is missing.");
                return null;
            }

            var prefix = $"spotikit/{source.Directory}/{source.Id}/";
            var ok = true;
            foreach (var (relative, path) in FilesOf(folder))
                ok &= Take(prefix + relative, File.ReadAllBytes(path), $"{shown}/{relative}");
            return ok ? new Manifest(string.IsNullOrWhiteSpace(name) ? shown : name, main?.Replace('\\', '/')) : null;
        }

        foreach (var source in Sources())
        {
            switch (source)
            {
                case { Kind: "extension", IsFolder: false }:
                    var file = source.Id + ".js";
                    if (Take(XpuiPatcher.ExtensionsPrefix + file, File.ReadAllBytes(source.FullPath), source.Folder + ".js"))
                    {
                        extensions.Add(file);
                        extensionInfo.Add(new AddonInfo(source.Id, source.Folder, source.Folder + ".js", file));
                    }
                    break;
                case { Kind: "extension" }:
                    if (TakeFolder(source, "extension.js") is { } e)
                    {
                        extensions.Add($"{source.Id}/{e.Main}");
                        extensionInfo.Add(new AddonInfo(source.Id, e.Name!, source.Folder, $"{source.Id}/{e.Main}"));
                    }
                    break;
                case { Kind: "app" }:
                    if (TakeFolder(source, "index.js") is { } a)
                        apps.Add(new AddonInfo(source.Id, a.Name!, source.Folder));
                    break;
                case { Kind: "snippet" }:
                    if (TakeFolder(source, null) is { } s)
                        snippets.Add(new AddonInfo(source.Id, s.Name!, source.Folder));
                    break;
                default:
                    if (TakeFolder(source, null) is { } t)
                        themes.Add(new AddonInfo(source.Id, t.Name!, source.Folder));
                    break;
            }
        }

        return new AddonSet(extensions, apps, themes, files, skipped) { ExtensionInfo = extensionInfo, Snippets = snippets, Warnings = warnings };
    }

    private static string? Text(JsonElement parent, string property) =>
        parent.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String && value.GetString() is { Length: > 0 } s
            ? s
            : null;

    public static string? ReadName(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("name", out var name))
            return null;
        return name.ValueKind switch
        {
            JsonValueKind.String => name.GetString(),
            JsonValueKind.Object when name.TryGetProperty("en", out var en) => en.GetString(),
            _ => null,
        };
    }
}

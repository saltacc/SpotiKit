using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;

namespace SpotiKit.Services;

public enum AddonKind
{
    Theme,
    Extension,
    CustomApp,
    Snippet,
}

public sealed record CreatedAddon(AddonKind Kind, string Id, string Name, string Path);

public sealed partial class AddonTemplates(SpotiKitPaths paths)
{
    private const string Prefix = "SpotiKit.Templates/";
    private const string Shared = "shared/";

    [GeneratedRegex(@"[^\p{L}\p{N} ._!&()-]")]
    private static partial Regex UnsafeNameCharacters();

    [GeneratedRegex(@"^\d+(\.\d+){0,2}")]
    private static partial Regex ShortVersion();

    public CreatedAddon Create(AddonKind kind, string name, string? spotifyVersion = null, bool typescript = false)
    {
        if (typescript && kind == AddonKind.Snippet)
            throw new ArgumentException("CSS snippets are CSS only, so there's nothing to write in TypeScript.");
        var shownName = FolderFor(name);
        var id = IdFor(shownName);
        if (id.Length == 0)
            throw new ArgumentException("Give it a name with at least one letter or digit.");

        var (root, noun) = kind switch
        {
            AddonKind.Theme => (paths.ThemesDir, "theme"),
            AddonKind.Extension => (paths.ExtensionsDir, "extension"),
            AddonKind.Snippet => (paths.SnippetsDir, "snippet"),
            _ => (paths.AppsDir, "custom app"),
        };
        var target = Path.Combine(root, shownName);
        if (Directory.Exists(root) &&
            Directory.EnumerateFileSystemEntries(root).Any(e => IdFor(Path.GetFileNameWithoutExtension(e)) == id))
            throw new IOException($"There's already a {noun} called {shownName}.");

        var spotify = ShortVersion().Match(spotifyVersion ?? "").Value is { Length: > 0 } v
            ? v
            : ShortVersion().Match(ClassMapCatalog.Bundled.ByVersion.Keys
                .OrderBy(k => k, Comparer<string>.Create(CompareVersions)).LastOrDefault() ?? "1").Value;

        var files = typescript ? TypeScript(kind, Template(kind)) : Template(kind);
        Directory.CreateDirectory(target);
        foreach (var (relative, text) in files)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(target, relative))!);
            File.WriteAllText(Path.Combine(target, relative), text
                .Replace("{{ID}}", id)
                .Replace("{{NAME}}", shownName)
                .Replace("{{SPOTIFY}}", spotify), new UTF8Encoding(false));
        }
        return new CreatedAddon(kind, id, shownName, target);
    }

    private static IReadOnlyList<(string Relative, string Text)> TypeScript(AddonKind kind, IReadOnlyList<(string Relative, string Text)> files)
    {
        var (js, ts) = kind switch
        {
            AddonKind.Theme => ("theme.js", "theme.ts"),
            AddonKind.Extension => ("extension.js", "extension.ts"),
            _ => ("index.js", "index.tsx"),
        };
        var built = "dist/" + Path.ChangeExtension(ts, ".js");
        var list = files.Where(f => f.Relative != js && f.Relative != "jsconfig.json").Select(f =>
        {
            if (f.Relative == AddonCatalog.ManifestFile)
            {
                var manifest = System.Text.Json.Nodes.JsonNode.Parse(f.Text)!.AsObject();
                var rebuilt = new System.Text.Json.Nodes.JsonObject();
                foreach (var (key, value) in manifest.ToList())
                {
                    if (key == "main")
                    {
                        rebuilt["source"] = "src/" + ts;
                        rebuilt["main"] = built;
                    }
                    else
                        rebuilt[key] = value?.DeepClone();
                }
                rebuilt["source"] ??= "src/" + ts;
                rebuilt["main"] ??= built;
                return (f.Relative, rebuilt.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }) + "\n");
            }
            if (f.Relative == "README.md")
                return (f.Relative, f.Text.Replace($"`{js}`", $"`src/{ts}`").Replace("`jsconfig.json`", "`tsconfig.json`") +
                                    $"\n## TypeScript\n\nThe code is in `src/{ts}`. Live preview and Apply build it into `{built}` with spotikit-kit, " +
                                    "which needs Node.js: run `npm install` in this folder once.\n");
            return f;
        }).ToList();
        list.Add(("tsconfig.json", Resource("typescript/tsconfig.json")));
        list.Add(("package.json", Resource("typescript/package.json")));
        list.Add((".gitignore", Resource("typescript/gitignore")));
        list.Add(("src/" + ts, Resource("typescript/src/" + ts)));
        return list;
    }

    private static string Resource(string path)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var name = assembly.GetManifestResourceNames().FirstOrDefault(n => n.Replace('\\', '/') == Prefix + path)
                   ?? throw new FileNotFoundException($"The template file {path} is missing from the app.");
        using var stream = assembly.GetManifestResourceStream(name)!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static int CompareVersions(string a, string b)
    {
        var x = a.Split('.');
        var y = b.Split('.');
        for (var i = 0; i < Math.Max(x.Length, y.Length); i++)
        {
            var c = (i < x.Length && int.TryParse(x[i], out var p) ? p : 0).CompareTo(i < y.Length && int.TryParse(y[i], out var q) ? q : 0);
            if (c != 0)
                return c;
        }
        return 0;
    }

    public static string IdFor(string name) => AddonCatalog.IdFor(name);

    public static string FolderFor(string? name)
    {
        var folder = UnsafeNameCharacters().Replace(name ?? "", "").Trim().TrimEnd('.').Trim();
        return folder.Length > 60 ? folder[..60].Trim() : folder;
    }

    private static IReadOnlyList<(string Relative, string Text)> Template(AddonKind kind)
    {
        var folder = kind switch
        {
            AddonKind.Theme => "theme/",
            AddonKind.Extension => "extension/",
            AddonKind.Snippet => "snippet/",
            _ => "app/",
        };
        var shared = kind != AddonKind.Snippet;
        var assembly = Assembly.GetExecutingAssembly();
        var files = assembly.GetManifestResourceNames()
            .Select(n => (Name: n, Path: n.StartsWith(Prefix, StringComparison.Ordinal) ? n[Prefix.Length..].Replace('\\', '/') : null))
            .Where(r => r.Path is not null && (r.Path.StartsWith(folder, StringComparison.Ordinal) || (shared && r.Path.StartsWith(Shared, StringComparison.Ordinal))))
            .Select(r =>
            {
                using var stream = assembly.GetManifestResourceStream(r.Name)!;
                using var reader = new StreamReader(stream);
                var path = r.Path!;
                return (path[(path.StartsWith(Shared, StringComparison.Ordinal) ? Shared : folder).Length..], reader.ReadToEnd());
            })
            .ToList();
        if (files.Count == 0)
            throw new FileNotFoundException($"The {kind} template is missing from the app.");
        return files;
    }
}

using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace SpotiKit.Services;

public static partial class XpuiPatcher
{
    public const string ConfigScriptEntry = "spotikit/config.js";
    public const string ExtensionsPrefix = "spotikit/extensions/";
    public const string AppsPrefix = "spotikit/apps/";
    public const string ThemesPrefix = "spotikit/themes/";
    public const string SnippetsPrefix = "spotikit/snippets/";

    private static void RemoveAddons(ZipArchive zip)
    {
        foreach (var entry in zip.Entries
                     .Where(e => e.FullName.StartsWith(ExtensionsPrefix, StringComparison.Ordinal) ||
                                 e.FullName.StartsWith(AppsPrefix, StringComparison.Ordinal) ||
                                 e.FullName.StartsWith(ThemesPrefix, StringComparison.Ordinal) ||
                                 e.FullName.StartsWith(SnippetsPrefix, StringComparison.Ordinal) ||
                                 e.FullName == ConfigScriptEntry)
                     .ToList())
            entry.Delete();
    }

    private static void WriteAddons(ZipArchive zip, AddonSet addons)
    {
        RemoveAddons(zip);
        foreach (var file in addons.Files)
        {
            if (!new[] { ExtensionsPrefix, AppsPrefix, ThemesPrefix, SnippetsPrefix }.Any(prefix => file.Entry.StartsWith(prefix, StringComparison.Ordinal)))
                throw new InvalidDataException($"{file.Entry} is not a project location.");
            var entry = zip.CreateEntry(file.Entry, CompressionLevel.Optimal);
            using var stream = entry.Open();
            stream.Write(file.Content);
        }

        WriteText(zip, ConfigScriptEntry, BuildConfigScript(addons), hasBom: false);
    }

    private static string BuildConfigScript(AddonSet addons)
    {
        var config = new FrameworkConfig(addons.ExtensionInfo.Select(e => new FrameworkExtensionEntry(e.Id, e.Name, e.Path ?? e.Id)).ToList(),
            addons.Apps.Select(a => new FrameworkConfigEntry(a.Id, a.Name)).ToList(),
            addons.Themes.Select(t => new FrameworkConfigEntry(t.Id, t.Name)).ToList(),
            addons.Snippets.Select(s => new FrameworkConfigEntry(s.Id, s.Name)).ToList());
        return "/* SpotiKit configuration: the projects the installer packaged */\n" +
               $"window.__spotikitConfig = {JsonSerializer.Serialize(config, AddonJsonContext.Default.FrameworkConfig)};\n";
    }

    public static string? ReadConfigScript(string spaPath)
    {
        using var zip = ZipFile.OpenRead(spaPath);
        return zip.GetEntry(ConfigScriptEntry) is { } entry ? ReadText(entry).Text : null;
    }
}

internal sealed record FrameworkConfigEntry(string Id, string Name);

internal sealed record FrameworkExtensionEntry(string Id, string Name, string Path);

internal sealed record FrameworkConfig(
    System.Collections.Generic.List<FrameworkExtensionEntry> Extensions,
    System.Collections.Generic.List<FrameworkConfigEntry> Apps,
    System.Collections.Generic.List<FrameworkConfigEntry> Themes,
    System.Collections.Generic.List<FrameworkConfigEntry> Snippets);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(FrameworkConfig))]
internal partial class AddonJsonContext : JsonSerializerContext;

using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace SpotiKit.Services;

public sealed record ClassMapping(string Generated, string Stable, string? Description = null, bool RuntimeOnly = false);

public sealed partial class ClassMapCatalog(IReadOnlyDictionary<string, IReadOnlyList<ClassMapping>> byVersion)
{
    public const string ResourceName = "SpotiKit.Framework.class-map.json";

    [GeneratedRegex("^[A-Za-z_][A-Za-z0-9_-]{2,}$")]
    private static partial Regex GeneratedName();

    [GeneratedRegex("^[a-z][a-z0-9]*(?:(?:-|--|__)[a-z0-9]+)*$")]
    private static partial Regex StableName();

    public static ClassMapCatalog Bundled { get; } = Load();

    public IReadOnlyDictionary<string, IReadOnlyList<ClassMapping>> ByVersion { get; } = byVersion;

    public IReadOnlyList<ClassMapping> For(string? spotifyVersion) =>
        spotifyVersion is not null && ByVersion.TryGetValue(spotifyVersion, out var mappings) ? mappings : [];

    public static ClassMapCatalog Parse(string json)
    {
        var file = JsonSerializer.Deserialize(json, ClassMapJsonContext.Default.ClassMapFile)
                   ?? throw new InvalidDataException("The class map is empty.");
        if (file.SchemaVersion != 1)
            throw new InvalidDataException($"Unsupported class map schema {file.SchemaVersion}.");

        var byVersion = new Dictionary<string, IReadOnlyList<ClassMapping>>(StringComparer.OrdinalIgnoreCase);
        foreach (var (version, mappings) in file.Spotify ?? [])
        {
            var generated = new HashSet<string>(StringComparer.Ordinal);
            var stable = new HashSet<string>(StringComparer.Ordinal);
            foreach (var mapping in mappings)
            {
                if (!GeneratedName().IsMatch(mapping.Generated))
                    throw new InvalidDataException($"'{mapping.Generated}' is not a valid class name.");
                if (!StableName().IsMatch(mapping.Stable))
                    throw new InvalidDataException($"'{mapping.Stable}' must be lower-case words joined by hyphens, like main-view.");
                if (!generated.Add(mapping.Generated))
                    throw new InvalidDataException($"'{mapping.Generated}' is mapped twice for Spotify {version}.");
                if (!stable.Add(mapping.Stable))
                    throw new InvalidDataException($"'{mapping.Stable}' is used for two classes in Spotify {version}.");
            }

            byVersion[version] = mappings;
        }

        return new ClassMapCatalog(byVersion);
    }

    private static ClassMapCatalog Load()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName)
                           ?? throw new FileNotFoundException("The bundled class map is missing from the app.");
        using var reader = new StreamReader(stream);
        return Parse(reader.ReadToEnd());
    }
}

internal sealed record ClassMapFile(int SchemaVersion, Dictionary<string, List<ClassMapping>>? Spotify);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, ReadCommentHandling = JsonCommentHandling.Skip)]
[JsonSerializable(typeof(ClassMapFile))]
internal partial class ClassMapJsonContext : JsonSerializerContext;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using SpotiKit.Models;

namespace SpotiKit.Services;

public sealed record ClassMapping(string Generated, string Stable, string? Description = null, bool RuntimeOnly = false);

public sealed record ClassMapProfile(string Id, string SpotifyVersion, string Platform, string Architecture,
    string ResourceFingerprint, string? SnapshotSha256, IReadOnlyList<ClassMapping> Mappings);

public sealed record ClassMapSelection(ClassMapProfile? Profile, SpotifyBuildIdentity? Build, string Description)
{
    public IReadOnlyList<ClassMapping> Mappings => Profile?.Mappings ?? [];
    public bool IsSupported => Profile is not null;
    public bool IsFallback { get; init; }
}

public sealed partial class ClassMapCatalog(IReadOnlyDictionary<string, IReadOnlyList<ClassMapping>> byVersion)
{
    public const string ResourceName = "SpotiKit.Framework.class-map.json";

    [GeneratedRegex("^[A-Za-z_][A-Za-z0-9_-]{2,}$")]
    private static partial Regex GeneratedName();

    [GeneratedRegex("^[a-z][a-z0-9]*(?:(?:-|--|__)[a-z0-9]+)*$")]
    private static partial Regex StableName();

    public static ClassMapCatalog Bundled { get; } = Load();

    public IReadOnlyDictionary<string, IReadOnlyList<ClassMapping>> ByVersion { get; } = byVersion;
    public IReadOnlyList<ClassMapProfile> Profiles { get; init; } = [];

    public IReadOnlyList<ClassMapping> For(string? spotifyVersion) =>
        spotifyVersion is not null && ByVersion.TryGetValue(spotifyVersion, out var mappings) ? mappings : [];

    public ClassMapSelection Select(SpotifyInstallation client)
    {
        var build = client.Build;
        var profile = Profiles.FirstOrDefault(p => p.SpotifyVersion == client.Version && p.Platform == build?.Platform &&
            p.Architecture == build.Architecture &&
            string.Equals(p.ResourceFingerprint, build.ResourceFingerprint, StringComparison.OrdinalIgnoreCase) &&
            (p.SnapshotSha256 is null || string.Equals(p.SnapshotSha256, build.SnapshotSha256, StringComparison.OrdinalIgnoreCase)));
        if (profile is not null)
            return new(profile, build, $"{profile.Id}: {profile.Mappings.Count} stable names");
        // Schema 1 was captured from Windows clients. Never use it as a Mac fallback.
        if (build?.Platform == "windows" && client.Version is { } version && ByVersion.TryGetValue(version, out var legacy))
            return new(new($"windows-{version}-legacy", version, "windows", "any", "", null, legacy), build,
                $"Windows {version}: {legacy.Count} stable names");
        if (build?.Platform == "macos" && ParseVersion(client.Version) is { } target)
        {
            var closest = Profiles
                .Where(p => p.Platform == build.Platform && p.Architecture == build.Architecture && p.Mappings.Count > 0)
                .Select(p => (Profile: p, Version: ParseVersion(p.SpotifyVersion)))
                .Where(p => p.Version is not null)
                .OrderBy(p => Math.Abs((long)p.Version!.Major - target.Major))
                .ThenBy(p => Math.Abs((long)p.Version!.Minor - target.Minor))
                .ThenBy(p => Math.Abs((long)p.Version!.Build - target.Build))
                .ThenBy(p => Math.Abs((long)p.Version!.Revision - target.Revision))
                .ThenBy(p => p.Version! > target) // Prefer the older profile for an equal distance.
                .ThenByDescending(p => string.Equals(p.Profile.ResourceFingerprint, build.ResourceFingerprint, StringComparison.OrdinalIgnoreCase))
                .ThenByDescending(p => string.Equals(p.Profile.SnapshotSha256, build.SnapshotSha256, StringComparison.OrdinalIgnoreCase))
                .ThenBy(p => p.Profile.Id, StringComparer.Ordinal)
                .Select(p => p.Profile)
                .FirstOrDefault();
            if (closest is not null)
                return new(closest, build,
                    $"Using closest Mac {build.Architecture} map: Spotify {closest.SpotifyVersion} for {client.Version}. " +
                    "This build is unverified; some theme styles may be incomplete.") { IsFallback = true };
        }
        return new(null, build, $"No verified {build?.Platform ?? "platform"} class map for Spotify {client.Version ?? "unknown"} " +
            $"({build?.Architecture ?? "unknown architecture"}). Themes may be incomplete.");
    }

    private static Version? ParseVersion(string? text) => Version.TryParse(text, out var version)
        ? new Version(version.Major, version.Minor, Math.Max(0, version.Build), Math.Max(0, version.Revision))
        : null;

    public static ClassMapCatalog Parse(string json)
    {
        var file = JsonSerializer.Deserialize(json, ClassMapJsonContext.Default.ClassMapFile)
                   ?? throw new InvalidDataException("The class map is empty.");
        if (file.SchemaVersion is not (1 or 2))
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

        var profiles = file.Profiles ?? [];
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var profile in profiles)
        {
            if (string.IsNullOrWhiteSpace(profile.Id) || !ids.Add(profile.Id) ||
                string.IsNullOrWhiteSpace(profile.SpotifyVersion) || profile.Mappings is null ||
                profile.Platform is not ("windows" or "macos" or "linux") || string.IsNullOrWhiteSpace(profile.Architecture) ||
                !Regex.IsMatch(profile.ResourceFingerprint ?? "", "^[A-Fa-f0-9]{64}$") ||
                (profile.SnapshotSha256 is { } snapshot && !Regex.IsMatch(snapshot, "^[A-Fa-f0-9]{64}$")))
                throw new InvalidDataException($"Invalid build profile {profile.Id}.");
            var generated = new HashSet<string>(StringComparer.Ordinal);
            var stable = new HashSet<string>(StringComparer.Ordinal);
            foreach (var mapping in profile.Mappings)
                if (!GeneratedName().IsMatch(mapping.Generated) || !StableName().IsMatch(mapping.Stable) ||
                    !generated.Add(mapping.Generated) || !stable.Add(mapping.Stable))
                    throw new InvalidDataException($"Invalid or repeated class in profile {profile.Id}.");
        }
        return new ClassMapCatalog(byVersion) { Profiles = profiles };
    }

    private static ClassMapCatalog Load()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName)
                           ?? throw new FileNotFoundException("The bundled class map is missing from the app.");
        using var reader = new StreamReader(stream);
        return Parse(reader.ReadToEnd());
    }
}

internal sealed record ClassMapFile(int SchemaVersion, Dictionary<string, List<ClassMapping>>? Spotify,
    List<ClassMapProfile>? Profiles = null);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, ReadCommentHandling = JsonCommentHandling.Skip)]
[JsonSerializable(typeof(ClassMapFile))]
internal partial class ClassMapJsonContext : JsonSerializerContext;

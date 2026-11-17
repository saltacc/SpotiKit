using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace SpotiKit.Services;

public enum SpotifyVersionStatus
{
    Approved,

    Broken,
}

public sealed record SpotifyVersionEntry(
    string Version,
    SpotifyVersionStatus Status,
    DateOnly? Date = null,
    string? MinApp = null,
    string? Notes = null)
{
    public bool NeedsNewerApp(string appVersion) =>
        MinApp is not null && SemanticVersion.TryParse(MinApp, out var min) &&
        SemanticVersion.TryParse(appVersion, out var app) && app < min;
}

public enum SpotifyVersionListSource
{
    GitHub,

    Saved,

    Bundled,
}

public sealed record SpotifyVersionList(
    IReadOnlyList<SpotifyVersionEntry> Versions,
    SpotifyVersionListSource Source,
    DateTimeOffset? RetrievedAt,
    string? Problem = null)
{
    public SpotifyVersionEntry? Find(string? version) =>
        version is null ? null : Versions.FirstOrDefault(v => string.Equals(v.Version, version, StringComparison.OrdinalIgnoreCase));

    public bool IsApproved(string? version) => Find(version)?.Status == SpotifyVersionStatus.Approved;
}

public sealed partial class SpotifyVersionListService(SpotiKitPaths paths, Func<CancellationToken, Task<string>>? download = null)
{
    private const string BundledResource = "SpotiKit.spotify-versions.json";

    [GeneratedRegex(@"^\d+(\.\d+){1,4}$")]
    private static partial Regex VersionPattern();

    public string SavedPath => Path.Combine(paths.DataRoot, "spotify-versions.json");

    public SpotifyVersionList LoadLocal(string? problem = null)
    {
        var bundled = Parse(ReadBundled());
        try
        {
            if (File.Exists(SavedPath) && Parse(File.ReadAllText(SavedPath)) is var saved && Newest(saved) >= Newest(bundled))
                return new SpotifyVersionList(saved, SpotifyVersionListSource.Saved, File.GetLastWriteTimeUtc(SavedPath), problem);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidDataException)
        {
        }

        return new SpotifyVersionList(bundled, SpotifyVersionListSource.Bundled, null, problem);
    }

    private static DateOnly Newest(IReadOnlyList<SpotifyVersionEntry> entries) =>
        entries.Select(e => e.Date ?? DateOnly.MinValue).DefaultIfEmpty(DateOnly.MinValue).Max();

    public async Task<SpotifyVersionList> RefreshAsync(CancellationToken cancellationToken = default)
    {
        string json;
        IReadOnlyList<SpotifyVersionEntry> versions;
        try
        {
            json = await (download ?? DownloadAsync)(cancellationToken);
            versions = Parse(json);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidDataException)
        {
            return LoadLocal(Describe(ex));
        }

        try
        {
            Directory.CreateDirectory(paths.DataRoot);
            await File.WriteAllTextAsync(SavedPath, json, cancellationToken);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
        }

        return new SpotifyVersionList(versions, SpotifyVersionListSource.GitHub, DateTimeOffset.UtcNow);
    }

    public static IReadOnlyList<SpotifyVersionEntry> Parse(string json)
    {
        VersionListFile? file;
        try
        {
            file = JsonSerializer.Deserialize(json, VersionListJsonContext.Default.VersionListFile);
        }
        catch (JsonException ex)
        {
            throw new InvalidDataException("The list of approved Spotify versions isn't valid JSON.", ex);
        }

        if (file is null || file.SchemaVersion != 1)
            throw new InvalidDataException($"The list of approved Spotify versions has an unsupported format ({file?.SchemaVersion}).");

        var entries = new List<SpotifyVersionEntry>();
        foreach (var item in file.Versions ?? [])
        {
            if (item.Version is null || !VersionPattern().IsMatch(item.Version))
                throw new InvalidDataException($"'{item.Version}' is not a Spotify version.");
            if (entries.Any(e => string.Equals(e.Version, item.Version, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException($"Spotify {item.Version} is listed twice.");
            var status = item.Status?.ToLowerInvariant() switch
            {
                "approved" => SpotifyVersionStatus.Approved,
                "broken" => SpotifyVersionStatus.Broken,
                _ => throw new InvalidDataException($"Spotify {item.Version} has an unknown status '{item.Status}'."),
            };
            DateOnly? date = DateOnly.TryParse(item.Date, out var d) ? d : null;
            entries.Add(new SpotifyVersionEntry(item.Version, status, date, item.MinApp, item.Notes));
        }

        return entries;
    }

    private static async Task<string> DownloadAsync(CancellationToken cancellationToken)
    {
        using var response = await SpotiKitRepository.Http.GetAsync(SpotiKitRepository.VersionListUrl, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"GitHub answered {(int)response.StatusCode} {response.ReasonPhrase}.");
        return await response.Content.ReadAsStringAsync(cancellationToken);
    }

    private static string Describe(Exception ex) => ex switch
    {
        TaskCanceledException => "GitHub didn't answer in time.",
        HttpRequestException { StatusCode: null } when ex.InnerException is not null => "GitHub couldn't be reached.",
        HttpRequestException => ex.Message.StartsWith("GitHub", StringComparison.Ordinal) ? ex.Message : "GitHub couldn't be reached.",
        _ => ex.Message,
    };

    private static string ReadBundled()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(BundledResource)
                           ?? throw new FileNotFoundException("The built-in list of approved Spotify versions is missing from the app.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}

internal sealed record VersionListItem(string? Version, string? Status, string? Date, string? MinApp, string? Notes);

internal sealed record VersionListFile(int SchemaVersion, List<VersionListItem>? Versions);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true,
    ReadCommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true)]
[JsonSerializable(typeof(VersionListFile))]
internal partial class VersionListJsonContext : JsonSerializerContext;

using System;
using System.IO;

namespace SpotiKit.Services;

public sealed record SpotiKitPaths(
    string DataRoot,
    string SettingsFile,
    string? SpotifyDirOverride,
    string SpotifyLocalDataDir)
{
    public string BackupsDir => Path.Combine(DataRoot, "Backups");
    public string LogsDir => Path.Combine(DataRoot, "Logs");
    public string StateFile => Path.Combine(DataRoot, "install-state.json");

    public string AddonsRoot => Path.GetDirectoryName(SettingsFile) ?? DataRoot;
    public string ExtensionsDir => Path.Combine(AddonsRoot, "Extensions");
    public string AppsDir => Path.Combine(AddonsRoot, "Custom Apps");
    public string ThemesDir => Path.Combine(AddonsRoot, "Themes");
    public string SnippetsDir => Path.Combine(AddonsRoot, "Snippets");

    public bool IsSandboxed { get; init; }

    public void MoveLegacyFolders()
    {
        var legacy = Path.Combine(AddonsRoot, "Apps");
        try
        {
            if (Directory.Exists(legacy) && !Directory.Exists(AppsDir))
                Directory.Move(legacy, AppsDir);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
        }
    }

    public static SpotiKitPaths FromEnvironment()
    {
        var dataOverride = Environment.GetEnvironmentVariable("SPOTIKIT_DATA_DIR");
        var spotifyOverride = Environment.GetEnvironmentVariable("SPOTIKIT_SPOTIFY_DIR");
        var localOverride = Environment.GetEnvironmentVariable("SPOTIKIT_SPOTIFY_LOCAL_DIR");

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

        var dataRoot = string.IsNullOrWhiteSpace(dataOverride) ? Path.Combine(localAppData, "SpotiKit") : dataOverride;
        var settings = string.IsNullOrWhiteSpace(dataOverride)
            ? Path.Combine(roaming, "SpotiKit", "settings.json")
            : Path.Combine(dataOverride, "settings.json");

        return new SpotiKitPaths(
            dataRoot,
            settings,
            string.IsNullOrWhiteSpace(spotifyOverride) ? null : spotifyOverride,
            string.IsNullOrWhiteSpace(localOverride) ? Path.Combine(localAppData, "Spotify") : localOverride)
        {
            IsSandboxed = !string.IsNullOrWhiteSpace(dataOverride) || !string.IsNullOrWhiteSpace(spotifyOverride) ||
                          !string.IsNullOrWhiteSpace(localOverride),
        };
    }
}

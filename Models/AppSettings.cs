using System.Text.Json.Serialization;

namespace SpotiKit.Models;

public sealed class AppSettings
{
    public const int CurrentVersion = 3;

    public int Version { get; set; }

    public bool LaunchSpotifyAfterInstall { get; set; } = true;

    public bool CheckForUpdates { get; set; } = true;

    public bool RunInBackground { get; set; } = true;

    public string Accent { get; set; } = AccentOption.Default.Name;
    public string CustomAccent { get; set; } = "#FF5C8A";

    public int BackupRetention { get; set; } = 5;

    public SpotifyUpdateMode UpdateMode { get; set; } = SpotifyUpdateMode.Supported;

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? HoldUpdatesWhileInstalled { get; set; }

    public bool DesktopShortcutCreated { get; set; }
}

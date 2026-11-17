namespace SpotiKit.Models;

public enum SpotifyEdition
{
    None,
    Desktop,
    MicrosoftStore,
}

public enum XpuiKind
{
    Missing,

    Spa,

    Folder,
}

public sealed record SpotifyInstallation(
    SpotifyEdition Edition,
    string? Version,
    string? InstallPath,
    bool IsRunning,
    string? ExecutablePath = null,
    XpuiKind XpuiKind = XpuiKind.Missing,
    string? XpuiPath = null,
    XpuiInspection? Xpui = null)
{
    public static SpotifyInstallation NotFound { get; } = new(SpotifyEdition.None, null, null, false);

    public bool IsInstalled => Edition != SpotifyEdition.None;

    public bool HasSpotiKit => Xpui is { HasSpotiKit: true };
}

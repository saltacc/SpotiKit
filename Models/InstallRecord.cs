using System;

namespace SpotiKit.Models;

public sealed record InstallRecord(
    string FrameworkVersion,
    ReleaseChannel Channel,
    DateTimeOffset InstalledAt,
    string SpotifyVersion,
    string? BackupId,
    string LoaderSha256)
{
    public SpotifyBuildIdentity? Build { get; init; }

    public bool WasReplaced(SpotifyInstallation client) => !client.HasSpotiKit &&
        (!string.Equals(SpotifyVersion, client.Version, StringComparison.OrdinalIgnoreCase) ||
         Build is not null && Build != client.Build);
}

public sealed record UpdateHoldRecord(DateTimeOffset HeldAt, string? SpotifyVersion, bool Automatic);

public sealed record DevToolsRecord(
    DateTimeOffset EnabledAt,
    string BackupFile,
    char OriginalXmlValue,
    char OriginalBinaryValue,
    string PatchedSha256);

public sealed record UpdateWindowRecord(string TargetVersion, string FromVersion, DateTimeOffset OpenedAt);

public sealed record LatestSpotifyRecord(string Version, string? ETag, DateTimeOffset CheckedAt);

public sealed record SpotiKitState(
    InstallRecord? Install,
    UpdateHoldRecord? Hold,
    DevToolsRecord? DevTools = null,
    UpdateWindowRecord? UpdateWindow = null,
    LatestSpotifyRecord? LatestSpotify = null,
    DateTimeOffset? AppCheckedAt = null)
{
    public static SpotiKitState Empty { get; } = new(null, null);
}

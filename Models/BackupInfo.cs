using System;
using System.Collections.Generic;

namespace SpotiKit.Models;

public enum BackupKind
{
    Automatic,

    Manual,
}

public sealed record BackupFile(string RelativePath, long Size, string Sha256, int? UnixMode = null);
public sealed record BackupLink(string RelativePath, string Target);

public sealed record BackupManifest(
    string Id,
    DateTimeOffset CreatedAt,
    BackupKind Kind,
    string SpotifyVersion,
    string SpotifyPath,
    bool IsPristine,
    IReadOnlyList<BackupFile> Files)
{
    public string? ExecutableSha256 { get; init; }
    public int SchemaVersion { get; init; } = 1;
    public SpotifyBuildIdentity? Build { get; init; }
    public bool FullBundle { get; init; }
    public string? BundleFingerprint { get; init; }
    public IReadOnlyList<BackupFile> BundleFiles { get; init; } = [];
    public IReadOnlyList<BackupLink> BundleLinks { get; init; } = [];
}

public sealed record BackupInfo(BackupManifest Manifest, string Directory, long TotalSize);

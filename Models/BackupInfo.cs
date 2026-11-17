using System;
using System.Collections.Generic;

namespace SpotiKit.Models;

public enum BackupKind
{
    Automatic,

    Manual,
}

public sealed record BackupFile(string RelativePath, long Size, string Sha256);

public sealed record BackupManifest(
    string Id,
    DateTimeOffset CreatedAt,
    BackupKind Kind,
    string SpotifyVersion,
    string SpotifyPath,
    bool IsPristine,
    IReadOnlyList<BackupFile> Files);

public sealed record BackupInfo(BackupManifest Manifest, string Directory, long TotalSize);

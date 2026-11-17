using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using SpotiKit.Models;

namespace SpotiKit.Services;

public sealed class BackupService(SpotiKitPaths paths)
{
    private const string ManifestName = "manifest.json";
    private const string FilesFolder = "files";

    public string BackupsDirectory => paths.BackupsDir;

    public BackupInfo Create(SpotifyInstallation spotify, BackupKind kind)
    {
        if (spotify is not { Edition: SpotifyEdition.Desktop, XpuiKind: XpuiKind.Spa, XpuiPath: { } xpuiPath, InstallPath: { } installPath })
            throw new InvalidOperationException("Backups need the Spotify desktop client with its standard xpui.spa file.");

        var created = DateTimeOffset.Now;
        var version = spotify.Version ?? "unknown";
        var id = $"{created:yyyyMMdd-HHmmss}-{SafeName(version)}";
        var directory = Path.Combine(paths.BackupsDir, id);
        var suffix = 1;
        while (Directory.Exists(directory))
            directory = Path.Combine(paths.BackupsDir, $"{id}-{++suffix}");
        id = Path.GetFileName(directory);

        var relative = Path.GetRelativePath(installPath, xpuiPath);
        var target = Path.Combine(directory, FilesFolder, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);

        try
        {
            var sourceHash = FileHash.Sha256(xpuiPath);
            File.Copy(xpuiPath, target);
            var copyHash = FileHash.Sha256(target);
            if (copyHash != sourceHash)
                throw new IOException("The backup copy does not match the original file.");

            var manifest = new BackupManifest(id, created, kind, version, installPath,
                IsPristine: XpuiPatcher.Inspect(target) is { IsReadable: true, HasSpotiKit: false },
                Files: [new BackupFile(relative, new FileInfo(target).Length, copyHash)]);
            WriteManifest(directory, manifest);
            return new BackupInfo(manifest, directory, DirectorySize(directory));
        }
        catch
        {
            TryDelete(directory);
            throw;
        }
    }

    public IReadOnlyList<BackupInfo> List()
    {
        if (!Directory.Exists(paths.BackupsDir))
            return [];

        var backups = new List<BackupInfo>();
        foreach (var directory in Directory.EnumerateDirectories(paths.BackupsDir))
        {
            if (ReadManifest(directory) is { } manifest)
                backups.Add(new BackupInfo(manifest, directory, DirectorySize(directory)));
        }

        return backups.OrderByDescending(b => b.Manifest.CreatedAt).ToList();
    }

    public bool Verify(BackupInfo backup, out string? problem)
    {
        foreach (var file in backup.Manifest.Files)
        {
            var path = Path.Combine(backup.Directory, FilesFolder, file.RelativePath);
            if (!File.Exists(path))
            {
                problem = $"{file.RelativePath} is missing from the backup.";
                return false;
            }

            if (FileHash.Sha256(path) != file.Sha256)
            {
                problem = $"{file.RelativePath} in the backup has changed since it was made.";
                return false;
            }
        }

        problem = null;
        return true;
    }

    public static string? RestoreBlocker(BackupInfo backup, SpotifyInstallation spotify)
    {
        if (spotify is not { Edition: SpotifyEdition.Desktop, InstallPath: not null })
            return "The Spotify desktop client was not found.";
        if (spotify.IsRunning)
            return "Spotify is running. Close it before restoring.";
        if (!string.Equals(backup.Manifest.SpotifyVersion, spotify.Version, StringComparison.OrdinalIgnoreCase))
            return $"This backup is from Spotify {backup.Manifest.SpotifyVersion}, but {spotify.Version ?? "an unknown version"} is installed. " +
                   "Its files only fit the version they came from.";
        return null;
    }

    public void Restore(BackupInfo backup, SpotifyInstallation spotify)
    {
        if (RestoreBlocker(backup, spotify) is { } blocker)
            throw new InvalidOperationException(blocker);
        if (!Verify(backup, out var problem))
            throw new InvalidDataException(problem);

        foreach (var file in backup.Manifest.Files)
        {
            var source = Path.Combine(backup.Directory, FilesFolder, file.RelativePath);
            var target = Path.Combine(spotify.InstallPath!, file.RelativePath);
            var workingCopy = target + ".spotikit-restore";

            File.Copy(source, workingCopy, overwrite: true);
            try
            {
                if (FileHash.Sha256(workingCopy) != file.Sha256)
                    throw new IOException($"Copying {file.RelativePath} back produced a different file.");
                File.Move(workingCopy, target, overwrite: true);
            }
            finally
            {
                if (File.Exists(workingCopy))
                    File.Delete(workingCopy);
            }

            if (FileHash.Sha256(target) != file.Sha256)
                throw new IOException($"{file.RelativePath} does not match the backup after restoring.");
        }
    }

    public void Delete(BackupInfo backup) => Directory.Delete(backup.Directory, recursive: true);

    public IReadOnlyList<BackupInfo> Prune(int keep)
    {
        var all = List();
        var protectedIds = all
            .Where(b => b.Manifest.IsPristine)
            .GroupBy(b => b.Manifest.SpotifyVersion)
            .Select(g => g.First().Manifest.Id)
            .ToHashSet();

        var removed = new List<BackupInfo>();
        foreach (var backup in all.Skip(Math.Max(1, keep)))
        {
            if (protectedIds.Contains(backup.Manifest.Id))
                continue;
            Delete(backup);
            removed.Add(backup);
        }

        return removed;
    }

    public BackupInfo? FindPristine(string? spotifyVersion) =>
        List().FirstOrDefault(b => b.Manifest.IsPristine &&
                                   string.Equals(b.Manifest.SpotifyVersion, spotifyVersion, StringComparison.OrdinalIgnoreCase));

    private static BackupManifest? ReadManifest(string directory)
    {
        try
        {
            var path = Path.Combine(directory, ManifestName);
            if (!File.Exists(path))
                return null;
            using var stream = File.OpenRead(path);
            return JsonSerializer.Deserialize(stream, BackupJsonContext.Default.BackupManifest);
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static void WriteManifest(string directory, BackupManifest manifest)
    {
        using var stream = File.Create(Path.Combine(directory, ManifestName));
        JsonSerializer.Serialize(stream, manifest, BackupJsonContext.Default.BackupManifest);
    }

    private static long DirectorySize(string directory) =>
        Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories).Sum(f => new FileInfo(f).Length);

    private static string SafeName(string value) =>
        string.Concat(value.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));

    private static void TryDelete(string directory)
    {
        try
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, recursive: true);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}

[JsonSourceGenerationOptions(WriteIndented = true, UseStringEnumConverter = true)]
[JsonSerializable(typeof(BackupManifest))]
internal partial class BackupJsonContext : JsonSerializerContext;

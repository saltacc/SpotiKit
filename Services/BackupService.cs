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
            var bundle = MacApplicationBundle.FromResources(installPath);
            var fullBundle = OperatingSystem.IsMacOS() && bundle is not null && MacBundleFiles.IsComplete(bundle);
            var build = spotify.Build ?? SpotifyBuildDetector.Read(installPath, spotify.ExecutablePath, xpuiPath, fresh: true);
            var bundleFingerprint = fullBundle ? MacBundleFiles.Fingerprint(bundle!) : null;
            if (fullBundle && (MacApplicationBundle.ReadVersion(installPath) != spotify.Version ||
                build != SpotifyBuildDetector.Read(installPath, spotify.ExecutablePath, xpuiPath, fresh: true)))
                throw new IOException("Spotify changed before its backup could be made. Recheck the installed build and retry.");
            var executableHash = spotify.Version is null ? ExecutableHash(spotify) : null;
            if (spotify.Version is null && executableHash is null)
                throw new InvalidOperationException("Spotify's version and executable could not be identified, so a restorable backup cannot be created.");
            var sourceHash = FileHash.Sha256(xpuiPath);
            File.Copy(xpuiPath, target);
            var copyHash = FileHash.Sha256(target);
            if (copyHash != sourceHash)
                throw new IOException("The backup copy does not match the original file.");

            IReadOnlyList<BackupFile> bundleFiles = [];
            IReadOnlyList<BackupLink> bundleLinks = [];
            if (fullBundle)
            {
                (bundleFiles, bundleLinks) = BundleRecords(bundle!);
                MacBundleFiles.Copy(bundle!, Path.Combine(directory, "bundle", "Spotify.app"));
                if (MacBundleFiles.Fingerprint(bundle!) != bundleFingerprint ||
                    MacBundleFiles.Fingerprint(Path.Combine(directory, "bundle", "Spotify.app")) != bundleFingerprint)
                    throw new IOException("Spotify changed while its complete backup was being made. The incomplete backup was discarded.");
            }

            var manifest = new BackupManifest(id, created, kind, version, installPath,
                IsPristine: XpuiPatcher.Inspect(target) is { IsReadable: true, HasSpotiKit: false, ForeignMods.Count: 0 },
                Files: [new BackupFile(relative, new FileInfo(target).Length, copyHash)])
            {
                ExecutableSha256 = executableHash,
                SchemaVersion = 2, Build = build, FullBundle = fullBundle, BundleFingerprint = bundleFingerprint,
                BundleFiles = bundleFiles, BundleLinks = bundleLinks,
            };
            WriteManifest(directory, manifest);
            var backup = new BackupInfo(manifest, directory, DirectorySize(directory));
            if (!Verify(backup, out var problem)) throw new IOException(problem);
            return backup;
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
        try { return VerifyFiles(backup, out problem); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            problem = ex.Message;
            return false;
        }
    }

    private static bool VerifyFiles(BackupInfo backup, out string? problem)
    {
        if (backup.Manifest.Files is null || backup.Manifest.Files.Count == 0 ||
            backup.Manifest.Files.Any(f => f is null || string.IsNullOrWhiteSpace(f.RelativePath)) ||
            backup.Manifest.Files.Select(f => f.RelativePath).Distinct(StringComparer.Ordinal).Count() != backup.Manifest.Files.Count ||
            (backup.Manifest.FullBundle && (backup.Manifest.BundleFiles is null || backup.Manifest.BundleLinks is null ||
                backup.Manifest.Build is null || string.IsNullOrWhiteSpace(backup.Manifest.BundleFingerprint) ||
                backup.Manifest.Files.Count(f => f.RelativePath.Replace('\\', '/') == "Apps/xpui.spa") != 1)))
        {
            problem = "The backup manifest is incomplete or contains repeated file records.";
            return false;
        }
        foreach (var file in backup.Manifest.Files)
        {
            var path = SafePath(Path.Combine(backup.Directory, FilesFolder), file.RelativePath);
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

        if (backup.Manifest.FullBundle)
        {
            var root = BundlePath(backup);
            if (!Directory.Exists(root)) { problem = "The full Spotify bundle is missing from the backup."; return false; }
            var (files, links) = BundleRecords(root);
            if (!files.SequenceEqual(backup.Manifest.BundleFiles) || !links.SequenceEqual(backup.Manifest.BundleLinks))
            {
                problem = "The full Spotify bundle has changed since the backup was made.";
                return false;
            }
            var resources = Path.Combine(root, "Contents", "Resources");
            var archive = Path.Combine(resources, "Apps", "xpui.spa");
            var actualBuild = SpotifyBuildDetector.Read(resources, Path.Combine(root, "Contents", "MacOS", "Spotify"), archive, fresh: true);
            if (MacBundleFiles.Fingerprint(root) != backup.Manifest.BundleFingerprint ||
                FileHash.Sha256(archive) != backup.Manifest.Files.Single(f => f.RelativePath.Replace('\\', '/') == "Apps/xpui.spa").Sha256 ||
                (MacApplicationBundle.ReadVersion(resources) ?? "unknown") != backup.Manifest.SpotifyVersion ||
                actualBuild != backup.Manifest.Build ||
                (XpuiPatcher.Inspect(archive) is { IsReadable: true, HasSpotiKit: false, ForeignMods.Count: 0 }) != backup.Manifest.IsPristine)
            {
                problem = "The backup metadata does not match its complete Spotify bundle.";
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
        if (backup.Manifest.Build is { } original && spotify.Build is { } current &&
            (original.Platform != current.Platform || original.Architecture != current.Architecture ||
             !string.Equals(original.ResourceFingerprint, current.ResourceFingerprint, StringComparison.OrdinalIgnoreCase) ||
             !string.Equals(original.SnapshotSha256, current.SnapshotSha256, StringComparison.OrdinalIgnoreCase)))
            return "This backup belongs to a different Spotify platform or build. Its files cannot be restored to this installation.";
        if (backup.Manifest.Build is null && spotify.Build?.Platform == "macos" &&
            MacApplicationBundle.FromResources(backup.Manifest.SpotifyPath) is null)
            return "This legacy backup was not made from a Mac Spotify bundle.";
        if (backup.Manifest.Build is null && spotify.Build?.Platform == "macos")
        {
            try
            {
                var archive = backup.Manifest.Files.Single(f => f.RelativePath.Replace('\\', '/') == "Apps/xpui.spa");
                if (FileHash.Sha256(SafePath(Path.Combine(backup.Directory, FilesFolder), archive.RelativePath)) != archive.Sha256 ||
                    XpuiPatcher.ResourceFingerprint(SafePath(Path.Combine(backup.Directory, FilesFolder), archive.RelativePath)) != spotify.Build.ResourceFingerprint)
                    return "This legacy Mac backup belongs to a different Spotify resource build.";
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException)
            {
                return "This legacy Mac backup could not be matched to the installed resource build.";
            }
        }
        var backupUnknown = backup.Manifest.SpotifyVersion == "unknown";
        if (backupUnknown && spotify.Version is null)
        {
            // An unknown version is not an identity. Only recover the same path and unchanged executable.
            var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
            if (!string.Equals(Path.GetFullPath(backup.Manifest.SpotifyPath), Path.GetFullPath(spotify.InstallPath), comparison) ||
                backup.Manifest.ExecutableSha256 is not { } hash || hash != ExecutableHash(spotify))
                return "The Spotify version is unknown and this backup cannot be matched to the same installation.";
        }
        else if (!string.Equals(backup.Manifest.SpotifyVersion, spotify.Version, StringComparison.OrdinalIgnoreCase))
            return $"This backup is from Spotify {backup.Manifest.SpotifyVersion}, but {spotify.Version ?? "an unknown version"} is installed. " +
                   "Its files only fit the version they came from.";
        return null;
    }

    public void Restore(BackupInfo backup, SpotifyInstallation spotify, Action<string>? onPublished = null,
        string? expectedFingerprint = null)
    {
        if (OperatingSystem.IsMacOS() && !new SpotifyService(paths).IsSandboxed && spotify.InstallPath is { } targetResources &&
            MacApplicationBundle.FromResources(targetResources) is { } targetBundle && !MacBundleFiles.IsComplete(targetBundle))
            throw new InvalidOperationException("Spotify's Mac app is incomplete. Reinstall the complete Spotify app before restoring it.");
        if (spotify.InstallPath is { } resources && spotify.XpuiPath is { } archive)
            spotify = spotify with { Build = SpotifyBuildDetector.Read(resources, spotify.ExecutablePath, archive, fresh: true) };
        if (RestoreBlocker(backup, spotify) is { } blocker)
            throw new InvalidOperationException(blocker);
        if (MacInstallPreflight.Problem(spotify) is { } accessProblem)
            throw new InvalidOperationException(accessProblem);
        if (!Verify(backup, out var problem))
            throw new InvalidDataException(problem);

        if (backup.Manifest.FullBundle)
        {
            using var transaction = new MacBundleTransaction(spotify, expectedFingerprint: expectedFingerprint);
            transaction.ReplaceWorkingBundle(BundlePath(backup));
            var sign = false;
            try { new MacBundleSigner().Verify(transaction.WorkingBundle); }
            catch (Exception ex) when (ex is InvalidOperationException or IOException) { sign = true; }
            transaction.Commit(sign);
            onPublished?.Invoke(transaction.PublishedFingerprint!);
            return;
        }

        if (OperatingSystem.IsMacOS() && MacApplicationBundle.FromResources(spotify.InstallPath!) is { } bundle &&
            MacBundleFiles.IsComplete(bundle))
        {
            using var transaction = new MacBundleTransaction(spotify, expectedFingerprint: expectedFingerprint);
            RestoreFiles(backup, transaction.WorkingClient);
            transaction.Commit();
            onPublished?.Invoke(transaction.PublishedFingerprint!);
            return;
        }

        if (expectedFingerprint is not null)
            throw new IOException("The published Mac bundle is no longer available for automatic rollback.");
        RestoreFiles(backup, spotify);
    }

    private static void RestoreFiles(BackupInfo backup, SpotifyInstallation spotify)
    {
        foreach (var file in backup.Manifest.Files)
        {
            var source = SafePath(Path.Combine(backup.Directory, FilesFolder), file.RelativePath);
            var target = SafePath(spotify.InstallPath!, file.RelativePath);
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
            .GroupBy(b => (b.Manifest.SpotifyVersion, b.Manifest.Build?.Platform, b.Manifest.Build?.Architecture,
                b.Manifest.Build?.ResourceFingerprint, b.Manifest.Build?.SnapshotSha256))
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

    public BackupInfo? FindPristine(SpotifyInstallation spotify) =>
        List().FirstOrDefault(backup => backup.Manifest.IsPristine && RestoreBlocker(backup, spotify with { IsRunning = false }) is null);

    public static string BundlePath(BackupInfo backup) => Path.Combine(backup.Directory, "bundle", "Spotify.app");

    private static string SafePath(string root, string relative)
    {
        var fullRoot = Path.GetFullPath(root) + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(Path.Combine(root, relative));
        if (Path.IsPathRooted(relative) || !full.StartsWith(fullRoot, OperatingSystem.IsWindows()
                ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
            throw new InvalidDataException("A backup path escapes its directory.");
        return full;
    }

    private static (IReadOnlyList<BackupFile> Files, IReadOnlyList<BackupLink> Links) BundleRecords(string root)
    {
        var files = new List<BackupFile>();
        var links = new List<BackupLink>();
        void Visit(string directory)
        {
            foreach (var info in new DirectoryInfo(directory).EnumerateFileSystemInfos())
            {
                var relative = Path.GetRelativePath(root, info.FullName);
                if (info.LinkTarget is { } target)
                {
                    var destination = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(info.FullName)!, target));
                    if (!destination.StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                        throw new InvalidDataException("Spotify's bundle has a link outside its directory.");
                    links.Add(new(relative, target));
                }
                else if (info is DirectoryInfo child) Visit(child.FullName);
                else files.Add(new(relative, ((FileInfo)info).Length, FileHash.Sha256(info.FullName),
                    OperatingSystem.IsWindows() ? null : (int)File.GetUnixFileMode(info.FullName)));
            }
        }
        Visit(root);
        return (files.OrderBy(f => f.RelativePath, StringComparer.Ordinal).ToArray(),
            links.OrderBy(l => l.RelativePath, StringComparer.Ordinal).ToArray());
    }

    private static string? ExecutableHash(SpotifyInstallation spotify)
    {
        try
        {
            return spotify.ExecutablePath is { } exe && File.Exists(exe) ? FileHash.Sha256(exe) : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

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
        Directory.EnumerateFiles(directory, "*", new EnumerationOptions { RecurseSubdirectories = true,
            AttributesToSkip = FileAttributes.ReparsePoint, IgnoreInaccessible = false }).Sum(f => new FileInfo(f).Length);

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

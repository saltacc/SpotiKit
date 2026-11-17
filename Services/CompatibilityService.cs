using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using SpotiKit.Models;

namespace SpotiKit.Services;

public sealed class CompatibilityService
{
    public Task<IReadOnlyList<CompatibilityResult>> RunAsync(SpotifyInstallation spotify,
        SpotifyVersionList versions, BackupInfo? originalBackup) =>
        Task.Run<IReadOnlyList<CompatibilityResult>>(() =>
        [
            CheckOperatingSystem(),
            CheckClient(spotify),
            CheckUiFiles(spotify),
            CheckOtherMods(spotify),
            CheckVersion(spotify, versions),
            CheckWriteAccess(spotify),
            CheckRunning(spotify),
            CheckDiskSpace(spotify),
            CheckBackup(spotify, originalBackup),
        ]);

    private static CompatibilityResult CheckOperatingSystem()
    {
        const string title = "Operating system";
        if (OperatingSystem.IsWindowsVersionAtLeast(10))
        {
            var build = Environment.OSVersion.Version.Build;
            return new(title, $"{(build >= 22000 ? "Windows 11" : "Windows 10")} (build {build})", StatusKind.Success, "IconWindows");
        }

        return new(title, $"{Environment.OSVersion.VersionString}. SpotiKit is only tested on Windows so far",
            StatusKind.Warning, "IconWindows");
    }

    private static CompatibilityResult CheckClient(SpotifyInstallation spotify) => spotify.Edition switch
    {
        SpotifyEdition.Desktop => new("Spotify client", $"Desktop app at {spotify.InstallPath}", StatusKind.Success, "IconMusic"),
        SpotifyEdition.MicrosoftStore => new("Spotify client",
            "The Microsoft Store version can't be changed. Install Spotify from spotify.com",
            StatusKind.Error, "IconMusic"),
        _ => new("Spotify client", "Not found. Install Spotify from spotify.com", StatusKind.Error, "IconMusic"),
    };

    private static CompatibilityResult CheckUiFiles(SpotifyInstallation spotify)
    {
        const string title = "Spotify files";
        if (spotify.Edition != SpotifyEdition.Desktop)
            return new(title, "Needs the desktop app", StatusKind.Neutral, "IconPuzzle");

        return spotify switch
        {
            { XpuiKind: XpuiKind.Folder } => new(title,
                "Spotify's files are unpacked, probably by another mod like Spicetify. Restore Spotify with it first",
                StatusKind.Error, "IconPuzzle"),
            { XpuiKind: XpuiKind.Missing } => new(title, "Spotify's files are missing. Reinstall Spotify",
                StatusKind.Error, "IconPuzzle"),
            { Xpui: { IsReadable: false } x } => new(title, $"Spotify's files can't be read: {x.Error}", StatusKind.Error, "IconPuzzle"),
            { Xpui: { HasIndex: false } or { HasBodyAnchor: false } } => new(title,
                "This Spotify version is built differently than SpotiKit expects", StatusKind.Error, "IconPuzzle"),
            { Xpui: { } x } => new(title,
                "Look as expected", StatusKind.Success, "IconPuzzle"),
            _ => new(title, "Couldn't be checked", StatusKind.Warning, "IconPuzzle"),
        };
    }

    private static CompatibilityResult CheckOtherMods(SpotifyInstallation spotify)
    {
        const string title = "Other mods";
        if (spotify.Edition != SpotifyEdition.Desktop)
            return new(title, "Needs the desktop app", StatusKind.Neutral, "IconBolt");

        if (spotify.Xpui is { ForeignMods.Count: > 0 } x)
            return new(title, $"{string.Join(" and ", x.ForeignMods)} found. Remove it before installing SpotiKit",
                StatusKind.Error, "IconBolt");
        if (SpotifyService.HasBlockTheSpot(spotify))
            return new(title, "BlockTheSpot found. It may work alongside SpotiKit, but that's untested",
                StatusKind.Warning, "IconBolt");
        return new(title, "None found", StatusKind.Success, "IconBolt");
    }

    private static CompatibilityResult CheckVersion(SpotifyInstallation spotify, SpotifyVersionList versions)
    {
        const string title = "Spotify version";
        if (!spotify.IsInstalled)
            return new(title, "Waiting for a Spotify installation", StatusKind.Neutral, "IconShield");
        if (spotify.Version is null)
            return new(title, "The version could not be read", StatusKind.Warning, "IconShield");

        return versions.Find(spotify.Version) switch
        {
            { Status: SpotifyVersionStatus.Broken } entry => new(title,
                $"{spotify.Version} doesn't work with SpotiKit" + (entry.Notes is { Length: > 0 } n ? $": {n}" : ""),
                StatusKind.Error, "IconShield"),
            { } entry when entry.NeedsNewerApp(AppInfo.Version) => new(title,
                $"{spotify.Version} needs SpotiKit {entry.MinApp}. Update on the Updates page",
                StatusKind.Warning, "IconShield"),
            { } entry => new(title,
                $"{spotify.Version}, supported",
                StatusKind.Success, "IconShield"),
            null => new(title, $"{spotify.Version} isn't supported yet. It may work, but it hasn't been tested",
                StatusKind.Warning, "IconShield"),
        };
    }

    private static CompatibilityResult CheckWriteAccess(SpotifyInstallation spotify)
    {
        const string title = "Write access";
        if (spotify is not { Edition: SpotifyEdition.Desktop, InstallPath: { } installPath })
            return new(title, "Needs the desktop app", StatusKind.Neutral, "IconLock");

        var target = Path.Combine(installPath, "Apps");
        try
        {
            var probe = Path.Combine(Directory.Exists(target) ? target : installPath, $".spotikit-probe-{Guid.NewGuid():N}");
            File.WriteAllBytes(probe, []);
            File.Delete(probe);
            return new(title, "OK", StatusKind.Success, "IconLock");
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or IOException)
        {
            return new(title, "Spotify's folder is read-only for your account", StatusKind.Error, "IconLock");
        }
    }

    private static CompatibilityResult CheckRunning(SpotifyInstallation spotify) =>
        spotify.IsRunning
            ? new("Running processes", "Spotify is open. Installing closes it and starts it again", StatusKind.Warning, "IconPlay")
            : new("Running processes", "Spotify is closed", StatusKind.Success, "IconPlay");

    private static CompatibilityResult CheckDiskSpace(SpotifyInstallation spotify)
    {
        const string title = "Disk space";
        try
        {
            var root = Path.GetPathRoot(spotify.InstallPath ?? Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));
            if (string.IsNullOrEmpty(root))
                return new(title, "The drive could not be determined", StatusKind.Warning, "IconDisk");

            var needed = (spotify.XpuiPath is { } xpui && File.Exists(xpui) ? new FileInfo(xpui).Length * 3 : 0) + 20L * 1024 * 1024;
            var free = new DriveInfo(root).AvailableFreeSpace;
            var freeText = $"{free / 1024d / 1024 / 1024:0.#} GB free";
            return free >= needed
                ? new(title, freeText, StatusKind.Success, "IconDisk")
                : new(title, $"{freeText}, about {needed / 1024 / 1024} MB needed", StatusKind.Error, "IconDisk");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return new(title, "Free space could not be read", StatusKind.Warning, "IconDisk");
        }
    }

    private static CompatibilityResult CheckBackup(SpotifyInstallation spotify, BackupInfo? original)
    {
        const string title = "Original backup";
        if (spotify.Edition != SpotifyEdition.Desktop)
            return new(title, "Needs the desktop app", StatusKind.Neutral, "IconBackup");
        return original is not null
            ? new(title, $"Saved {original.Manifest.CreatedAt:g}",
                StatusKind.Success, "IconBackup")
            : new(title, spotify.HasSpotiKit
                    ? "None for this version. Uninstalling still restores Spotify"
                    : "Made automatically before the first install",
                StatusKind.Neutral, "IconBackup");
    }
}

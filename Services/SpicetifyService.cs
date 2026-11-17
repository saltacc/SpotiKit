using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using SpotiKit.Models;

namespace SpotiKit.Services;

public sealed record SpicetifyFolders(string Config, string Binary, string LegacyBinary)
{
    public static SpicetifyFolders FromEnvironment()
    {
        var config = Environment.GetEnvironmentVariable("SPICETIFY_CONFIG");
        return new(
            string.IsNullOrWhiteSpace(config)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "spicetify")
                : config,
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "spicetify"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "spicetify-cli"));
    }
}

public sealed record SpicetifyStatus(bool HasConfig, string? Binary, bool IsApplied, string? PackageManagerCommand)
{
    public static SpicetifyStatus None { get; } = new(false, null, false, null);

    public bool IsPresent => HasConfig || Binary is not null || IsApplied || PackageManagerCommand is not null;
}

public sealed record SpicetifyRemoval(bool Succeeded, string Message, string? PackageManagerCommand = null);

public sealed partial class SpicetifyService(SpotiKitPaths paths, ActivityLog log, SpicetifyFolders? folders = null,
    Func<string?>? readUserPath = null, Action<string>? writeUserPath = null)
{
    private const string Operation = "Spicetify";

    private readonly SpicetifyFolders _folders = folders ?? SpicetifyFolders.FromEnvironment();
    private readonly Func<string?> _readUserPath = readUserPath ?? ReadUserPath;
    private readonly Action<string> _writeUserPath = writeUserPath ?? WriteUserPath;

    private static string? ReadUserPath()
    {
        if (!OperatingSystem.IsWindows())
            return null;
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey("Environment");
        return key?.GetValue("Path", null, Microsoft.Win32.RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
    }

    private static void WriteUserPath(string value)
    {
        if (!OperatingSystem.IsWindows())
            return;
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey("Environment", writable: true);
        key?.SetValue("Path", value, Microsoft.Win32.RegistryValueKind.ExpandString);
    }

    [GeneratedRegex(@"^\s*\[Backup\]\s*$(?<body>[\s\S]*?)(?=^\s*\[|\z)", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex BackupSection();

    [GeneratedRegex(@"^\s*version\s*=\s*(?<v>\S*)\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex VersionKey();

    private IEnumerable<string> OwnBinaryFolders => [_folders.Binary, _folders.LegacyBinary];

    public SpicetifyStatus Detect(SpotifyInstallation spotify)
    {
        var binary = OwnBinaryFolders.Select(f => Path.Combine(f, "spicetify.exe")).FirstOrDefault(File.Exists);
        var applied = spotify.XpuiKind == XpuiKind.Folder || spotify.Xpui is { ForeignMods: var mods } && mods.Contains("Spicetify");
        return new SpicetifyStatus(Directory.Exists(_folders.Config), binary, applied, binary is null ? PackageManagerCommand() : null);
    }

    public SpicetifyRemoval Remove(SpotifyInstallation spotify, bool keepSettings)
    {
        var status = Detect(spotify);
        if (status.IsApplied && spotify.IsRunning)
            return Fail("Spotify is running. Close it first.");

        if (status.IsApplied)
        {
            if (Restore(spotify) is { } problem)
                return Fail(problem);
        }

        foreach (var folder in OwnBinaryFolders.Concat(keepSettings ? [] : [_folders.Config]).Where(Directory.Exists))
        {
            try
            {
                Directory.Delete(folder, recursive: true);
                log.Info(Operation, $"Deleted {folder}");
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                log.Warning(Operation, $"Couldn't delete {folder}: {ex.Message}", "Delete it yourself once nothing uses it.");
            }
        }
        RemoveFromPath();

        var command = PackageManagerCommand();
        var message = (status.IsApplied ? "Spotify has its own files again" : "Spotify wasn't changed by Spicetify") +
                      (keepSettings ? ". Spicetify is removed; its settings, themes and extensions are kept." : ", and Spicetify is removed.");
        log.Success(Operation, message);
        if (command is not null)
            log.Warning(Operation, "Spicetify itself was installed with a package manager.", $"Remove it with: {command}");
        return new SpicetifyRemoval(true, message, command);
    }

    private string? Restore(SpotifyInstallation spotify)
    {
        if (spotify.InstallPath is not { } spotifyDir)
            return "Spotify wasn't found.";
        var backup = Path.Combine(_folders.Config, "Backup");
        var spas = Directory.Exists(backup) ? Directory.GetFiles(backup, "*.spa") : [];
        var backupXpui = spas.FirstOrDefault(f => string.Equals(Path.GetFileName(f), "xpui.spa", StringComparison.OrdinalIgnoreCase));
        if (backupXpui is null)
            return "Spicetify has no backup of Spotify's files. Reinstall Spotify from spotify.com, then try again.";

        var backedUp = BackupVersion();
        if (!string.IsNullOrEmpty(backedUp) && spotify.Version is { } version &&
            !backedUp.StartsWith(version, StringComparison.OrdinalIgnoreCase) && !version.StartsWith(backedUp, StringComparison.OrdinalIgnoreCase))
            return $"Spicetify's backup is from Spotify {backedUp}, this is {spotify.Version}. Reinstall Spotify from spotify.com, then try again.";

        if (XpuiPatcher.Inspect(backupXpui) is not { IsReadable: true, HasIndex: true, ForeignMods.Count: 0 })
            return "Spicetify's backup of Spotify's files is damaged. Reinstall Spotify from spotify.com, then try again.";

        var apps = Path.Combine(spotifyDir, "Apps");
        var keep = Path.Combine(paths.DataRoot, "Spicetify backup", DateTime.Now.ToString("yyyyMMdd-HHmmss"));
        try
        {
            Directory.CreateDirectory(keep);
            var kept = Path.Combine(keep, "Apps");
            MoveFolder(apps, kept);
            log.Info(Operation, $"Spotify's changed files are kept in {kept}");
            try
            {
                Directory.CreateDirectory(apps);
                foreach (var spa in spas)
                    File.Copy(spa, Path.Combine(apps, Path.GetFileName(spa)));
                if (XpuiPatcher.Inspect(Path.Combine(apps, "xpui.spa")) is not { IsReadable: true, HasIndex: true, ForeignMods.Count: 0 })
                    throw new IOException("The restored files don't check out.");
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                if (Directory.Exists(apps))
                    Directory.Delete(apps, recursive: true);
                MoveFolder(kept, apps);
                log.Warning(Operation, $"Restoring failed, so Spotify's files were put back as they were: {ex.Message}");
                return "Spotify's files couldn't be restored. Nothing was changed.";
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return $"Spotify's files couldn't be moved: {ex.Message}";
        }

        log.Success(Operation, $"Restored {spas.Length} file(s) from Spicetify's backup.");
        return null;
    }

    private string? BackupVersion()
    {
        var ini = Path.Combine(_folders.Config, "config-xpui.ini");
        if (!File.Exists(ini))
            return null;
        var section = BackupSection().Match(File.ReadAllText(ini));
        return section.Success && VersionKey().Match(section.Groups["body"].Value) is { Success: true } m ? m.Groups["v"].Value : null;
    }

    private void RemoveFromPath()
    {
        var current = _readUserPath();
        if (string.IsNullOrEmpty(current))
            return;
        var own = OwnBinaryFolders.Select(f => f.TrimEnd('\\', '/')).ToList();
        var parts = current.Split(';');
        var kept = parts.Where(p => !own.Any(o => string.Equals(Environment.ExpandEnvironmentVariables(p).Trim().TrimEnd('\\', '/'), o,
            StringComparison.OrdinalIgnoreCase))).ToArray();
        if (kept.Length == parts.Length)
            return;
        _writeUserPath(string.Join(';', kept));
        log.Info(Operation, "Removed Spicetify from PATH.");
    }

    private string? PackageManagerCommand()
    {
        var path = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries);
        foreach (var dir in path)
        {
            string? found;
            try
            {
                found = new[] { "spicetify.exe", "spicetify.cmd", "spicetify.ps1" }.Select(n => Path.Combine(dir.Trim(), n)).FirstOrDefault(File.Exists);
            }
            catch (ArgumentException)
            {
                continue;
            }
            if (found is null || OwnBinaryFolders.Any(f => found.StartsWith(f, StringComparison.OrdinalIgnoreCase)))
                continue;
            if (found.Contains(@"\scoop\", StringComparison.OrdinalIgnoreCase))
                return "scoop uninstall spicetify-cli";
            if (found.Contains("WinGet", StringComparison.OrdinalIgnoreCase))
                return "winget uninstall Spicetify.Spicetify";
            if (found.Contains("chocolatey", StringComparison.OrdinalIgnoreCase))
                return "choco uninstall spicetify-cli";
            return $"delete {found}";
        }
        return null;
    }

    private static void MoveFolder(string from, string to)
    {
        if (string.Equals(Path.GetPathRoot(from), Path.GetPathRoot(to), StringComparison.OrdinalIgnoreCase))
        {
            Directory.Move(from, to);
            return;
        }
        foreach (var file in Directory.EnumerateFiles(from, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(to, Path.GetRelativePath(from, file));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target);
        }
        Directory.Delete(from, recursive: true);
    }

    private SpicetifyRemoval Fail(string message)
    {
        log.Warning(Operation, message);
        return new SpicetifyRemoval(false, message);
    }
}

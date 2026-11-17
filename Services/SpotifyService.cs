using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.Versioning;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;
using SpotiKit.Models;

namespace SpotiKit.Services;

public sealed class SpotifyService(SpotiKitPaths paths)
{
    private const string StorePackagePrefix = "SpotifyAB.SpotifyMusic_";

    internal Func<string[]> MacCandidateResources { get; init; } = DefaultMacCandidateResources;
    internal Func<string, int[]> MacProcessIds { get; init; } = MacBundleFiles.RunningProcessIds;
    internal Func<int, long?> MacProcessIdentity { get; init; } = ProcessStartIdentity;
    internal Func<int, bool>? MacQuitRequest { get; init; }

    public Task<SpotifyInstallation> DetectAsync() => Task.Run(() => Detect());

    public SpotifyInstallation Detect(bool freshBuild = false)
    {
        if (OperatingSystem.IsMacOS())
        {
            var resources = SelectedMacResources();
            if (resources is null) return SpotifyInstallation.NotFound;
            var executable = ResolveExecutable(resources);
            var selectedRunning = !IsSandboxed && executable is not null && MacProcessIds(executable).Length > 0;
            return Describe(resources, executable, selectedRunning, freshBuild);
        }

        var running = IsRunning();

        if (paths.SpotifyDirOverride is { } overrideDir)
            return Describe(overrideDir, ResolveExecutable(overrideDir), running, freshBuild);

        if (OperatingSystem.IsWindows())
        {
            foreach (var candidate in new[] { RegistryInstallLocation(), DefaultWindowsDir() })
            {
                if (candidate is not null && ResolveExecutable(candidate) is { } exe)
                    return Describe(candidate, exe, running, freshBuild);
            }

            var packagesDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Packages");
            var storePackage = Directory.Exists(packagesDir)
                ? Directory.EnumerateDirectories(packagesDir, StorePackagePrefix + "*").FirstOrDefault()
                : null;

            return storePackage is null
                ? SpotifyInstallation.NotFound
                : new SpotifyInstallation(SpotifyEdition.MicrosoftStore, null, storePackage, running);
        }

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string[] candidates =
            [
                "/usr/share/spotify",
                "/opt/spotify",
                Path.Combine(home, ".local/share/spotify-launcher/install/usr/share/spotify"),
                "/var/lib/flatpak/app/com.spotify.Client/x86_64/stable/active/files/extra/share/spotify",
            ];

        var found = candidates.FirstOrDefault(Directory.Exists);
        return found is null ? SpotifyInstallation.NotFound : Describe(found, ResolveExecutable(found), running, freshBuild);
    }

    public async Task<bool> CloseAsync(TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (IsSandboxed)
            return true;

        if (OperatingSystem.IsMacOS())
        {
            // Hold the selected executable fixed while waiting. If another app appears or the
            // selected bundle is moved, a later poll must not switch to a different Spotify copy.
            var executable = SelectedMacExecutable();
            if (executable is null) return true;
            try
            {
                var started = DateTime.UtcNow.Ticks;
                var initial = MacProcessIds(executable).Distinct()
                    .Select(pid => (Pid: pid, Identity: MacProcessIdentity(pid)))
                    .Where(process => process.Identity is { } identity && identity <= started)
                    .ToDictionary(process => process.Pid, process => process.Identity!.Value);
                bool IsInitialProcess(int pid) => initial.TryGetValue(pid, out var identity) && MacProcessIdentity(pid) == identity;
                int[] Remaining() => MacProcessIds(executable).Concat(initial.Keys.Where(IsInitialProcess)).Distinct().ToArray();
                var requestQuit = MacQuitRequest ?? MacProcessControl.RequestQuit;
                bool QuitSelected(int pid) => !MacProcessIds(executable).Contains(pid) && !IsInitialProcess(pid) || requestQuit(pid);

                // A moved executable stops matching its old path before the process exits.
                // Its start identity keeps it in the wait without treating a reused PID as ours.
                return await MacProcessControl.QuitAsync(timeout, Remaining, QuitSelected, cancellationToken);
            }
            catch (System.ComponentModel.Win32Exception)
            {
                // Do not report a successful close if the OS cannot confirm a process identity.
                return false;
            }
        }

        foreach (var process in Process.GetProcessesByName("Spotify"))
        {
            using (process)
            {
                try
                {
                    if (process.MainWindowHandle != IntPtr.Zero)
                        process.CloseMainWindow();
                }
                catch (InvalidOperationException)
                {
                }
            }
        }

        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (!IsRunning())
                return true;
            await Task.Delay(250, cancellationToken);
        }

        foreach (var process in Process.GetProcessesByName("Spotify"))
        {
            using (process)
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                }
                catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
                {
                }
            }
        }
        for (var i = 0; i < 20 && IsRunning(); i++)
            await Task.Delay(250, cancellationToken);
        return !IsRunning();
    }

    public void Launch(SpotifyInstallation spotify, params string[] arguments)
    {
        if (!IsSandboxed && spotify.ExecutablePath is { } exe && File.Exists(exe))
        {
            var bundle = OperatingSystem.IsMacOS() && spotify.InstallPath is { } dir ? MacApplicationBundle.FromResources(dir) : null;
            var start = new ProcessStartInfo(bundle is null ? exe : "/usr/bin/open") { UseShellExecute = bundle is null };
            if (bundle is not null)
            {
                start.ArgumentList.Add("-a");
                start.ArgumentList.Add(bundle);
                start.ArgumentList.Add("--args");
            }
            foreach (var argument in arguments)
                start.ArgumentList.Add(argument);
            Process.Start(start);
        }
    }

    public static bool HasBlockTheSpot(SpotifyInstallation spotify) =>
        spotify.InstallPath is { } dir && File.Exists(Path.Combine(dir, "dpapi.dll"));

    private static SpotifyInstallation Describe(string installDir, string? executable, bool running, bool freshBuild)
    {
        var version = MacApplicationBundle.ReadVersion(installDir) ?? (executable is not null && File.Exists(executable)
            ? NormaliseVersion(FileVersionInfo.GetVersionInfo(executable).FileVersion)
            : null);

        var appsDir = Path.Combine(installDir, "Apps");
        var spa = Path.Combine(appsDir, "xpui.spa");
        var folder = Path.Combine(appsDir, "xpui");
        var (kind, xpuiPath) = File.Exists(spa) ? (XpuiKind.Spa, spa)
            : Directory.Exists(folder) ? (XpuiKind.Folder, folder)
            : (XpuiKind.Missing, (string?)null);

        if (executable is null && kind == XpuiKind.Missing)
            return SpotifyInstallation.NotFound;

        return new SpotifyInstallation(
            SpotifyEdition.Desktop,
            version,
            installDir,
            running,
            executable,
            kind,
            xpuiPath,
            kind == XpuiKind.Spa ? XpuiPatcher.Inspect(spa) : null)
        {
            Build = SpotifyBuildDetector.Read(installDir, executable, kind == XpuiKind.Spa ? spa : null, freshBuild),
        };
    }

    private static string? ResolveExecutable(string dir)
    {
        string[] names = MacApplicationBundle.FromResources(dir) is not null ? ["../MacOS/Spotify"]
            : OperatingSystem.IsWindows() ? ["Spotify.exe"] : ["spotify", "Spotify"];
        return names.Select(n => Path.GetFullPath(Path.Combine(dir, n))).FirstOrDefault(File.Exists);
    }

    private static string? NormaliseVersion(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;
        var parts = raw.Trim().Split('.').TakeWhile(p => p.All(char.IsDigit) && p.Length > 0).ToArray();
        return parts.Length >= 2 ? string.Join('.', parts) : raw.Trim();
    }

    private static string DefaultWindowsDir() =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Spotify");

    private static string[] DefaultMacCandidateResources() =>
        ["/Applications/Spotify.app/Contents/Resources",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Applications/Spotify.app/Contents/Resources")];

    private string? SelectedMacResources() => paths.SpotifyDirOverride ?? MacCandidateResources().FirstOrDefault(Directory.Exists);

    private string? SelectedMacExecutable() => SelectedMacResources() is { } resources ? ResolveExecutable(resources) : null;

    [SupportedOSPlatform("windows")]
    private static string? RegistryInstallLocation()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Spotify");
            return key?.GetValue("InstallLocation") as string;
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or System.Security.SecurityException or IOException)
        {
            return null;
        }
    }

    public bool IsSandboxed => paths.SpotifyDirOverride is not null && !paths.AllowSpotifyControl;

    public static string QuitHint => OperatingSystem.IsMacOS()
        ? "In Spotify, choose Spotify > Quit Spotify (⌘Q), then try again. If it is unresponsive, use Apple menu > Force Quit."
        : "Quit Spotify from the tray icon (right-click, Quit) and try again.";

    private int[] RunningProcessIds()
    {
        if (OperatingSystem.IsMacOS())
            return SelectedMacExecutable() is { } executable ? MacProcessIds(executable) : [];
        var expected = paths.SpotifyDirOverride is { } dir ? ResolveExecutable(dir) : null;
        var processes = Process.GetProcessesByName("Spotify");
        try
        {
            return processes.Where(process => expected is null || MatchesExecutable(process, expected)).Select(process => process.Id).ToArray();
        }
        finally
        {
            foreach (var process in processes)
                process.Dispose();
        }
    }

    private static bool MatchesExecutable(Process process, string expected)
    {
        try { return string.Equals(process.MainModule?.FileName, expected, OperatingSystem.IsWindows()
            ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal); }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception) { return false; }
    }

    private static long? ProcessStartIdentity(int pid)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            return process.HasExited ? null : process.StartTime.ToUniversalTime().Ticks;
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException) { return null; }
    }

    public TimeSpan? RunningFor()
    {
        if (IsSandboxed)
            return null;
        DateTime? earliest = null;
        foreach (var pid in RunningProcessIds())
        {
            try
            {
                using var process = Process.GetProcessById(pid);
                if (earliest is null || process.StartTime < earliest)
                    earliest = process.StartTime;
            }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
        }
        return earliest is { } start ? DateTime.Now - start : null;
    }

    public bool IsRunning()
    {
        if (IsSandboxed)
            return false;

        return RunningProcessIds().Length > 0;
    }
}

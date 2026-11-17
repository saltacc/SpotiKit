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

    public Task<SpotifyInstallation> DetectAsync() => Task.Run(Detect);

    public SpotifyInstallation Detect()
    {
        var running = IsRunning();

        if (paths.SpotifyDirOverride is { } overrideDir)
            return Describe(overrideDir, ResolveExecutable(overrideDir), running);

        if (OperatingSystem.IsWindows())
        {
            foreach (var candidate in new[] { RegistryInstallLocation(), DefaultWindowsDir() })
            {
                if (candidate is not null && ResolveExecutable(candidate) is { } exe)
                    return Describe(candidate, exe, running);
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
        string[] candidates = OperatingSystem.IsMacOS()
            ? ["/Applications/Spotify.app/Contents/Resources", Path.Combine(home, "Applications/Spotify.app/Contents/Resources")]
            :
            [
                "/usr/share/spotify",
                "/opt/spotify",
                Path.Combine(home, ".local/share/spotify-launcher/install/usr/share/spotify"),
                "/var/lib/flatpak/app/com.spotify.Client/x86_64/stable/active/files/extra/share/spotify",
            ];

        var found = candidates.FirstOrDefault(Directory.Exists);
        return found is null ? SpotifyInstallation.NotFound : Describe(found, ResolveExecutable(found), running);
    }

    public async Task<bool> CloseAsync(TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        if (IsSandboxed)
            return true;

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

    public void Launch(SpotifyInstallation spotify, string? arguments = null)
    {
        if (!IsSandboxed && spotify.ExecutablePath is { } exe && File.Exists(exe))
            Process.Start(new ProcessStartInfo(exe, arguments ?? "") { UseShellExecute = true });
    }

    public static bool HasBlockTheSpot(SpotifyInstallation spotify) =>
        spotify.InstallPath is { } dir && File.Exists(Path.Combine(dir, "dpapi.dll"));

    private static SpotifyInstallation Describe(string installDir, string? executable, bool running)
    {
        var version = executable is not null && File.Exists(executable)
            ? NormaliseVersion(FileVersionInfo.GetVersionInfo(executable).FileVersion)
            : null;

        var appsDir = Path.Combine(installDir, "Apps");
        var spa = Path.Combine(appsDir, "xpui.spa");
        var folder = Path.Combine(appsDir, "xpui");
        var (kind, xpuiPath) = File.Exists(spa) ? (XpuiKind.Spa, spa)
            : Directory.Exists(folder) ? (XpuiKind.Folder, folder)
            : (XpuiKind.Missing, (string?)null);

        return new SpotifyInstallation(
            SpotifyEdition.Desktop,
            version,
            installDir,
            running,
            executable,
            kind,
            xpuiPath,
            kind == XpuiKind.Spa ? XpuiPatcher.Inspect(spa) : null);
    }

    private static string? ResolveExecutable(string dir)
    {
        string[] names = OperatingSystem.IsWindows() ? ["Spotify.exe"] : ["spotify", "Spotify", "../MacOS/Spotify"];
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

    public bool IsSandboxed => paths.SpotifyDirOverride is not null;

    public TimeSpan? RunningFor()
    {
        if (IsSandboxed)
            return null;
        DateTime? earliest = null;
        foreach (var process in Process.GetProcessesByName("Spotify"))
        {
            using (process)
            {
                try
                {
                    if (earliest is null || process.StartTime < earliest)
                        earliest = process.StartTime;
                }
                catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
                {
                }
            }
        }
        return earliest is { } start ? DateTime.Now - start : null;
    }

    public bool IsRunning()
    {
        if (IsSandboxed)
            return false;

        var processes = Process.GetProcessesByName("Spotify");
        foreach (var process in processes)
            process.Dispose();
        return processes.Length > 0;
    }
}

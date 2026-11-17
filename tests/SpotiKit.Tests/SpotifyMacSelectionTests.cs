using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class SpotifyMacSelectionTests
{
    [MacOSFact]
    public async Task Other_Spotify_copies_are_not_reported_as_running_or_sent_a_quit_request()
    {
        using var box = new Sandbox();
        var system = CreateClient(box.Root, "Applications");
        var home = CreateClient(box.Root, "User Applications");
        var development = CreateClient(box.Root, "Development");
        var running = new Dictionary<string, int[]>
        {
            [Executable(system)] = [], [Executable(home)] = [42], [Executable(development)] = [43],
        };
        var lookups = new List<string>();
        var service = new SpotifyService(box.Paths with { SpotifyDirOverride = null, IsSandboxed = false })
        {
            MacCandidateResources = () => [system, home],
            MacProcessIds = executable => { lookups.Add(executable); return running[executable]; },
            MacProcessIdentity = pid => running[Executable(system)].Contains(pid) ? 410 : null,
            MacQuitRequest = _ => throw new InvalidOperationException("Another Spotify app must not be closed"),
        };

        Assert.False(service.IsSandboxed);
        Assert.Equal(system, service.Detect().InstallPath);
        Assert.False(service.Detect().IsRunning);
        Assert.False(service.IsRunning());
        Assert.Null(service.RunningFor());
        Assert.True(await service.CloseAsync(TimeSpan.Zero));
        Assert.NotEmpty(lookups);
        Assert.All(lookups, path => Assert.Equal(Executable(system), path));
    }

    [MacOSFact]
    public async Task Normal_mode_closes_only_the_system_app_when_both_locations_are_installed()
    {
        using var box = new Sandbox();
        var system = CreateClient(box.Root, "Applications");
        var home = CreateClient(box.Root, "User Applications");
        var running = new Dictionary<string, int[]> { [Executable(system)] = [41], [Executable(home)] = [42] };
        var requests = new List<int>();
        var service = new SpotifyService(box.Paths with { SpotifyDirOverride = null, IsSandboxed = false })
        {
            MacCandidateResources = () => [system, home],
            MacProcessIds = executable => running[executable],
            MacProcessIdentity = pid => running[Executable(system)].Contains(pid) ? 410 : null,
            MacQuitRequest = processId => { requests.Add(processId); running[Executable(system)] = []; return true; },
        };

        Assert.True(service.Detect().IsRunning);
        Assert.True(await service.CloseAsync(TimeSpan.Zero));
        Assert.Equal(new[] { 41 }, requests);
        Assert.Equal(new[] { 42 }, running[Executable(home)]);
        Assert.False(service.IsRunning());
    }

    [MacOSFact]
    public async Task The_user_app_is_selected_when_the_system_location_is_absent()
    {
        using var box = new Sandbox();
        var missing = Path.Combine(box.Root, "Applications", "Spotify.app", "Contents", "Resources");
        var home = CreateClient(box.Root, "User Applications");
        var requests = new List<int>();
        var running = true;
        var service = new SpotifyService(box.Paths with { SpotifyDirOverride = null, IsSandboxed = false })
        {
            MacCandidateResources = () => [missing, home],
            MacProcessIds = executable => { Assert.Equal(Executable(home), executable); return running ? [42] : []; },
            MacProcessIdentity = pid => running && pid == 42 ? 420 : null,
            MacQuitRequest = processId => { requests.Add(processId); running = false; return true; },
        };

        Assert.Equal(home, service.Detect().InstallPath);
        Assert.True(service.IsRunning());
        Assert.True(await service.CloseAsync(TimeSpan.Zero));
        Assert.Equal(new[] { 42 }, requests);
    }

    [MacOSFact]
    public async Task A_quit_operation_keeps_its_target_if_the_selected_bundle_moves_while_exiting()
    {
        using var box = new Sandbox();
        var system = CreateClient(box.Root, "Applications");
        var home = CreateClient(box.Root, "User Applications");
        var requests = new List<int>();
        var running = true;
        var service = new SpotifyService(box.Paths with { SpotifyDirOverride = null, IsSandboxed = false })
        {
            MacCandidateResources = () => [system, home],
            MacProcessIds = executable =>
            {
                Assert.Equal(Executable(system), executable);
                return running ? [41] : [];
            },
            MacProcessIdentity = pid => running && pid == 41 ? 410 : null,
            MacQuitRequest = processId =>
            {
                requests.Add(processId);
                running = false;
                Directory.Move(Path.GetFullPath(Path.Combine(system, "../..")), Path.Combine(box.Root, "Moved.app"));
                return true;
            },
        };

        Assert.True(await service.CloseAsync(TimeSpan.Zero));
        Assert.Equal(new[] { 41 }, requests);
        // New checks can select the remaining user installation; the completed quit never did.
        Assert.True(Directory.Exists(home));
    }

    [MacOSFact]
    public async Task A_moved_but_still_running_selected_process_is_not_reported_as_closed()
    {
        using var box = new Sandbox();
        var system = CreateClient(box.Root, "Applications");
        var home = CreateClient(box.Root, "User Applications");
        var moved = false;
        var requests = new List<int>();
        var service = new SpotifyService(box.Paths with { SpotifyDirOverride = null, IsSandboxed = false })
        {
            MacCandidateResources = () => [system, home],
            MacProcessIds = executable =>
            {
                Assert.Equal(Executable(system), executable);
                return moved ? [] : [41];
            },
            MacProcessIdentity = pid => pid == 41 ? 410 : null,
            MacQuitRequest = pid =>
            {
                requests.Add(pid);
                Directory.Move(Path.GetFullPath(Path.Combine(system, "../..")), Path.Combine(box.Root, "Moved.app"));
                moved = true;
                return true;
            },
        };

        Assert.False(await service.CloseAsync(TimeSpan.Zero));
        Assert.Equal(new[] { 41 }, requests);
        Assert.True(Directory.Exists(home));
    }

    [MacOSFact]
    public async Task A_moved_selected_process_is_waited_for_until_its_original_identity_exits()
    {
        using var box = new Sandbox();
        var system = CreateClient(box.Root, "Applications");
        var home = CreateClient(box.Root, "User Applications");
        var moved = false;
        var checksAfterMove = 0;
        var requests = new List<int>();
        var service = new SpotifyService(box.Paths with { SpotifyDirOverride = null, IsSandboxed = false })
        {
            MacCandidateResources = () => [system, home],
            MacProcessIds = executable =>
            {
                Assert.Equal(Executable(system), executable);
                return moved ? [] : [41];
            },
            MacProcessIdentity = pid => pid != 41 || moved && ++checksAfterMove >= 3 ? null : 410,
            MacQuitRequest = pid =>
            {
                requests.Add(pid);
                Directory.Move(Path.GetFullPath(Path.Combine(system, "../..")), Path.Combine(box.Root, "Moved.app"));
                moved = true;
                return true;
            },
        };

        Assert.True(await service.CloseAsync(TimeSpan.FromSeconds(2)));
        Assert.True(checksAfterMove >= 3);
        Assert.Equal(new[] { 41 }, requests);
        Assert.True(Directory.Exists(home));
    }

    [MacOSFact]
    public async Task A_reused_initial_PID_is_neither_waited_for_nor_sent_a_quit_request()
    {
        using var box = new Sandbox();
        var system = CreateClient(box.Root, "Applications");
        var home = CreateClient(box.Root, "User Applications");
        var lookup = 0;
        var moved = false;
        long identity = 410;
        var service = new SpotifyService(box.Paths with { SpotifyDirOverride = null, IsSandboxed = false })
        {
            MacCandidateResources = () => [system, home],
            MacProcessIds = executable =>
            {
                Assert.Equal(Executable(system), executable);
                if (++lookup == 2)
                {
                    Directory.Move(Path.GetFullPath(Path.Combine(system, "../..")), Path.Combine(box.Root, "Moved.app"));
                    moved = true;
                    identity = 420;
                }
                return moved ? [] : [41];
            },
            MacProcessIdentity = _ => identity,
            MacQuitRequest = _ => throw new InvalidOperationException("The original process exited; its PID belongs to another app"),
        };

        Assert.True(await service.CloseAsync(TimeSpan.Zero));
        Assert.True(moved);
        Assert.True(Directory.Exists(home));
    }

    [MacOSFact]
    public async Task An_explicit_complete_development_target_retains_its_own_process_scope()
    {
        using var box = new Sandbox();
        var normal = CreateClient(box.Root, "Applications");
        var development = CreateClient(box.Root, "Development");
        var running = true;
        var requests = new List<int>();
        var service = new SpotifyService(box.Paths with { SpotifyDirOverride = development, AllowSpotifyControl = true })
        {
            MacCandidateResources = () => [normal],
            MacProcessIds = executable => { Assert.Equal(Executable(development), executable); return running ? [43] : []; },
            MacProcessIdentity = pid => running && pid == 43 ? 430 : null,
            MacQuitRequest = processId => { requests.Add(processId); running = false; return true; },
        };

        Assert.Equal(development, service.Detect().InstallPath);
        Assert.True(service.IsRunning());
        Assert.True(await service.CloseAsync(TimeSpan.Zero));
        Assert.Equal(new[] { 43 }, requests);
    }

    [MacOSFact]
    public async Task No_selected_installation_never_falls_back_to_process_name_matching()
    {
        using var box = new Sandbox();
        var service = new SpotifyService(box.Paths with { SpotifyDirOverride = null, IsSandboxed = false })
        {
            MacCandidateResources = () => [Path.Combine(box.Root, "Missing.app", "Contents", "Resources")],
            MacProcessIds = _ => throw new InvalidOperationException("No executable is selected"),
            MacQuitRequest = _ => throw new InvalidOperationException("No app should receive a quit request"),
        };

        Assert.False(service.Detect().IsInstalled);
        Assert.False(service.IsRunning());
        Assert.Null(service.RunningFor());
        Assert.True(await service.CloseAsync(TimeSpan.Zero));
    }

    [MacOSFact]
    public void Native_normal_mode_detects_only_the_selected_owned_process_with_the_same_name()
    {
        using var selected = new MacBundleTests.OwnedBundle();
        using var other = new MacBundleTests.OwnedBundle();
        File.Copy("/bin/sleep", selected.Client.ExecutablePath!, overwrite: true);
        File.Copy("/bin/sleep", other.Client.ExecutablePath!, overwrite: true);
        new MacBundleSigner().SignAndVerify(selected.Bundle);
        new MacBundleSigner().SignAndVerify(other.Bundle);
        var paths = new SpotiKitPaths(Path.Combine(selected.Root, "Data"), Path.Combine(selected.Root, "Data/settings.json"), null,
            Path.Combine(selected.Root, "SpotifyLocal"));
        var service = new SpotifyService(paths) { MacCandidateResources = () => [selected.Client.InstallPath!] };
        using var otherProcess = StartSleep(other.Client.ExecutablePath!);
        Process? selectedProcess = null;
        try
        {
            Thread.Sleep(50);
            Assert.False(otherProcess.HasExited);
            Assert.False(service.IsRunning());
            Assert.False(service.Detect().IsRunning);

            selectedProcess = StartSleep(selected.Client.ExecutablePath!);
            Thread.Sleep(50);
            Assert.False(selectedProcess.HasExited);
            Assert.True(service.IsRunning());
            Assert.True(service.Detect().IsRunning);
            Assert.True(service.RunningFor() is not null);

            selectedProcess.Kill();
            Assert.True(selectedProcess.WaitForExit(5000));
            Assert.False(otherProcess.HasExited);
            Assert.False(service.IsRunning());
        }
        finally
        {
            if (selectedProcess is not null)
            {
                if (!selectedProcess.HasExited) selectedProcess.Kill();
                selectedProcess.WaitForExit(5000);
                selectedProcess.Dispose();
            }
            if (!otherProcess.HasExited) otherProcess.Kill();
            otherProcess.WaitForExit(5000);
        }
    }

    private static string CreateClient(string root, string location)
    {
        var bundle = Path.Combine(root, location, "Spotify.app");
        var resources = Path.Combine(bundle, "Contents", "Resources");
        Directory.CreateDirectory(Path.Combine(resources, "Apps"));
        Directory.CreateDirectory(Path.Combine(bundle, "Contents", "MacOS"));
        File.WriteAllText(Path.Combine(bundle, "Contents", "Info.plist"),
            "<plist><dict><key>CFBundleShortVersionString</key><string>1.3.9.2055</string></dict></plist>");
        File.WriteAllBytes(Executable(resources), []);
        Sandbox.CreateSpa(Path.Combine(resources, "Apps", "xpui.spa"), Sandbox.SampleIndex);
        return resources;
    }

    private static string Executable(string resources) => Path.GetFullPath(Path.Combine(resources, "../MacOS/Spotify"));
    private static Process StartSleep(string executable)
    {
        var start = new ProcessStartInfo(executable) { UseShellExecute = false };
        start.ArgumentList.Add("30");
        return Process.Start(start)!;
    }
}

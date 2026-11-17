using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using SpotiKit.Models;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class BackupServiceTests
{
    private static SpotifyInstallation Client(Sandbox box, string version = "1.2.3.4") =>
        new(SpotifyEdition.Desktop, version, box.SpotifyDir, false, Path.Combine(box.SpotifyDir, "Spotify.exe"),
            XpuiKind.Spa, box.XpuiPath, XpuiPatcher.Inspect(box.XpuiPath));

    [Fact]
    public void Create_copies_and_verifies_the_ui_file()
    {
        using var box = new Sandbox();
        var backups = new BackupService(box.Paths);

        var backup = backups.Create(Client(box), BackupKind.Manual);

        Assert.True(backup.Manifest.IsPristine);
        Assert.Equal("1.2.3.4", backup.Manifest.SpotifyVersion);
        var file = Assert.Single(backup.Manifest.Files);
        Assert.Equal(FileHash.Sha256(box.XpuiPath), file.Sha256);
        Assert.True(backups.Verify(backup, out _));
        Assert.Single(backups.List());
    }

    [Fact]
    public void Verify_detects_a_tampered_backup()
    {
        using var box = new Sandbox();
        var backups = new BackupService(box.Paths);
        var backup = backups.Create(Client(box), BackupKind.Manual);

        File.AppendAllText(Path.Combine(backup.Directory, "files", "Apps", "xpui.spa"), "x");

        Assert.False(backups.Verify(backup, out var problem));
        Assert.NotNull(problem);
    }

    [Fact]
    public void Restore_is_refused_for_a_different_spotify_version()
    {
        using var box = new Sandbox();
        var backups = new BackupService(box.Paths);
        var backup = backups.Create(Client(box, "1.0.0.1"), BackupKind.Manual);

        var blocker = BackupService.RestoreBlocker(backup, Client(box, "1.0.0.2"));

        Assert.NotNull(blocker);
        Assert.Throws<InvalidOperationException>(() => backups.Restore(backup, Client(box, "1.0.0.2")));
    }

    [Fact]
    public void Restore_brings_back_the_exact_file()
    {
        using var box = new Sandbox();
        var backups = new BackupService(box.Paths);
        var original = FileHash.Sha256(box.XpuiPath);
        var backup = backups.Create(Client(box), BackupKind.Manual);

        XpuiPatcher.Inject(box.XpuiPath, "x", "9.9.9");
        Assert.NotEqual(original, FileHash.Sha256(box.XpuiPath));

        backups.Restore(backup, Client(box));
        Assert.Equal(original, FileHash.Sha256(box.XpuiPath));
    }

    [Fact]
    public void Prune_keeps_the_newest_and_always_the_original_backup()
    {
        using var box = new Sandbox();
        var backups = new BackupService(box.Paths);
        var original = backups.Create(Client(box), BackupKind.Automatic);
        XpuiPatcher.Inject(box.XpuiPath, "x", "1.0.0");
        for (var i = 0; i < 4; i++)
        {
            Thread.Sleep(1100);
            backups.Create(Client(box), BackupKind.Automatic);
        }

        var removed = backups.Prune(keep: 2);
        var left = backups.List();

        Assert.Equal(2, removed.Count);
        Assert.Equal(3, left.Count);
        Assert.Contains(left, b => b.Manifest.Id == original.Manifest.Id);
    }
}

public class InstallerServiceTests
{
    private static (InstallerService Installer, SpotifyService Spotify, StateStore State, BackupService Backups, ActivityLog Log)
        Create(Sandbox box)
    {
        var spotify = new SpotifyService(box.Paths);
        var backups = new BackupService(box.Paths);
        var state = new StateStore(box.Paths);
        var log = new ActivityLog(box.Paths);
        return (new InstallerService(spotify, backups, state, log), spotify, state, backups, log);
    }

    private sealed class NoProgress : IProgress<InstallProgress>
    {
        public void Report(InstallProgress value)
        {
        }
    }

    [Fact]
    public async Task Preview_says_what_an_install_changes_and_changes_nothing()
    {
        using var box = new Sandbox();
        var (installer, _, _, _, log) = Create(box);
        var before = File.ReadAllBytes(box.XpuiPath);

        var fresh = installer.Preview(FrameworkPackage.Bundled);
        Assert.Equal($"{FrameworkPackage.BundledVersion} (new)", fresh.Single(c => c.Label == "SpotiKit").Value);
        Assert.Contains(fresh, c => c.Label == "Changed file" && c.Value.StartsWith(Path.GetFileName(box.XpuiPath)));
        Assert.Equal(before, File.ReadAllBytes(box.XpuiPath));

        var install = await installer.InstallAsync(FrameworkPackage.Bundled, 5, new NoProgress(), CancellationToken.None);
        Assert.True(install.Succeeded, ActivityLog.Format(log.Entries));
        var again = installer.Preview(FrameworkPackage.Bundled);
        Assert.Equal($"{FrameworkPackage.BundledVersion} (same files, repaired)", again.Single(c => c.Label == "SpotiKit").Value);
    }

    [Fact]
    public async Task Install_and_uninstall_round_trip_in_a_sandbox()
    {
        using var box = new Sandbox();
        var (installer, spotify, state, backups, log) = Create(box);
        var originalIndex = Sandbox.ReadEntryBytes(box.XpuiPath, "index.html");

        var install = await installer.InstallAsync(FrameworkPackage.Bundled, 5, new NoProgress(), CancellationToken.None);
        Assert.True(install.Succeeded, install.Message + Environment.NewLine + ActivityLog.Format(log.Entries));

        var client = spotify.Detect();
        Assert.True(client.HasSpotiKit);
        Assert.Equal(FrameworkPackage.BundledVersion, client.Xpui!.SpotiKitVersion);
        var record = state.Load().Install;
        Assert.NotNull(record);
        Assert.Equal(FrameworkPackage.Bundled.LoaderSha256, record!.LoaderSha256);
        Assert.Contains(backups.List(), b => b.Manifest.Id == record.BackupId && b.Manifest.IsPristine);

        var uninstall = await installer.UninstallAsync(5, new NoProgress(), CancellationToken.None);
        Assert.True(uninstall.Succeeded, uninstall.Message);
        Assert.False(spotify.Detect().HasSpotiKit);
        Assert.Equal(originalIndex, Sandbox.ReadEntryBytes(box.XpuiPath, "index.html"));
        Assert.Null(state.Load().Install);
        Assert.Contains(log.Entries, e => e.Message.Contains("match the original"));
    }

    [Fact]
    public async Task Install_refuses_when_another_mod_is_applied_and_changes_nothing()
    {
        using var box = new Sandbox(index: null);
        Sandbox.CreateSpa(box.XpuiPath, Sandbox.SampleIndex.Replace("</body>", "<script src=\"/spicetify.js\"></script></body>"));
        var before = FileHash.Sha256(box.XpuiPath);
        var (installer, _, _, backups, log) = Create(box);

        var result = await installer.InstallAsync(FrameworkPackage.Bundled, 5, new NoProgress(), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Contains("Spicetify", result.Message);
        Assert.Equal(before, FileHash.Sha256(box.XpuiPath));
        Assert.Empty(backups.List());
        Assert.Contains(log.Entries, e => e.Level == LogLevel.Error);
    }

    [Fact]
    public async Task Restore_of_the_original_backup_removes_spotikit()
    {
        using var box = new Sandbox();
        var (installer, spotify, state, backups, _) = Create(box);
        var original = FileHash.Sha256(box.XpuiPath);

        await installer.InstallAsync(FrameworkPackage.Bundled, 5, new NoProgress(), CancellationToken.None);
        var pristine = backups.FindPristine(spotify.Detect().Version);
        Assert.NotNull(pristine);

        var result = await installer.RestoreAsync(pristine!);

        Assert.True(result.Succeeded, result.Message);
        Assert.Equal(original, FileHash.Sha256(box.XpuiPath));
        Assert.Null(state.Load().Install);
        Assert.Contains(backups.List(), b => !b.Manifest.IsPristine);
    }

    [Fact]
    public async Task Cancelling_before_the_backup_changes_nothing()
    {
        using var box = new Sandbox();
        var (installer, _, _, backups, _) = Create(box);
        var before = FileHash.Sha256(box.XpuiPath);
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var result = await installer.InstallAsync(FrameworkPackage.Bundled, 5, new NoProgress(), cts.Token);

        Assert.False(result.Succeeded);
        Assert.Equal(before, FileHash.Sha256(box.XpuiPath));
        Assert.Empty(backups.List());
    }

    private sealed class CountingProgress : IProgress<InstallProgress>
    {
        public readonly System.Collections.Generic.List<InstallProgress> Reports = [];

        public void Report(InstallProgress value)
        {
            lock (Reports)
                Reports.Add(value);
        }
    }

    [Fact]
    public async Task Progress_is_paced_and_every_step_reaches_full()
    {
        using var box = new Sandbox();
        var (installer, _, _, _, _) = Create(box);
        var progress = new CountingProgress();

        var result = await installer.InstallAsync(FrameworkPackage.Bundled, 5, progress, CancellationToken.None);

        Assert.True(result.Succeeded, result.Message);
        Assert.InRange(progress.Reports.Count, 4, 200);
        for (var step = 0; step < InstallerService.InstallPlan.Count; step++)
            Assert.Contains(progress.Reports, r => r.StepIndex == step && r.StepFraction >= 1);
    }

    [Fact]
    public void Bundled_loader_has_its_version_filled_in()
    {
        Assert.Contains(FrameworkPackage.BundledVersion, FrameworkPackage.Bundled.LoaderScript);
        Assert.DoesNotContain("{{VERSION}}", FrameworkPackage.Bundled.LoaderScript);
    }
}

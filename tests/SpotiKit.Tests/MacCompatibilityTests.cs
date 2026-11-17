using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using SpotiKit.Models;
using SpotiKit.Services;
using SpotiKit.ViewModels;
using Xunit;

namespace SpotiKit.Tests;

public class MacCompatibilityTests
{
    private static string CreateBundle(Sandbox box, string plist)
    {
        var contents = Path.Combine(box.Root, "Spotify Test.app", "Contents");
        var resources = Path.Combine(contents, "Resources");
        Directory.CreateDirectory(Path.Combine(resources, "Apps"));
        Directory.CreateDirectory(Path.Combine(contents, "MacOS"));
        File.WriteAllText(Path.Combine(contents, "Info.plist"), plist);
        File.WriteAllText(Path.Combine(contents, "MacOS", "Spotify"), "sandbox executable");
        Sandbox.CreateSpa(Path.Combine(resources, "Apps", "xpui.spa"), Sandbox.SampleIndex);
        return resources;
    }

    [Theory]
    [InlineData("<key>CFBundleShortVersionString</key><string>1.3.6.1921.g123abc</string>", "1.3.6.1921")]
    [InlineData("<key>CFBundleShortVersionString</key><string>1.3.6</string><key>CFBundleVersion</key><string>1.3.6.1921</string>", "1.3.6.1921")]
    [InlineData("<key>CFBundleVersion</key><string>1.3.6.1921</string>", "1.3.6.1921")]
    [InlineData("<key>CFBundleShortVersionString</key><string>1.3.6.1921</string><key>CFBundleVersion</key><string>1921</string>", "1.3.6.1921")]
    [InlineData("<key>CFBundleShortVersionString</key><string>invalid</string>", null)]
    public void Detection_reads_Mac_bundle_versions_including_paths_with_spaces(string values, string? expected)
    {
        using var box = new Sandbox();
        var resources = CreateBundle(box, "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">" +
            "<plist version=\"1.0\"><dict>" + values + "</dict></plist>");
        var client = new SpotifyService(box.Paths with { SpotifyDirOverride = resources }).Detect();
        Assert.Equal(expected, client.Version);
        Assert.Equal(XpuiKind.Spa, client.XpuiKind);
        Assert.Equal(Path.GetFullPath(Path.Combine(resources, "../MacOS/Spotify")), client.ExecutablePath);
    }

    [Fact]
    public void Missing_or_malformed_plists_do_not_crash_detection()
    {
        using var box = new Sandbox();
        var resources = CreateBundle(box, "not a plist");
        var spotify = new SpotifyService(box.Paths with { SpotifyDirOverride = resources });
        Assert.Null(spotify.Detect().Version);
        File.Delete(Path.Combine(resources, "../Info.plist"));
        Assert.Null(spotify.Detect().Version);
    }

    [MacOSFact]
    public void Binary_plists_are_read_without_modifying_them()
    {
        using var box = new Sandbox();
        var resources = CreateBundle(box, "<plist version=\"1.0\"><dict><key>CFBundleShortVersionString</key><string>1.3.6.1921</string></dict></plist>");
        var plist = Path.GetFullPath(Path.Combine(resources, "../Info.plist"));
        var start = new ProcessStartInfo("/usr/bin/plutil") { UseShellExecute = false };
        foreach (var argument in new[] { "-convert", "binary1", plist })
            start.ArgumentList.Add(argument);
        using var process = Process.Start(start)!;
        Assert.True(process.WaitForExit(5000));
        Assert.Equal(0, process.ExitCode);
        var before = File.ReadAllBytes(plist);
        Assert.Equal("1.3.6.1921", MacApplicationBundle.ReadVersion(resources));
        Assert.Equal(before, File.ReadAllBytes(plist));
    }

    [Fact]
    public void XML_plists_with_a_byte_order_mark_are_read()
    {
        using var box = new Sandbox();
        const string xml = "<plist version=\"1.0\"><dict><key>CFBundleShortVersionString</key><string>1.3.6.1921</string></dict></plist>";
        var resources = CreateBundle(box, xml);
        File.WriteAllText(Path.Combine(resources, "../Info.plist"), xml, new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        Assert.Equal("1.3.6.1921", MacApplicationBundle.ReadVersion(resources));
    }

    [Fact]
    public void An_empty_override_is_not_reported_as_a_ready_Spotify_client()
    {
        using var box = new Sandbox();
        var empty = Path.Combine(box.Root, "empty");
        Directory.CreateDirectory(empty);
        Assert.False(new SpotifyService(box.Paths with { SpotifyDirOverride = empty }).Detect().IsInstalled);
    }

    [MacOSFact]
    public async Task Native_mode_refuses_incomplete_Mac_apps_instead_of_skipping_signing()
    {
        using var box = new Sandbox();
        var paths = box.Paths with { AllowSpotifyControl = true };
        var spotify = new SpotifyService(paths);
        var backups = new BackupService(paths);
        var original = FileHash.Sha256(box.XpuiPath);
        var installer = new InstallerService(spotify, backups, new StateStore(paths), new ActivityLog(paths));
        var result = await installer.InstallAsync(FrameworkPackage.Bundled, 5,
            new Progress<InstallProgress>(), CancellationToken.None);
        Assert.False(result.Succeeded);
        Assert.Contains("incomplete", result.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(original, FileHash.Sha256(box.XpuiPath));
        Assert.Empty(backups.List());
        var backup = backups.Create(spotify.Detect(), BackupKind.Manual);
        Assert.Throws<InvalidOperationException>(() => backups.Restore(backup, spotify.Detect()));
    }

    [Fact]
    public void Unknown_version_recovery_requires_the_same_path_and_unchanged_executable()
    {
        using var box = new Sandbox();
        var spotify = new SpotifyService(box.Paths);
        var client = spotify.Detect() with { Version = null };
        var backups = new BackupService(box.Paths);
        var original = FileHash.Sha256(box.XpuiPath);
        var backup = backups.Create(client, BackupKind.Manual);
        Assert.NotNull(backup.Manifest.ExecutableSha256);
        XpuiPatcher.Inject(box.XpuiPath, "test", "0.9.0");
        Assert.Null(BackupService.RestoreBlocker(backup, client));
        backups.Restore(backup, client);
        Assert.Equal(original, FileHash.Sha256(box.XpuiPath));
        Assert.NotNull(BackupService.RestoreBlocker(backup, client with { InstallPath = Path.Combine(box.Root, "other") }));
        Assert.NotNull(BackupService.RestoreBlocker(backup, client with { Version = "1.3.6.1921" }));
        File.AppendAllText(client.ExecutablePath!, "updated executable");
        Assert.NotNull(BackupService.RestoreBlocker(backup, client));
        Assert.NotNull(BackupService.RestoreBlocker(backup with { Manifest = backup.Manifest with { ExecutableSha256 = null } }, client));
    }

    [Fact]
    public void An_unidentified_client_is_not_modified_when_a_restorable_backup_is_impossible()
    {
        using var box = new Sandbox();
        var client = new SpotifyService(box.Paths).Detect() with { Version = null, ExecutablePath = null };
        var backups = new BackupService(box.Paths);
        var original = FileHash.Sha256(box.XpuiPath);
        Assert.Throws<InvalidOperationException>(() => backups.Create(client, BackupKind.Automatic));
        Assert.Equal(original, FileHash.Sha256(box.XpuiPath));
        Assert.Empty(backups.List());
    }

    [Fact]
    public async Task The_score_notifies_after_the_last_neutral_check_is_added()
    {
        using var box = new Sandbox();
        var log = new ActivityLog(box.Paths);
        var spotify = new SpotifyStatusViewModel(new SpotifyService(box.Paths));
        var versions = new SpotifyVersionsViewModel(new SpotifyVersionListService(box.Paths), spotify, log);
        var compatibility = new CompatibilityViewModel(spotify, new CompatibilityService(), new BackupService(box.Paths), versions);
        var scoreNotifications = new List<string>();
        compatibility.PropertyChanged += (_, change) =>
        {
            if (change.PropertyName == nameof(compatibility.ScoreText))
                scoreNotifications.Add(compatibility.ScoreText);
        };
        await compatibility.RunChecksAsync();
        Assert.Equal(10, compatibility.TotalCount);
        Assert.Equal(StatusKind.Neutral, compatibility.Checks.Last().Status);
        Assert.Equal(compatibility.ScoreText, scoreNotifications.Last());
        Assert.EndsWith("/10", scoreNotifications.Last());
    }

    [MacOSFact]
    public async Task Mac_updates_cannot_replace_the_app_with_a_Windows_executable_or_change_update_files()
    {
        using var box = new Sandbox();
        var executable = Path.Combine(box.Root, "SpotiKit");
        File.WriteAllText(executable, "Mac app");
        var app = new AppUpdateService("0.9.0", executable, isSingleFile: true);
        Assert.NotNull(app.CannotUpdateReason);
        Assert.Throws<InvalidOperationException>(() => app.Replace("Windows download"));
        Assert.Equal("Mac app", File.ReadAllText(executable));
        var updates = new SpotifyUpdateService(box.Paths, new StateStore(box.Paths), new ActivityLog(box.Paths));
        var client = new SpotifyService(box.Paths).Detect();
        Assert.Equal(UpdateHoldState.NotSupported, updates.GetStatus(client).State);
        Directory.CreateDirectory(box.Paths.SpotifyLocalDataDir);
        File.WriteAllText(updates.UpdatePath, "unrelated Mac updater data");
        Assert.Throws<InvalidOperationException>(() => updates.Hold(client, false, false));
        updates.Release(includeOtherTools: true);
        Assert.Equal("unrelated Mac updater data", File.ReadAllText(updates.UpdatePath));
        await Assert.ThrowsAsync<InvalidOperationException>(() => new SpotifyReleaseService().LatestAsync(null));
    }

    [MacSpotifyFact]
    public async Task A_pristine_copy_of_a_real_Mac_client_can_install_uninstall_and_restore_exactly()
    {
        using var fixture = new MacSpotifyFixture(patched: false);
        var spotify = new SpotifyService(fixture.Paths);
        var backups = new BackupService(fixture.Paths);
        var log = new ActivityLog(fixture.Paths);
        var installer = new InstallerService(spotify, backups, new StateStore(fixture.Paths), log);
        var client = spotify.Detect();
        Assert.NotNull(client.Version);
        Assert.True(client.Xpui!.IsPatchable);
        Assert.False(client.HasSpotiKit);
        Assert.Empty(backups.List());
        var install = await installer.InstallAsync(FrameworkPackage.Bundled, 5, new NoProgress(), CancellationToken.None);
        Assert.True(install.Succeeded, ActivityLog.Format(log.Entries));
        Assert.True(spotify.Detect().HasSpotiKit);
        AssertSelectedClassMapApplied(client);
        var original = Assert.Single(backups.List());
        Assert.True(original.Manifest.IsPristine);
        AssertExactStartingBackup(fixture, backups, original);
        var uninstall = await installer.UninstallAsync(5, new NoProgress(), CancellationToken.None);
        Assert.True(uninstall.Succeeded, ActivityLog.Format(log.Entries));
        Assert.False(spotify.Detect().HasSpotiKit);
        Assert.Equal(original.Manifest.Id, backups.FindPristine(spotify.Detect())?.Manifest.Id);
        fixture.AssertStartingBundleRestored();
        if (fixture.SourceWasPristine)
        {
            // The whole-bundle hash covers the original Mach-O signatures and _CodeSignature/CodeResources.
            Assert.Equal(fixture.SourceArchiveHash, FileHash.Sha256(fixture.Archive));
            Assert.Equal(fixture.SourceFingerprint, MacBundleFiles.Fingerprint(fixture.Bundle));
        }
        backups.Restore(original, spotify.Detect());
        fixture.AssertStartingBundleRestored();
        fixture.AssertSourceUnchanged();
    }

    [MacSpotifyFact]
    public async Task An_already_patched_copy_of_a_real_Mac_client_can_repair_uninstall_and_restore_exactly()
    {
        using var fixture = new MacSpotifyFixture(patched: true);
        var spotify = new SpotifyService(fixture.Paths);
        var backups = new BackupService(fixture.Paths);
        var log = new ActivityLog(fixture.Paths);
        var installer = new InstallerService(spotify, backups, new StateStore(fixture.Paths), log);
        var client = spotify.Detect();
        Assert.True(client.HasSpotiKit);
        Assert.Equal("0.0.0-fixture", client.Xpui!.SpotiKitVersion);
        Assert.Empty(backups.List());
        Assert.Null(backups.FindPristine(client));
        var install = await installer.InstallAsync(FrameworkPackage.Bundled, 5, new NoProgress(), CancellationToken.None);
        Assert.True(install.Succeeded, ActivityLog.Format(log.Entries));
        Assert.Equal(FrameworkPackage.Bundled.Version, spotify.Detect().Xpui!.SpotiKitVersion);
        Assert.Equal(FrameworkPackage.Bundled.LoaderScript, XpuiPatcher.ReadLoader(fixture.Archive));
        AssertSelectedClassMapApplied(client);
        var original = Assert.Single(backups.List());
        Assert.False(original.Manifest.IsPristine);
        AssertExactStartingBackup(fixture, backups, original);
        var uninstall = await installer.UninstallAsync(5, new NoProgress(), CancellationToken.None);
        Assert.True(uninstall.Succeeded, ActivityLog.Format(log.Entries));
        Assert.False(spotify.Detect().HasSpotiKit);
        // A repair of an existing install cannot invent a pristine backup. Removal must undo its own changes.
        Assert.Null(backups.FindPristine(spotify.Detect()));
        Assert.Empty(XpuiPatcher.DifferingEntries(fixture.CleanArchive, fixture.Archive));
        new MacBundleSigner().Verify(fixture.Bundle);
        backups.Restore(original, spotify.Detect());
        Assert.True(spotify.Detect().HasSpotiKit);
        Assert.Equal("0.0.0-fixture", spotify.Detect().Xpui!.SpotiKitVersion);
        fixture.AssertStartingBundleRestored();
        fixture.AssertSourceUnchanged();
    }

    private static void AssertExactStartingBackup(MacSpotifyFixture fixture, BackupService backups, BackupInfo backup)
    {
        Assert.True(backup.Manifest.FullBundle);
        Assert.True(backups.Verify(backup, out var problem), problem);
        Assert.Equal(fixture.StartingFingerprint, backup.Manifest.BundleFingerprint);
        Assert.Equal(fixture.StartingArchiveHash, Assert.Single(backup.Manifest.Files).Sha256);
    }

    private static void AssertSelectedClassMapApplied(SpotifyInstallation client)
    {
        var selection = ClassMapCatalog.Bundled.Select(client);
        if (selection.IsSupported && !selection.IsFallback)
        {
            var applied = XpuiPatcher.ReadClassMap(client.XpuiPath!)!;
            Assert.Equal(selection.Mappings.Count, applied.Applied.Count);
            Assert.Empty(applied.Skipped);
        }
    }

    private sealed class NoProgress : IProgress<InstallProgress>
    {
        public void Report(InstallProgress value) { }
    }
}

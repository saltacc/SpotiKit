using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Xml.Linq;
using SpotiKit.Models;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class MacBundleIntegrationTests
{
    [MacOSFact]
    public async Task Install_reports_signing_before_publication_and_checks_only_a_verified_app()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var paths = Paths(fixture);
        var spotify = new SpotifyService(paths);
        var installer = new InstallerService(spotify, new BackupService(paths), new StateStore(paths), new ActivityLog(paths));
        var original = MacBundleFiles.Fingerprint(fixture.Bundle);
        var reports = new List<InstallProgress>();
        var sawSigning = false;
        var sawFinalCheck = false;
        var progress = new CallbackProgress(report =>
        {
            reports.Add(report);
            if (report.StepIndex == 3 && report.StepFraction == 0)
            {
                Assert.Equal(original, MacBundleFiles.Fingerprint(fixture.Bundle));
                Assert.False(XpuiPatcher.Inspect(fixture.Archive).HasSpotiKit);
                sawSigning = true;
            }
            if (report.StepIndex == 4 && report.StepFraction == 0)
            {
                Assert.True(XpuiPatcher.Inspect(fixture.Archive).HasSpotiKit);
                new MacBundleSigner().Verify(fixture.Bundle);
                sawFinalCheck = true;
            }
        });

        var result = await installer.InstallAsync(FrameworkPackage.Bundled, 5, progress, CancellationToken.None);

        Assert.True(result.Succeeded, result.Message);
        Assert.True(sawSigning);
        Assert.True(sawFinalCheck);
        Assert.Equal(new[] { 0, 1, 2, 3, 4 }, reports.Select(report => report.StepIndex).Distinct());
        Assert.Contains(reports, report => report.Plan?.Count == 5 && report.Plan[3].Title == "Signing Spotify");
    }

    [MacOSFact]
    public async Task Signing_stage_failure_keeps_the_original_app_and_never_reports_the_final_check()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var paths = Paths(fixture);
        var state = new StateStore(paths);
        var installer = new InstallerService(new SpotifyService(paths), new BackupService(paths), state, new ActivityLog(paths));
        var original = MacBundleFiles.Fingerprint(fixture.Bundle);
        var reports = new List<InstallProgress>();
        var progress = new CallbackProgress(report =>
        {
            reports.Add(report);
            if (report.StepIndex != 3 || report.StepFraction != 0) return;
            var staged = Assert.Single(Directory.EnumerateDirectories(fixture.Root, ".spotikit-stage-*.app"));
            File.Delete(Path.Combine(staged, "Contents", "Info.plist"));
        });

        var result = await installer.InstallAsync(FrameworkPackage.Bundled, 5, progress, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.DoesNotContain(reports, report => report.StepIndex == 4);
        Assert.Equal(original, MacBundleFiles.Fingerprint(fixture.Bundle));
        Assert.Null(state.Load().Install);
        Assert.Empty(Directory.EnumerateDirectories(fixture.Root, ".spotikit-stage-*.app"));
        new MacBundleSigner().Verify(fixture.Bundle);
    }

    [MacOSFact]
    public async Task An_external_replacement_between_backup_and_staging_is_left_untouched()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var paths = Paths(fixture);
        var spotify = new SpotifyService(paths);
        var backups = new BackupService(paths);
        var log = new ActivityLog(paths);
        var state = new StateStore(paths);
        string? external = null;
        var originalBuild = spotify.Detect().Build;
        log.EntryAdded += (_, entry) =>
        {
            if (entry.Operation != "Install" || !entry.Message.StartsWith("Backup ", StringComparison.Ordinal) ||
                !entry.Message.Contains(" created ", StringComparison.Ordinal)) return;
            AddExternalRevision(fixture.Bundle);
            new MacBundleSigner().SignAndVerify(fixture.Bundle);
            external = MacBundleFiles.Fingerprint(fixture.Bundle);
        };
        var installer = new InstallerService(spotify, backups, state, log);
        var result = await installer.InstallAsync(FrameworkPackage.Bundled, 5, new NoProgress(), CancellationToken.None);
        Assert.NotNull(external);
        Assert.False(result.Succeeded);
        Assert.Equal(originalBuild, spotify.Detect().Build);
        Assert.Equal(external, MacBundleFiles.Fingerprint(fixture.Bundle));
        Assert.False(spotify.Detect().HasSpotiKit);
        Assert.Null(state.Load().Install);
        new MacBundleSigner().Verify(fixture.Bundle);
    }

    [MacOSFact]
    public async Task A_state_write_failure_after_install_restores_the_exact_previous_bundle()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var paths = Paths(fixture);
        var spotify = new SpotifyService(paths);
        var backups = new BackupService(paths);
        var log = new ActivityLog(paths);
        var state = new StateStore(paths);
        var original = MacBundleFiles.Fingerprint(fixture.Bundle);
        var failedStateWrite = false;
        log.EntryAdded += (_, entry) =>
        {
            if (!IsInstalledEntry(entry)) return;
            Directory.CreateDirectory(paths.StateFile);
            failedStateWrite = true;
        };
        var installer = new InstallerService(spotify, backups, state, log);

        var result = await installer.InstallAsync(FrameworkPackage.Bundled, 5, new NoProgress(), CancellationToken.None);

        Assert.True(failedStateWrite);
        Assert.False(result.Succeeded);
        Assert.Equal(original, MacBundleFiles.Fingerprint(fixture.Bundle));
        Assert.False(XpuiPatcher.Inspect(fixture.Archive).HasSpotiKit);
        new MacBundleSigner().Verify(fixture.Bundle);
    }

    [MacOSFact]
    public async Task A_state_write_failure_cannot_roll_back_an_external_change_after_publication()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var paths = Paths(fixture);
        var spotify = new SpotifyService(paths);
        var backups = new BackupService(paths);
        var log = new ActivityLog(paths);
        string? externalFingerprint = null;
        SpotifyBuildIdentity? identityBeforeExternalChange = null;
        log.EntryAdded += (_, entry) =>
        {
            if (!IsInstalledEntry(entry)) return;
            identityBeforeExternalChange = spotify.Detect().Build;
            AddExternalRevision(fixture.Bundle);
            new MacBundleSigner().SignAndVerify(fixture.Bundle);
            externalFingerprint = MacBundleFiles.Fingerprint(fixture.Bundle);
            Directory.CreateDirectory(paths.StateFile);
        };
        var installer = new InstallerService(spotify, backups, new StateStore(paths), log);

        var result = await installer.InstallAsync(FrameworkPackage.Bundled, 5, new NoProgress(), CancellationToken.None);

        Assert.NotNull(externalFingerprint);
        Assert.False(result.Succeeded);
        Assert.Equal(externalFingerprint, MacBundleFiles.Fingerprint(fixture.Bundle));
        Assert.Equal(identityBeforeExternalChange, spotify.Detect().Build);
        Assert.Contains("external-revision", File.ReadAllText(Path.Combine(fixture.Bundle, "Contents/Info.plist")));
        new MacBundleSigner().Verify(fixture.Bundle);
    }

    [MacOSFact]
    public void A_full_backup_cannot_contain_two_different_archive_copies()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var paths = Paths(fixture);
        var backups = new BackupService(paths);
        var backup = backups.Create(new SpotifyService(paths).Detect(), BackupKind.Manual);
        Assert.True(backup.Manifest.FullBundle);
        var file = Assert.Single(backup.Manifest.Files);
        var archiveCopy = Path.Combine(backup.Directory, "files", file.RelativePath);
        Sandbox.ReplaceEntry(archiveCopy, "index.html", "<html><body>a different recovery archive</body></html>");
        var mixed = backup with
        {
            Manifest = backup.Manifest with
            {
                Files = [file with { Size = new FileInfo(archiveCopy).Length, Sha256 = FileHash.Sha256(archiveCopy) }],
            },
        };

        Assert.False(backups.Verify(mixed, out var problem));
        Assert.NotNull(problem);
    }

    [MacOSFact]
    public void A_same_size_and_mtime_resource_replacement_cannot_create_a_backup_under_the_old_identity()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var paths = Paths(fixture);
        WriteStoredArchive(fixture.Archive, 'A');
        var timestamp = File.GetLastWriteTimeUtc(fixture.Archive);
        var originalLength = new FileInfo(fixture.Archive).Length;
        var oldClient = new SpotifyService(paths).Detect();
        WriteStoredArchive(fixture.Archive, 'B');
        File.SetLastWriteTimeUtc(fixture.Archive, timestamp);
        Assert.Equal(originalLength, new FileInfo(fixture.Archive).Length);
        Assert.Equal(timestamp, File.GetLastWriteTimeUtc(fixture.Archive));
        Assert.NotEqual(oldClient.Build!.ResourceFingerprint, XpuiPatcher.ResourceFingerprint(fixture.Archive));
        var backups = new BackupService(paths);

        Assert.Throws<IOException>(() => backups.Create(oldClient, BackupKind.Manual));
        Assert.Empty(backups.List());
    }

    [MacOSFact]
    public void Legacy_Mac_archive_backups_require_the_same_resource_build()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var paths = Paths(fixture);
        var backups = new BackupService(paths);
        var client = new SpotifyService(paths).Detect();
        var backup = backups.Create(client, BackupKind.Manual);
        var legacy = backup with
        {
            Manifest = backup.Manifest with
            {
                SchemaVersion = 1, FullBundle = false, Build = null, BundleFiles = [], BundleLinks = [], BundleFingerprint = null,
            },
        };
        Assert.Null(BackupService.RestoreBlocker(legacy, client));

        var file = Assert.Single(legacy.Manifest.Files);
        var archive = Path.Combine(legacy.Directory, "files", file.RelativePath);
        Sandbox.ReplaceEntry(archive, "index.html", "<html><body>different same-version platform resources</body></html>");
        legacy = legacy with
        {
            Manifest = legacy.Manifest with
            {
                Files = [file with { Size = new FileInfo(archive).Length, Sha256 = FileHash.Sha256(archive) }],
            },
        };
        Assert.True(backups.Verify(legacy, out _));
        Assert.NotNull(BackupService.RestoreBlocker(legacy, client));
    }

    [MacOSFact]
    public void Malformed_full_backup_metadata_is_a_verification_failure()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var paths = Paths(fixture);
        var backups = new BackupService(paths);
        var backup = backups.Create(new SpotifyService(paths).Detect(), BackupKind.Manual);
        var file = Assert.Single(backup.Manifest.Files);
        var missing = backup with { Manifest = backup.Manifest with { Files = [] } };
        var duplicate = backup with { Manifest = backup.Manifest with { Files = [file, file] } };
        Assert.False(backups.Verify(missing, out _));
        Assert.False(backups.Verify(duplicate, out _));
    }

    [MacOSFact]
    public void An_external_change_during_publication_is_retained_with_a_separate_recovery_copy()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var original = MacBundleFiles.Fingerprint(fixture.Bundle);
        var signer = new ExternalChangeAfterVerification(fixture.Bundle);
        var transaction = new MacBundleTransaction(fixture.Client, () => false, signer);
        Sandbox.ReplaceEntry(transaction.WorkingClient.XpuiPath!, "index.html", "<html><body>new SpotiKit resources</body></html>");

        Assert.Throws<IOException>(() => transaction.Commit());

        Assert.NotNull(signer.ExternalFingerprint);
        Assert.Equal(signer.ExternalFingerprint, MacBundleFiles.Fingerprint(fixture.Bundle));
        Assert.Null(transaction.PublishedFingerprint);
        var recovery = transaction.RetainedRecoveryBundle;
        Assert.NotNull(recovery);
        transaction.Dispose();
        Assert.True(Directory.Exists(recovery));
        Assert.Equal(original, MacBundleFiles.Fingerprint(recovery!));
        new MacBundleSigner().Verify(fixture.Bundle);
        new MacBundleSigner().Verify(recovery!);
    }

    [MacOSFact]
    public void A_successful_publication_returns_the_exact_fingerprint_of_the_verified_app()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        using var transaction = new MacBundleTransaction(fixture.Client, () => false);
        Assert.Null(transaction.PublishedFingerprint);
        transaction.Commit();
        Assert.Equal(MacBundleFiles.Fingerprint(fixture.Bundle), transaction.PublishedFingerprint);
    }

    [MacOSFact]
    public void A_restore_transaction_cannot_adopt_an_external_change_after_the_receipt_was_checked()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var expected = MacBundleFiles.Fingerprint(fixture.Bundle);
        AddExternalRevision(fixture.Bundle);
        new MacBundleSigner().SignAndVerify(fixture.Bundle);
        var external = MacBundleFiles.Fingerprint(fixture.Bundle);

        Assert.Throws<IOException>(() => new MacBundleTransaction(fixture.Client, () => false,
            expectedFingerprint: expected));

        Assert.Equal(external, MacBundleFiles.Fingerprint(fixture.Bundle));
    }

    [MacOSFact]
    public void A_false_sandbox_running_callback_cannot_bypass_the_native_running_target_check()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var executable = Path.Combine(fixture.Bundle, "Contents/MacOS/Spotify");
        File.Copy("/bin/sleep", executable, overwrite: true);
        new MacBundleSigner().SignAndVerify(fixture.Bundle);
        var start = new ProcessStartInfo(executable) { UseShellExecute = false };
        start.ArgumentList.Add("30");
        using var ownedProcess = Process.Start(start)!;
        try
        {
            Thread.Sleep(50);
            Assert.False(ownedProcess.HasExited);
            Assert.Contains(ownedProcess.Id, MacBundleFiles.RunningProcessIds(executable));
            Assert.Throws<InvalidOperationException>(() => new MacBundleTransaction(fixture.Client, () => false));
        }
        finally
        {
            if (!ownedProcess.HasExited) ownedProcess.Kill();
            ownedProcess.WaitForExit(5000);
        }
    }

    private static SpotiKitPaths Paths(MacBundleTests.OwnedBundle fixture)
    {
        var data = Path.Combine(fixture.Root, "SpotiKit Data");
        return new(data, Path.Combine(data, "settings.json"), Path.Combine(fixture.Bundle, "Contents/Resources"),
            Path.Combine(fixture.Root, "Spotify Profile")) { IsSandboxed = true };
    }

    private static bool IsInstalledEntry(LogEntry entry) => entry.Operation == "Install" &&
        entry.Message == $"SpotiKit {FrameworkPackage.BundledVersion} added";

    private static void AddExternalRevision(string bundle)
    {
        var path = Path.Combine(bundle, "Contents/Info.plist");
        var plist = XDocument.Load(path);
        plist.Root!.Element("dict")!.Add(new XElement("key", "external-revision"), new XElement("string", "independent change"));
        File.WriteAllText(path, plist.ToString(SaveOptions.DisableFormatting));
    }

    private static void WriteStoredArchive(string path, char marker)
    {
        using var file = File.Create(path);
        using var archive = new ZipArchive(file, ZipArchiveMode.Create);
        var index = archive.CreateEntry("index.html", CompressionLevel.NoCompression);
        index.LastWriteTime = new DateTimeOffset(2020, 1, 1, 0, 0, 0, TimeSpan.Zero);
        using var writer = new StreamWriter(index.Open());
        writer.Write("<html><body>" + marker + "</body></html>");
    }

    private sealed class ExternalChangeAfterVerification(string target) : MacBundleSigner
    {
        private bool _changed;
        public string? ExternalFingerprint { get; private set; }
        public override void Verify(string bundle)
        {
            base.Verify(bundle);
            if (bundle != target || _changed) return;
            _changed = true;
            AddExternalRevision(bundle);
            new MacBundleSigner().SignAndVerify(bundle);
            ExternalFingerprint = MacBundleFiles.Fingerprint(bundle);
        }
    }

    private sealed class NoProgress : IProgress<InstallProgress>
    {
        public void Report(InstallProgress value) { }
    }

    private sealed class CallbackProgress(Action<InstallProgress> callback) : IProgress<InstallProgress>
    {
        public void Report(InstallProgress value) => callback(value);
    }
}

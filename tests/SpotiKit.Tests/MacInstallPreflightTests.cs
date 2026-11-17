using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using SpotiKit.Models;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public sealed class MacUserPermissionFactAttribute : FactAttribute
{
    public MacUserPermissionFactAttribute()
    {
        if (!OperatingSystem.IsMacOS()) Skip = "Requires macOS app bundle permissions.";
        else if (GetEffectiveUserId() == 0) Skip = "Requires an unprivileged user to check denied parent permissions.";
    }

    [DllImport("/usr/lib/libSystem.B.dylib", EntryPoint = "geteuid")]
    private static extern uint GetEffectiveUserId();
}

public class MacInstallPreflightTests
{
    private const UnixFileMode ReadOnlyDirectory = UnixFileMode.UserRead | UnixFileMode.UserExecute |
        UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute;

    [MacOSFact]
    public void Writable_parent_permits_the_full_preflight_without_changing_the_signed_app()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var before = MacBundleFiles.Fingerprint(fixture.Bundle);
        var siblings = Directory.GetFileSystemEntries(fixture.Root).Order(StringComparer.Ordinal).ToArray();

        Assert.True(MacInstallPreflight.AppliesTo(fixture.Client));
        Assert.Null(MacInstallPreflight.Problem(fixture.Client));

        Assert.Equal(before, MacBundleFiles.Fingerprint(fixture.Bundle));
        Assert.Equal(siblings, Directory.GetFileSystemEntries(fixture.Root).Order(StringComparer.Ordinal));
        new MacBundleSigner().Verify(fixture.Bundle);
    }

    [MacUserPermissionFact]
    public async Task A_writable_Apps_folder_does_not_hide_a_readonly_app_parent()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var originalMode = Mode(fixture.Root);
        var before = MacBundleFiles.Fingerprint(fixture.Bundle);
        try
        {
            SetMode(fixture.Root, ReadOnlyDirectory);
            var oldProbe = Path.Combine(fixture.Client.InstallPath!, "Apps", "old-access-probe");
            File.WriteAllBytes(oldProbe, []);
            File.Delete(oldProbe);

            var problem = MacInstallPreflight.Problem(fixture.Client);
            Assert.NotNull(problem);
            Assert.Contains(fixture.Root, problem);
            Assert.Contains("~/Applications", problem);
            var checks = await new CompatibilityService().RunAsync(fixture.Client,
                new SpotifyVersionList([], SpotifyVersionListSource.Bundled, null), null);
            Assert.Equal(StatusKind.Error, checks.Single(check => check.Title == "Write access").Status);
            Assert.Equal(before, MacBundleFiles.Fingerprint(fixture.Bundle));
            Assert.Empty(Directory.EnumerateFileSystemEntries(fixture.Root, ".spotikit-preflight-*"));
        }
        finally { SetMode(fixture.Root, originalMode); }
    }

    [MacOSFact]
    public void Archive_only_sandboxes_keep_their_existing_write_access_policy()
    {
        using var box = new Sandbox();
        var client = new SpotifyService(box.Paths).Detect();
        Assert.False(MacBundleFiles.IsComplete(client));
        Assert.False(MacInstallPreflight.AppliesTo(client));
        Assert.Null(MacInstallPreflight.Problem(client));
    }

    [MacUserPermissionFact]
    public async Task A_parent_permission_failure_blocks_install_before_creating_a_backup()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var paths = Paths(fixture);
        var backups = new BackupService(paths);
        var log = new ActivityLog(paths);
        var installer = new InstallerService(new SpotifyService(paths), backups, new StateStore(paths), log);
        var originalMode = Mode(fixture.Root);
        var before = MacBundleFiles.Fingerprint(fixture.Bundle);
        try
        {
            SetMode(fixture.Root, ReadOnlyDirectory);
            var result = await installer.InstallAsync(FrameworkPackage.Bundled, 5, new QuietProgress(), CancellationToken.None);
            Assert.False(result.Succeeded);
            Assert.Contains(fixture.Root, result.Message);
            Assert.Empty(backups.List());
            Assert.Equal(before, MacBundleFiles.Fingerprint(fixture.Bundle));
        }
        finally { SetMode(fixture.Root, originalMode); }
    }

    [MacUserPermissionFact]
    public async Task A_parent_permission_failure_blocks_uninstall_before_creating_a_backup()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        XpuiPatcher.Inject(fixture.Archive, FrameworkPackage.Bundled.LoaderScript, FrameworkPackage.Bundled.Version);
        new MacBundleSigner().SignAndVerify(fixture.Bundle);
        var paths = Paths(fixture);
        var backups = new BackupService(paths);
        var installer = new InstallerService(new SpotifyService(paths), backups, new StateStore(paths), new ActivityLog(paths));
        var originalMode = Mode(fixture.Root);
        var before = MacBundleFiles.Fingerprint(fixture.Bundle);
        try
        {
            SetMode(fixture.Root, ReadOnlyDirectory);
            var result = await installer.UninstallAsync(5, new QuietProgress(), CancellationToken.None);
            Assert.False(result.Succeeded);
            Assert.Contains(fixture.Root, result.Message);
            Assert.Empty(backups.List());
            Assert.Equal(before, MacBundleFiles.Fingerprint(fixture.Bundle));
        }
        finally { SetMode(fixture.Root, originalMode); }
    }

    [MacUserPermissionFact]
    public void Direct_restore_checks_the_same_parent_permissions_and_preserves_the_app()
    {
        using var fixture = new MacBundleTests.OwnedBundle();
        var paths = Paths(fixture);
        var backups = new BackupService(paths);
        var backup = backups.Create(fixture.Client, BackupKind.Manual);
        var originalMode = Mode(fixture.Root);
        var before = MacBundleFiles.Fingerprint(fixture.Bundle);
        try
        {
            SetMode(fixture.Root, ReadOnlyDirectory);
            var failure = Assert.Throws<InvalidOperationException>(() => backups.Restore(backup, fixture.Client));
            Assert.Contains(fixture.Root, failure.Message);
            Assert.Equal(before, MacBundleFiles.Fingerprint(fixture.Bundle));
            Assert.Single(backups.List());
        }
        finally { SetMode(fixture.Root, originalMode); }
    }

    private static SpotiKitPaths Paths(MacBundleTests.OwnedBundle fixture)
    {
        var data = Path.Combine(fixture.Root, "SpotiKit Data");
        Directory.CreateDirectory(Path.Combine(data, "Backups"));
        Directory.CreateDirectory(Path.Combine(data, "Logs"));
        return new(data, Path.Combine(data, "settings.json"), fixture.Client.InstallPath, Path.Combine(data, "SpotifyLocal"))
            { IsSandboxed = true };
    }

    private static UnixFileMode Mode(string path) => OperatingSystem.IsMacOS() ? File.GetUnixFileMode(path) : 0;
    private static void SetMode(string path, UnixFileMode mode)
    {
        if (OperatingSystem.IsMacOS()) File.SetUnixFileMode(path, mode);
    }

    private sealed class QuietProgress : IProgress<InstallProgress>
    {
        public void Report(InstallProgress value) { }
    }
}

using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using SpotiKit.Models;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class SpotifyUpdateServiceTests
{
    private static SpotifyInstallation Client(string version = "1.2.3.4") =>
        new(SpotifyEdition.Desktop, version, "C:\\nowhere", false);

    [Fact]
    public void Hold_locks_the_update_folder_and_release_unlocks_it()
    {
        using var box = new Sandbox();
        var service = new SpotifyUpdateService(box.Paths, new StateStore(box.Paths), new ActivityLog(box.Paths));

        Assert.Equal(UpdateHoldState.Allowed, service.GetStatus(Client()).State);

        service.Hold(Client(), automatic: false, discardStagedUpdate: false);
        var held = service.GetStatus(Client());
        Assert.Equal(UpdateHoldState.HeldBySpotiKit, held.State);
        Assert.Equal("1.2.3.4", held.Hold!.SpotifyVersion);
        Assert.False(held.UpdatedDespiteHold);
        Assert.Throws<UnauthorizedAccessException>(() => Directory.EnumerateFileSystemEntries(service.UpdatePath).ToList());
        Assert.ThrowsAny<IOException>(() => Directory.Delete(service.UpdatePath));

        Assert.True(service.GetStatus(Client("1.2.3.5")).UpdatedDespiteHold);

        service.Release();
        Assert.Equal(UpdateHoldState.Allowed, service.GetStatus(Client()).State);
        Assert.False(Directory.Exists(service.UpdatePath));
    }

    [Fact]
    public void A_hold_from_an_older_SpotiKit_is_replaced_by_the_locked_folder()
    {
        using var box = new Sandbox();
        var state = new StateStore(box.Paths);
        var service = new SpotifyUpdateService(box.Paths, state, new ActivityLog(box.Paths));
        Directory.CreateDirectory(box.Paths.SpotifyLocalDataDir);
        File.WriteAllText(service.UpdatePath, "Created by SpotiKit to hold Spotify updates.\nHeld on ...");
        File.SetAttributes(service.UpdatePath, FileAttributes.ReadOnly);
        state.Update(s => s with { Hold = new UpdateHoldRecord(DateTimeOffset.Now, "1.2.3.4", false) });

        Assert.Equal(UpdateHoldState.HeldBySpotiKit, service.GetStatus(Client()).State);
        service.Hold(Client(), false, false);

        Assert.False(File.Exists(service.UpdatePath));
        Assert.True(Directory.Exists(service.UpdatePath));
        Assert.Equal(UpdateHoldState.HeldBySpotiKit, service.GetStatus(Client()).State);
        service.Release();
    }

    [Fact]
    public void A_staged_update_is_only_discarded_when_asked()
    {
        using var box = new Sandbox();
        var service = new SpotifyUpdateService(box.Paths, new StateStore(box.Paths), new ActivityLog(box.Paths));
        Directory.CreateDirectory(service.UpdatePath);
        File.WriteAllText(Path.Combine(service.UpdatePath, "SpotifyUpdate.exe"), "fake");

        Assert.Equal(UpdateHoldState.UpdateStaged, service.GetStatus(Client()).State);
        Assert.Throws<InvalidOperationException>(() => service.Hold(Client(), false, discardStagedUpdate: false));
        Assert.True(Directory.Exists(service.UpdatePath));

        service.Hold(Client(), false, discardStagedUpdate: true);
        Assert.Equal(UpdateHoldState.HeldBySpotiKit, service.GetStatus(Client()).State);
        service.Release();
    }

    [Fact]
    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    public void A_blocker_from_another_tool_is_reported_and_only_removed_when_asked()
    {
        using var box = new Sandbox();
        var service = new SpotifyUpdateService(box.Paths, new StateStore(box.Paths), new ActivityLog(box.Paths));
        Directory.CreateDirectory(box.Paths.SpotifyLocalDataDir);
        File.WriteAllText(service.UpdatePath, "made by someone else");

        Assert.Equal(UpdateHoldState.HeldByOtherTool, service.GetStatus(Client()).State);
        Assert.Throws<InvalidOperationException>(() => service.Release());
        Assert.True(File.Exists(service.UpdatePath));

        File.Delete(service.UpdatePath);
        Directory.CreateDirectory(service.UpdatePath);
        var lockedElsewhere = new DirectoryInfo(service.UpdatePath).GetAccessControl();
        lockedElsewhere.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(
            System.Security.Principal.WindowsIdentity.GetCurrent().User!, System.Security.AccessControl.FileSystemRights.Delete,
            System.Security.AccessControl.AccessControlType.Deny));
        new DirectoryInfo(service.UpdatePath).SetAccessControl(lockedElsewhere);

        Assert.Equal(UpdateHoldState.HeldByOtherTool, service.GetStatus(Client()).State);
        Assert.Throws<InvalidOperationException>(() => service.Hold(Client(), false, false));
        service.Release(includeOtherTools: true);
        Assert.False(Directory.Exists(service.UpdatePath));
    }

    [Fact]
    public void The_store_edition_is_not_supported()
    {
        using var box = new Sandbox();
        var service = new SpotifyUpdateService(box.Paths, new StateStore(box.Paths), new ActivityLog(box.Paths));
        var store = new SpotifyInstallation(SpotifyEdition.MicrosoftStore, null, null, false);

        Assert.Equal(UpdateHoldState.NotSupported, service.GetStatus(store).State);
        Assert.Throws<InvalidOperationException>(() => service.Hold(store, false, false));
    }
}

public class SemanticVersionTests
{
    [Theory]
    [InlineData("1.0.0", "1.0.0-beta", 1)]
    [InlineData("1.0.0-beta.2", "1.0.0-beta.11", -1)]
    [InlineData("1.0.0-alpha", "1.0.0-beta", -1)]
    [InlineData("0.2.0-preview", "0.1.9", 1)]
    [InlineData("1.2", "1.2.0", 0)]
    public void Compares_by_semver_precedence(string a, string b, int expected)
    {
        Assert.True(SemanticVersion.TryParse(a, out var va));
        Assert.True(SemanticVersion.TryParse(b, out var vb));
        Assert.Equal(expected, Math.Sign(va.CompareTo(vb)));
    }

    [Fact]
    public void Default_value_compares_without_throwing()
    {
        Assert.True(SemanticVersion.TryParse("0.0.1", out var v));
        Assert.True(v > default(SemanticVersion));
    }
}

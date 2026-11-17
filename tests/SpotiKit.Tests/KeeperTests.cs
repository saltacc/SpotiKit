using System;
using System.IO;
using SpotiKit.Models;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class KeeperTests
{
    private static readonly Func<string?, bool> Approved = v => v is "1.3.5.3058" or "1.3.6.1921";

    private static UpdateWindowRecord Window(string target = "1.3.6.1921") => new(target, "1.3.5.3058", DateTimeOffset.Now);

    [Fact]
    public void A_held_Spotify_may_update_only_to_a_newer_supported_version()
    {
        var open = UpdateKeeper.DecideGate(UpdateHoldState.HeldBySpotiKit, "1.3.5.3058", null, null, "1.3.6.1921", Approved);
        Assert.True(open.Open);

        Assert.False(UpdateKeeper.DecideGate(UpdateHoldState.HeldBySpotiKit, "1.3.5.3058", null, null, "1.3.7.10", Approved).Open);
        Assert.False(UpdateKeeper.DecideGate(UpdateHoldState.HeldBySpotiKit, "1.3.6.1921", null, null, "1.3.6.1921", Approved).Open);
        Assert.False(UpdateKeeper.DecideGate(UpdateHoldState.HeldBySpotiKit, "1.3.5.3058", null, null, null, Approved).Open);
        Assert.False(UpdateKeeper.DecideGate(UpdateHoldState.Allowed, "1.3.5.3058", null, null, "1.3.6.1921", Approved).Open);
        Assert.False(UpdateKeeper.DecideGate(UpdateHoldState.HeldByOtherTool, "1.3.5.3058", null, null, "1.3.6.1921", Approved).Open);
    }

    [Fact]
    public void Updates_are_held_again_once_Spotify_updated()
    {
        var step = UpdateKeeper.DecideGate(UpdateHoldState.Allowed, "1.3.6.1921", null, Window(), null, Approved);
        Assert.True(step.HoldAgain);
        Assert.Contains("1.3.6.1921", step.Message);
    }

    [Fact]
    public void An_unsupported_download_is_thrown_away_and_a_waiting_window_stays_open()
    {
        Assert.True(UpdateKeeper.DecideGate(UpdateHoldState.UpdateStaged, "1.3.5.3058", "1.3.7.10", Window(), null, Approved).HoldAgain);

        var waiting = UpdateKeeper.DecideGate(UpdateHoldState.UpdateStaged, "1.3.5.3058", "1.3.6.1921", Window(), null, Approved);
        Assert.False(waiting.HoldAgain);
        Assert.False(waiting.Open);
        Assert.False(UpdateKeeper.DecideGate(UpdateHoldState.Allowed, "1.3.5.3058", null, Window(), null, Approved).HoldAgain);
    }

    [Fact]
    public void A_window_closes_when_its_version_loses_support()
    {
        Assert.True(UpdateKeeper.DecideGate(UpdateHoldState.Allowed, "1.3.5.3058", null, Window("1.3.7.10"), null, Approved).HoldAgain);
    }

    [Theory]
    [InlineData("1.3.6.1921", "1.3.5.3058", 1)]
    [InlineData("1.3.6.1921", "1.3.6.1921", 0)]
    [InlineData("1.3.6", "1.3.6.0", 0)]
    [InlineData("1.3.10.1", "1.3.9.900", 1)]
    [InlineData(null, "1.3.5.3058", -1)]
    public void Versions_compare_by_number(string? a, string? b, int expected) =>
        Assert.Equal(expected, Math.Sign(VersionRange.CompareVersions(a, b)));

    [Fact]
    public void Very_old_settings_get_only_supported_updates()
    {
        using var box = new Sandbox();
        Directory.CreateDirectory(Path.GetDirectoryName(box.Paths.SettingsFile)!);
        File.WriteAllText(box.Paths.SettingsFile, "{ \"HoldUpdatesWhileInstalled\": false, \"BackupRetention\": 3 }");
        var service = new SettingsService(box.Paths);

        var migrated = service.Load();
        Assert.Equal(SpotifyUpdateMode.Supported, migrated.UpdateMode);
        Assert.Null(migrated.HoldUpdatesWhileInstalled);
        Assert.True(migrated.RunInBackground);
        Assert.Equal(3, migrated.BackupRetention);
        Assert.Equal(AppSettings.CurrentVersion, migrated.Version);
        Assert.DoesNotContain("HoldUpdatesWhileInstalled", File.ReadAllText(box.Paths.SettingsFile));

        migrated.UpdateMode = SpotifyUpdateMode.Hold;
        service.Save(migrated);
        Assert.Equal(SpotifyUpdateMode.Hold, service.Load().UpdateMode);
    }

    [Theory]
    [InlineData("true", SpotifyUpdateMode.Supported)]
    [InlineData("false", SpotifyUpdateMode.All)]
    public void The_old_switch_becomes_a_mode(string hold, SpotifyUpdateMode expected)
    {
        using var box = new Sandbox();
        Directory.CreateDirectory(Path.GetDirectoryName(box.Paths.SettingsFile)!);
        File.WriteAllText(box.Paths.SettingsFile, "{ \"Version\": 2, \"HoldUpdatesWhileInstalled\": " + hold + " }");
        Assert.Equal(expected, new SettingsService(box.Paths).Load().UpdateMode);
    }

    [Fact]
    public void Fresh_settings_get_only_supported_updates()
    {
        using var box = new Sandbox();
        Assert.Equal(SpotifyUpdateMode.Supported, new SettingsService(box.Paths).Load().UpdateMode);
    }
}

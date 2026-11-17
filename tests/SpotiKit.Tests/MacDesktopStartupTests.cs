using System;
using System.Collections.Generic;
using System.Threading;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class MacDesktopStartupTests
{
    [Fact]
    public void An_active_display_starts_without_waiting_or_reporting_a_problem()
    {
        Assert.True(MacDesktopStartup.WaitForDisplay(() => MacDisplayAvailability.Active,
            TimeSpan.FromSeconds(30), () => TimeSpan.Zero,
            _ => throw new InvalidOperationException("Should not wait"),
            _ => throw new InvalidOperationException("Should not report")));
    }

    [Fact]
    public void Waking_a_display_during_the_grace_period_allows_startup()
    {
        var elapsed = TimeSpan.Zero;
        var notices = new List<string>();
        var reads = 0;
        Assert.True(MacDesktopStartup.WaitForDisplay(
            () => ++reads < 3 ? MacDisplayAvailability.Inactive : MacDisplayAvailability.Active,
            TimeSpan.FromSeconds(1), () => elapsed, delay => elapsed += delay, notices.Add));
        Assert.Equal(3, reads);
        Assert.Single(notices);
        Assert.Contains("waiting", notices[0]);
    }

    [Fact]
    public void A_display_that_stays_asleep_times_out_without_starting_Avalonia()
    {
        var elapsed = TimeSpan.Zero;
        var notices = new List<string>();
        var started = false;
        var exit = MacDesktopStartup.Run(() => started = true,
            () => MacDesktopStartup.WaitForDisplay(() => MacDisplayAvailability.Inactive,
                TimeSpan.FromMilliseconds(400), () => elapsed, delay => elapsed += delay, notices.Add), notices.Add);
        Assert.False(started);
        Assert.Equal(TimeSpan.FromMilliseconds(400), elapsed);
        Assert.Equal(MacDesktopStartup.DisplayUnavailableExitCode, exit);
        Assert.Equal(2, notices.Count);
        Assert.Contains("Wake or connect", notices[1]);
    }

    [Fact]
    public void A_timer_failure_after_the_display_check_is_a_controlled_exit()
    {
        var notices = new List<string>();
        var error = new InvalidOperationException("Avalonia.Native was not able to start the RenderTimer. Native error code is: -6661");
        var exit = MacDesktopStartup.Run(() => throw error, () => true, notices.Add);
        Assert.Equal(MacDesktopStartup.DisplayUnavailableExitCode, exit);
        Assert.Single(notices);
        Assert.Contains("-6661", notices[0]);
    }

    [Fact]
    public void Unrelated_startup_failures_are_not_hidden_as_display_problems()
    {
        var error = new InvalidOperationException("Missing application resource");
        var thrown = Assert.Throws<InvalidOperationException>(() =>
            MacDesktopStartup.Run(() => throw error, () => true, _ => throw new Exception("Should not report")));
        Assert.Same(error, thrown);
    }

    [Theory]
    [InlineData("Avalonia.Native was not able to start the RenderTimer. Native error code is: -6660")]
    [InlineData("Avalonia.Native was not able to start the RenderTimer. Native error code is: -6680")]
    [InlineData("Avalonia.Native was not able to start the RenderTimer.")]
    public void Other_native_timer_errors_are_not_relabelled_as_the_known_display_failure(string message)
    {
        var error = new InvalidOperationException(message);
        Assert.False(MacDesktopStartup.IsDisplayTimerFailure(error));
        Assert.Same(error, Assert.Throws<InvalidOperationException>(() =>
            MacDesktopStartup.Run(() => throw error, () => true, _ => throw new Exception("Should not report"))));
    }

    [Fact]
    public void Unknown_display_availability_allows_native_initialization_to_try()
    {
        Assert.True(MacDesktopStartup.WaitForDisplay(() => MacDisplayAvailability.Unknown,
            TimeSpan.Zero, () => TimeSpan.Zero, _ => throw new Exception("Should not wait"), _ => { }));
    }

    [Fact]
    public void Successful_native_startup_keeps_the_success_exit_code()
    {
        var started = false;
        Assert.Equal(0, MacDesktopStartup.Run(() => started = true, () => true, _ => { }));
        Assert.True(started);
    }

    [Fact]
    public void Waiting_for_a_display_can_be_cancelled()
    {
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        Assert.Throws<OperationCanceledException>(() => MacDesktopStartup.WaitForDisplay(
            () => MacDisplayAvailability.Inactive, TimeSpan.FromSeconds(30), () => TimeSpan.Zero,
            _ => { }, _ => { }, cancelled.Token));
    }

    [MacOSFact]
    public void CoreGraphics_display_query_works_without_creating_a_window()
    {
        if (!OperatingSystem.IsMacOS()) return; // MacOSFact skips other hosts; retain the analyzer guard too.
        Assert.Contains(MacDesktopStartup.ReadDisplayAvailability(),
            new[] { MacDisplayAvailability.Active, MacDisplayAvailability.Inactive, MacDisplayAvailability.Unknown });
    }
}

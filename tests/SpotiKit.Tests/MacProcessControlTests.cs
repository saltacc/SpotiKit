using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class MacProcessControlTests
{
    [Fact]
    public async Task An_already_closed_app_does_not_receive_a_quit_request()
    {
        Assert.True(await MacProcessControl.QuitAsync(TimeSpan.Zero, () => [],
            _ => throw new InvalidOperationException("No process should be targeted"), CancellationToken.None));
    }

    [Fact]
    public async Task Each_running_process_receives_one_normal_quit_request()
    {
        var requests = new List<int>();
        var closed = await MacProcessControl.QuitAsync(TimeSpan.FromSeconds(1),
            () => requests.Count == 0 ? [41, 41, 42] : [],
            pid => { requests.Add(pid); return true; }, CancellationToken.None);
        Assert.True(closed);
        Assert.Equal(new[] { 41, 42 }, requests);
    }

    [Fact]
    public async Task An_accepted_request_is_not_reported_as_closed_until_the_app_exits()
    {
        var snapshots = 0;
        var requests = 0;
        var closed = await MacProcessControl.QuitAsync(TimeSpan.FromSeconds(2),
            () => ++snapshots < 3 ? [42] : [],
            _ => { requests++; return true; }, CancellationToken.None);
        Assert.True(closed);
        Assert.Equal(1, requests);
        Assert.True(snapshots >= 3);
    }

    [Fact]
    public async Task A_refused_quit_aborts_while_the_process_is_still_running()
    {
        var requests = 0;
        var closed = await MacProcessControl.QuitAsync(TimeSpan.FromSeconds(5), () => [42],
            _ => { requests++; return false; }, CancellationToken.None);
        Assert.False(closed);
        Assert.Equal(1, requests);
    }

    [Fact]
    public async Task A_process_that_exits_during_the_quit_request_is_treated_as_closed()
    {
        var running = true;
        var closed = await MacProcessControl.QuitAsync(TimeSpan.Zero, () => running ? [42] : [],
            _ => { running = false; return false; }, CancellationToken.None);
        Assert.True(closed);
    }

    [Fact]
    public async Task An_ignored_quit_times_out_instead_of_reporting_success()
    {
        var requests = 0;
        var closed = await MacProcessControl.QuitAsync(TimeSpan.Zero, () => [42],
            _ => { requests++; return true; }, CancellationToken.None);
        Assert.False(closed);
        Assert.Equal(1, requests);
    }

    [Fact]
    public async Task Cancellation_prevents_a_quit_request()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => MacProcessControl.QuitAsync(TimeSpan.FromSeconds(5),
            () => [42], _ => throw new InvalidOperationException("No process should be targeted"), cancellation.Token));
    }

    [Fact]
    public async Task Cancellation_while_waiting_aborts_the_close_operation()
    {
        using var cancellation = new CancellationTokenSource();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => MacProcessControl.QuitAsync(TimeSpan.FromSeconds(5),
            () => [42], _ => { cancellation.Cancel(); return true; }, cancellation.Token));
    }
}

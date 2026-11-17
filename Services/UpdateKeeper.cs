using System;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using SpotiKit.Models;

namespace SpotiKit.Services;

public enum KeeperResult
{
    Done,
    RestartForAppUpdate,
}

public sealed class UpdateKeeper(
    SettingsService settings,
    StateStore state,
    ActivityLog log,
    SpotifyService spotify,
    SpotifyUpdateService updates,
    SpotifyVersionListService versions,
    SpotifyReleaseService releases,
    InstallerService installer,
    AppUpdateService app,
    Func<bool> isWindowOpen,
    DevToolsService? devTools = null)
{
    private const string Operation = "Background";

    public static readonly TimeSpan AppCheckInterval = TimeSpan.FromHours(6);
    public static readonly TimeSpan SpotifyCheckInterval = TimeSpan.FromHours(3);
    public static readonly TimeSpan ListRefreshInterval = TimeSpan.FromHours(3);
    public static readonly TimeSpan JustStarted = TimeSpan.FromMinutes(3);

    public async Task<KeeperResult> RunOnceAsync(CancellationToken cancellationToken = default)
    {
        var config = settings.Load();
        var client = spotify.Detect();
        var windowOpen = isWindowOpen();

        if (config.CheckForUpdates && !windowOpen && Due(state.Load().AppCheckedAt, AppCheckInterval) &&
            await UpdateAppAsync(cancellationToken))
            return KeeperResult.RestartForAppUpdate;

        if (!windowOpen && devTools is not null && client.Edition == SpotifyEdition.Desktop)
        {
            try
            {
                devTools.KeepOn();
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidDataException)
            {
                log.Warning("DevTools", "The developer tools couldn't be turned on again.", ex.Message);
            }
        }

        if (client.Edition != SpotifyEdition.Desktop || state.Load().Install is null)
            return KeeperResult.Done;

        var list = await VersionListAsync(cancellationToken);
        switch (config.UpdateMode)
        {
            case SpotifyUpdateMode.Supported:
                await GateSpotifyUpdatesAsync(client, list, cancellationToken);
                break;
            case SpotifyUpdateMode.Hold:
                KeepHeld(client);
                break;
            case SpotifyUpdateMode.All:
                KeepAllowed(client);
                break;
        }
        if (!windowOpen)
            await KeepSpotiKitInstalledAsync(list, config, cancellationToken);
        return KeeperResult.Done;
    }

    private static bool Due(DateTimeOffset? last, TimeSpan interval) => last is null || DateTimeOffset.Now - last >= interval;

    private static bool Supported(SpotifyVersionList list, string? version) =>
        list.Find(version) is { Status: SpotifyVersionStatus.Approved } entry && !entry.NeedsNewerApp(AppInfo.Version);

    private async Task<bool> UpdateAppAsync(CancellationToken cancellationToken)
    {
        state.Update(s => s with { AppCheckedAt = DateTimeOffset.Now });
        if (app.CannotUpdateReason is not null)
            return false;
        try
        {
            var check = await app.CheckAsync(cancellationToken);
            if (!check.IsNewer || check.Latest is null)
                return false;
            var downloaded = await app.DownloadAsync(check.Latest, cancellationToken: cancellationToken);
            app.Replace(downloaded);
            log.Success(Operation, $"SpotiKit updated itself to {check.Latest.Version}.");
            return true;
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException or InvalidDataException or TaskCanceledException
                                       or UnauthorizedAccessException or InvalidOperationException)
        {
            log.Warning(Operation, $"Couldn't update SpotiKit: {ex.Message}");
            return false;
        }
    }

    private async Task<SpotifyVersionList> VersionListAsync(CancellationToken cancellationToken)
    {
        var saved = File.Exists(versions.SavedPath) ? File.GetLastWriteTimeUtc(versions.SavedPath) : DateTime.MinValue;
        return DateTime.UtcNow - saved < ListRefreshInterval ? versions.LoadLocal() : await versions.RefreshAsync(cancellationToken);
    }

    private async Task<LatestSpotifyRecord?> LatestSpotifyAsync(CancellationToken cancellationToken)
    {
        var known = state.Load().LatestSpotify;
        if (known is not null && !Due(known.CheckedAt, SpotifyCheckInterval))
            return known;
        try
        {
            var latest = await releases.LatestAsync(known, cancellationToken);
            state.Update(s => s with { LatestSpotify = latest });
            return latest;
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException or InvalidDataException or TaskCanceledException)
        {
            log.Warning(Operation, $"Couldn't check Spotify's newest version: {ex.Message}");
            return known;
        }
    }

    public sealed record GateStep(bool Open, bool HoldAgain, string? Message);

    public static GateStep DecideGate(UpdateHoldState hold, string? installed, string? staged, UpdateWindowRecord? window,
        string? latest, Func<string?, bool> supported)
    {
        if (window is not null)
        {
            if (VersionRange.CompareVersions(installed, window.TargetVersion) >= 0)
                return new(false, true, $"Spotify updated to {installed}. Updates are on hold again.");
            if (hold == UpdateHoldState.UpdateStaged && staged is not null && !supported(staged))
                return new(false, true, $"Spotify downloaded {staged}, which SpotiKit doesn't support yet. It was removed and updates are on hold again.");
            if (!supported(window.TargetVersion))
                return new(false, true, $"Spotify {window.TargetVersion} isn't supported anymore. Updates are on hold again.");
            return new(false, false, null);
        }

        if (hold == UpdateHoldState.HeldBySpotiKit && latest is not null &&
            VersionRange.CompareVersions(latest, installed) > 0 && supported(latest))
            return new(true, false, $"Spotify {latest} is supported. Spotify may update to it now; updates are held again afterwards.");
        return new(false, false, null);
    }

    private async Task GateSpotifyUpdatesAsync(SpotifyInstallation client, SpotifyVersionList list, CancellationToken cancellationToken)
    {
        var status = updates.GetStatus(client);
        var window = state.Load().UpdateWindow;
        var latest = window is null && status.State == UpdateHoldState.HeldBySpotiKit
            ? (await LatestSpotifyAsync(cancellationToken))?.Version
            : null;
        var step = DecideGate(status.State, client.Version, status.StagedVersion, window, latest, v => Supported(list, v));

        if (step.HoldAgain)
            HoldAgain(client, step.Message!);
        else if (step.Open)
        {
            updates.Release(quiet: true);
            state.Update(s => s with { UpdateWindow = new UpdateWindowRecord(latest!, client.Version ?? "", DateTimeOffset.Now) });
            log.Info(Operation, step.Message!);
        }
    }

    private void KeepHeld(SpotifyInstallation client)
    {
        var status = updates.GetStatus(client);
        if (status.State is UpdateHoldState.Allowed or UpdateHoldState.UpdateStaged)
            HoldAgain(client, "Spotify updates are on hold, as set on the Updates page.");
    }

    private void KeepAllowed(SpotifyInstallation client)
    {
        if (updates.GetStatus(client).State != UpdateHoldState.HeldBySpotiKit)
            return;
        updates.Release(quiet: true);
        log.Info(Operation, "Spotify may update on its own, as set on the Updates page.");
    }

    private void HoldAgain(SpotifyInstallation client, string message)
    {
        try
        {
            updates.Hold(client, automatic: true, discardStagedUpdate: true);
            state.Update(s => s with { UpdateWindow = null });
            log.Info(Operation, message);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            log.Warning(Operation, $"Couldn't hold Spotify updates again: {ex.Message}");
        }
    }

    private async Task KeepSpotiKitInstalledAsync(SpotifyVersionList list, AppSettings config, CancellationToken cancellationToken)
    {
        var client = spotify.Detect();
        var missing = !client.HasSpotiKit;
        var outdated = !missing && AppUpdateService.IsNewer(FrameworkPackage.BundledVersion, client.Xpui?.SpotiKitVersion ?? "");
        if (!missing && !outdated)
            return;
        if (InstallerService.InstallBlocker(client) is not null || !Supported(list, client.Version))
            return;

        var running = spotify.IsRunning();
        if (running)
        {
            if (!missing || spotify.RunningFor() is not { } age || age > JustStarted)
                return;
            if (!await spotify.CloseAsync(TimeSpan.FromSeconds(5), cancellationToken))
                return;
        }

        log.Info(Operation, missing
            ? $"Spotify {client.Version} is supported. Adding SpotiKit again."
            : $"Updating SpotiKit in Spotify to {FrameworkPackage.BundledVersion}.");
        var result = await installer.InstallAsync(FrameworkPackage.Bundled, config.BackupRetention, new Progress<InstallProgress>(),
            cancellationToken);

        var after = spotify.Detect();
        if (result.Succeeded && config.UpdateMode != SpotifyUpdateMode.All && state.Load().UpdateWindow is null &&
            updates.GetStatus(after).State == UpdateHoldState.Allowed)
            HoldAgain(after, "Updates are on hold while SpotiKit is installed.");
        if (running)
            spotify.Launch(after);
    }
}

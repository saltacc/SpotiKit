using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SpotiKit.Models;
using SpotiKit.Services;

namespace SpotiKit.ViewModels;

public partial class UpdatesViewModel : ViewModelBase
{
    private readonly SpotifyUpdateService _updates;
    private readonly AppUpdateService _app;
    private readonly ActivityLog _log;
    private readonly DialogService _dialogs;
    private readonly ShellService _shell;
    private readonly Action<AppPage> _navigate;

    public UpdatesViewModel(SpotifyUpdateService updates, AppUpdateService app, ActivityLog log,
        SpotifyStatusViewModel spotify, SettingsViewModel settings, SpotifyVersionsViewModel versions, InstallViewModel install,
        DialogService dialogs, ShellService shell, Action<AppPage> navigate)
    {
        _updates = updates;
        _app = app;
        _log = log;
        _dialogs = dialogs;
        _shell = shell;
        _navigate = navigate;
        Spotify = spotify;
        Settings = settings;
        Versions = versions;
        Install = install;

        _mode = Array.Find(Modes, m => m.Mode == settings.UpdateMode) ?? Modes[0];

        Spotify.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(SpotifyStatusViewModel.Installation))
                Refresh();
        };
        Versions.Changed += (_, _) => Refresh();
        Install.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(InstallViewModel.IsIdle))
                UpdateSpotifyFrameworkCommand.NotifyCanExecuteChanged();
        };
    }

    public SpotifyStatusViewModel Spotify { get; }
    public SettingsViewModel Settings { get; }
    public SpotifyVersionsViewModel Versions { get; }
    public InstallViewModel Install { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HoldTitle), nameof(HoldStatus), nameof(Reasons), nameof(StagedText), nameof(HasStaged),
        nameof(StagedVerdict))]
    public partial SpotifyUpdateStatus? Status { get; private set; }

    [ObservableProperty]
    public partial string? Message { get; private set; }

    [ObservableProperty]
    public partial StatusKind MessageStatus { get; private set; }

    private UpdateWindowRecord? Window => Status?.State is UpdateHoldState.Allowed or UpdateHoldState.UpdateStaged ? _updates.Window : null;

    public static UpdateModeOption[] Modes { get; } =
    [
        new(SpotifyUpdateMode.Supported, "Only supported versions",
            "Spotify updates once SpotiKit supports the new version, and SpotiKit is added back right after."),
        new(SpotifyUpdateMode.All, "All updates",
            "Spotify updates on its own, to any version. One SpotiKit doesn't support yet removes it until it does."),
        new(SpotifyUpdateMode.Hold, "No updates", "Spotify stays on the version it has now."),
    ];

    private UpdateModeOption _mode;
    private bool _switching;

    public UpdateModeOption SelectedMode
    {
        get => _mode;
        set
        {
            if (value is null || value == _mode || _switching)
                return;
            var previous = _mode;
            _mode = value;
            OnPropertyChanged();
            _ = SwitchModeAsync(previous, value);
        }
    }
    public bool HasStaged => Status?.State == UpdateHoldState.UpdateStaged;
    public string StagedText => Status?.StagedVersion is { } v ? $"Spotify {v} is downloaded and waiting" : "An update is downloaded and waiting";

    public string StagedVerdict => Status?.StagedVersion is not { } v ? "Its version is unknown."
        : Versions.IsApproved(v) ? $"{v} is supported."
        : $"{v} isn't supported yet.";

    public string HoldTitle => Window is not null ? "Updates are on hold" : Status?.State switch
    {
        UpdateHoldState.HeldBySpotiKit => "Updates are on hold",
        UpdateHoldState.HeldByOtherTool => "Held by another tool",
        UpdateHoldState.UpdateStaged => "An update is waiting",
        UpdateHoldState.NotSupported => "Not available",
        _ => "Spotify updates normally",
    };

    public StatusKind HoldStatus => Window is not null ? StatusKind.Success : Status?.State switch
    {
        UpdateHoldState.HeldBySpotiKit when Status.UpdatedDespiteHold => StatusKind.Error,
        UpdateHoldState.HeldBySpotiKit => StatusKind.Success,
        UpdateHoldState.HeldByOtherTool or UpdateHoldState.UpdateStaged => StatusKind.Warning,
        UpdateHoldState.NotSupported => StatusKind.Neutral,
        _ => StatusKind.Neutral,
    };

    public IReadOnlyList<string> Reasons => BuildReasons();

    public void Refresh()
    {
        Status = _updates.GetStatus(Spotify.Installation);
        OnPropertyChanged(nameof(Reasons));
        OnPropertyChanged(nameof(StagedVerdict));
        OnPropertyChanged(nameof(InstalledFrameworkText));
        OnPropertyChanged(nameof(SpotifyFrameworkIsOutdated));
        UpdateSpotifyFrameworkCommand.NotifyCanExecuteChanged();
    }

    private async Task SwitchModeAsync(UpdateModeOption previous, UpdateModeOption next)
    {
        Refresh();
        var staged = Status?.State == UpdateHoldState.UpdateStaged;
        var stagedSupported = Status?.StagedVersion is { } v && Versions.IsApproved(v);
        var confirmed = next.Mode switch
        {
            SpotifyUpdateMode.All => await _dialogs.ConfirmAsync("Let Spotify update to any version?",
                "Spotify updates itself, also to versions SpotiKit doesn't support yet. Such an update removes SpotiKit until it supports that version.",
                "Allow all updates"),
            SpotifyUpdateMode.Hold when staged => await _dialogs.ConfirmAsync("Discard the downloaded update?",
                $"{StagedText}. Holding updates deletes that download, and Spotify stays on {Spotify.Installation.Version}.",
                "Discard and hold", isDestructive: true),
            _ => true,
        };
        if (!confirmed)
        {
            _switching = true;
            _mode = previous;
            OnPropertyChanged(nameof(SelectedMode));
            _switching = false;
            return;
        }

        Settings.UpdateMode = next.Mode;
        if (Status?.State == UpdateHoldState.HeldByOtherTool)
        {
            MessageStatus = StatusKind.Warning;
            Message = "Another tool holds Spotify's updates. SpotiKit leaves that alone.";
            return;
        }

        switch (next.Mode)
        {
            case SpotifyUpdateMode.All:
                Run(() => _updates.Release(quiet: true), "Spotify updates on its own now.");
                break;
            case SpotifyUpdateMode.Hold:
                Run(() => _updates.Hold(Spotify.Installation, automatic: false, discardStagedUpdate: staged),
                    "Spotify updates are on hold.");
                break;
            case SpotifyUpdateMode.Supported when Window is null && (Status?.State is UpdateHoldState.Allowed || (staged && !stagedSupported)):
                Run(() => _updates.Hold(Spotify.Installation, automatic: true, discardStagedUpdate: staged),
                    "Spotify only updates to versions SpotiKit supports.");
                break;
            default:
                MessageStatus = StatusKind.Success;
                Message = "Spotify only updates to versions SpotiKit supports.";
                break;
        }
    }

    private void Run(Action action, string success)
    {
        try
        {
            action();
            MessageStatus = StatusKind.Success;
            Message = success;
        }
        catch (Exception ex)
        {
            MessageStatus = StatusKind.Error;
            Message = _log.Error("Spotify updates", ex).Message;
        }

        Refresh();
    }

    private List<string> BuildReasons()
    {
        var reasons = new List<string>();
        var version = Spotify.Installation.Version;
        switch (Status)
        {
            case null:
                break;
            case { State: UpdateHoldState.Allowed or UpdateHoldState.UpdateStaged } when Window is { } window:
                reasons.Add($"Spotify {window.TargetVersion} is supported, so Spotify may update to it now.");
                reasons.Add("Updates are held again right after, and SpotiKit is added back.");
                break;
            case { State: UpdateHoldState.NotSupported }:
                reasons.Add(Spotify.Installation.Edition == SpotifyEdition.MicrosoftStore
                    ? "The Microsoft Store version updates through the Store."
                    : "Spotify wasn't found.");
                break;
            case { State: UpdateHoldState.HeldBySpotiKit, Hold: var hold }:
                reasons.Add(hold is { Automatic: true }
                    ? $"Held automatically on {hold.HeldAt:g}."
                    : hold is not null
                        ? $"Held on {hold.HeldAt:g}."
                        : "Updates are held.");
                reasons.Add($"Spotify stays on {version}.");
                if (Status.UpdatedDespiteHold)
                    reasons.Add($"Spotify updated from {hold?.SpotifyVersion} to {version} anyway. The hold may not work for this version.");
                break;
            case { State: UpdateHoldState.HeldByOtherTool }:
                reasons.Add("Held by another tool, like SpotX. SpotiKit leaves it alone.");
                break;
            case { State: UpdateHoldState.UpdateStaged }:
                reasons.Add($"{StagedText}. It installs when Spotify restarts and removes SpotiKit.");
                if (Status.StagedVersion is { } staged)
                    reasons.Add(Versions.IsApproved(staged)
                        ? $"{staged} is supported, so that's fine."
                        : $"{staged} isn't supported yet. \"Only supported versions\" throws it away.");
                break;
            default:
                reasons.Add("Spotify updates normally. Each update removes SpotiKit until you reinstall it.");
                break;
        }

        if (version is not null && Status?.State != UpdateHoldState.NotSupported)
            reasons.Add(Versions.Find(version) switch
            {
                { Status: SpotifyVersionStatus.Broken } => $"{version} doesn't work with SpotiKit.",
                { } entry when entry.NeedsNewerApp(AppInfo.Version) => $"{version} needs SpotiKit {entry.MinApp}. Update SpotiKit below.",
                { } => $"{version} is supported.",
                null => $"{version} isn't supported yet.",
            });

        return reasons;
    }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasUpdate), nameof(LatestText), nameof(LatestNotes))]
    [NotifyCanExecuteChangedFor(nameof(UpdateAppCommand))]
    public partial AppUpdateCheck? LastCheck { get; private set; }

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(CheckCommand), nameof(UpdateAppCommand))]
    public partial bool IsChecking { get; private set; }

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(CheckCommand), nameof(UpdateAppCommand))]
    [NotifyPropertyChangedFor(nameof(DownloadText))]
    public partial bool IsDownloading { get; private set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(DownloadText))]
    public partial double DownloadProgress { get; private set; }

    [ObservableProperty]
    public partial string? CheckMessage { get; private set; }

    [ObservableProperty]
    public partial StatusKind CheckStatus { get; private set; }

    public string AppVersion => AppInfo.Version;
    public string InstalledFrameworkText => Spotify.SpotiKitVersion is { } v ? v : "Not installed";

    public bool SpotifyFrameworkIsOutdated => Spotify.SpotiKitVersion is { } v && AppUpdateService.IsNewer(AppInfo.Version, v);

    public bool HasUpdate => LastCheck is { IsNewer: true };
    public string LatestText => LastCheck?.Latest is { } r ? $"SpotiKit {r.Version}, released {r.Published.ToLocalTime():d}" : "";
    public string? LatestNotes => ReleaseNotes.ToPlainText(LastCheck?.Latest?.Notes);
    public string DownloadText => $"Downloading… {DownloadProgress * 100:0}%";

    public string? CannotUpdateReason => _app.CannotUpdateReason;

    private bool CanCheck() => !IsChecking && !IsDownloading;

    [RelayCommand(CanExecute = nameof(CanCheck))]
    public async Task CheckAsync()
    {
        IsChecking = true;
        try
        {
            var check = await _app.CheckAsync();
            LastCheck = check;
            (CheckStatus, CheckMessage) = check switch
            {
                { Latest: null } => (StatusKind.Neutral, "No release yet."),
                { IsNewer: true } => (StatusKind.Warning, $"SpotiKit {check.Latest.Version} is available."),
                _ => (StatusKind.Success, "You're up to date."),
            };
            _log.Info("SpotiKit updates", CheckMessage);
        }
        catch (Exception ex) when (ex is System.Net.Http.HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            CheckStatus = StatusKind.Error;
            CheckMessage = ex is TaskCanceledException ? "GitHub didn't answer in time." : ex.Message;
            _log.Warning("SpotiKit updates", $"Couldn't check for updates: {CheckMessage}");
        }
        finally
        {
            IsChecking = false;
        }
    }

    private bool CanUpdateApp() => HasUpdate && !IsChecking && !IsDownloading;

    [RelayCommand(CanExecute = nameof(CanUpdateApp))]
    private async Task UpdateAppAsync()
    {
        if (LastCheck?.Latest is not { } release)
            return;

        if (_app.CannotUpdateReason is { } reason)
        {
            CheckStatus = StatusKind.Neutral;
            CheckMessage = reason;
            _shell.OpenUrl(release.PageUrl);
            return;
        }

        var confirmed = await _dialogs.ConfirmAsync(
            $"Update to SpotiKit {release.Version}?",
            "SpotiKit restarts after the update. Reinstall afterwards to update Spotify too.",
            "Update and restart");
        if (!confirmed)
            return;

        IsDownloading = true;
        DownloadProgress = 0;
        try
        {
            var file = await _app.DownloadAsync(release, new Progress<double>(p => DownloadProgress = p));
            _app.Replace(file);
            _log.Success("SpotiKit updates", $"Updating to SpotiKit {release.Version}");
            _app.StartNewVersion();
            _shell.Quit();
        }
        catch (Exception ex)
        {
            CheckStatus = StatusKind.Error;
            CheckMessage = _log.Error("SpotiKit updates", ex).Message;
        }
        finally
        {
            IsDownloading = false;
        }
    }

    [RelayCommand]
    private void OpenReleases() => _shell.OpenUrl(LastCheck?.Latest?.PageUrl ?? SpotiKitRepository.ReleasesPage);

    private bool CanUpdateSpotifyFramework() => SpotifyFrameworkIsOutdated && Install.IsIdle;

    [RelayCommand(CanExecute = nameof(CanUpdateSpotifyFramework))]
    private void UpdateSpotifyFramework()
    {
        _navigate(AppPage.Install);
        if (Install.InstallCommand.CanExecute(null))
            Install.InstallCommand.Execute(null);
    }
}

public sealed record UpdateModeOption(SpotifyUpdateMode Mode, string Title, string Text);

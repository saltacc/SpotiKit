using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SpotiKit.Models;
using SpotiKit.Services;

namespace SpotiKit.ViewModels;

public enum InstallState
{
    Idle,
    Working,
    Completed,
    Cancelled,
    Failed,
}

public partial class InstallViewModel : ViewModelBase
{
    private const int MaxLogEntries = 400;

    private readonly InstallerService _installer;
    private readonly SpotifyService _spotifyService;
    private readonly SpotifyUpdateService _updates;
    private readonly StateStore _state;
    private readonly ActivityLog _log;
    private readonly DialogService _dialogs;
    private readonly ShellService _shell;
    private readonly SpicetifyService _spicetify;
    private readonly SpotifyPause _pause;
    private readonly SynchronizationContext? _ui = SynchronizationContext.Current;
    private bool _isUninstalling;

    public InstallViewModel(InstallerService installer, SpotifyService spotifyService, SpotifyUpdateService updates,
        StateStore state, ActivityLog log, SpotifyStatusViewModel spotify, SettingsViewModel settings,
        DialogService dialogs, ShellService shell, SpicetifyService spicetify)
    {
        _spicetify = spicetify;
        _installer = installer;
        _spotifyService = spotifyService;
        _updates = updates;
        _state = state;
        _log = log;
        _dialogs = dialogs;
        _shell = shell;
        Spotify = spotify;
        Settings = settings;
        _pause = new SpotifyPause(spotifyService, spotify, log);

        LogEntries = new ObservableCollection<LogEntry>(log.Entries.TakeLast(MaxLogEntries));
        log.EntryAdded += OnLogEntryAdded;
        Spotify.PropertyChanged += OnSpotifyChanged;
        BuildPlan(InstallerService.InstallPlanFor(Spotify.Installation));
        SpicetifyStatus = _spicetify.Detect(Spotify.Installation);
    }

    public event EventHandler? OperationCompleted;

    public SpotifyStatusViewModel Spotify { get; }
    public SettingsViewModel Settings { get; }

    public ObservableCollection<InstallStepViewModel> Steps { get; } = [];
    public ObservableCollection<LogEntry> LogEntries { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsWorking), nameof(IsIdle), nameof(Status), nameof(Headline), nameof(Detail),
        nameof(IsCompleted), nameof(CanUninstall), nameof(ShowBlocker), nameof(CanOfferClose), nameof(ShowSpicetify))]
    [NotifyCanExecuteChangedFor(nameof(InstallCommand), nameof(UninstallCommand), nameof(CloseSpotifyCommand), nameof(StartSafeModeCommand))]
    public partial InstallState State { get; private set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ProgressText))]
    public partial double Progress { get; private set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Detail))]
    public partial string? CurrentStepTitle { get; private set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Detail), nameof(HasError))]
    public partial LogEntry? LastError { get; private set; }

    [ObservableProperty]
    public partial bool IsClosingSpotify { get; private set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowSpicetify), nameof(SpicetifyText), nameof(ShowBlocker))]
    public partial SpicetifyStatus SpicetifyStatus { get; private set; } = SpicetifyStatus.None;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(RemoveSpicetifyCommand))]
    public partial bool IsRemovingSpicetify { get; private set; }

    public bool ShowSpicetify => IsIdle && SpicetifyStatus.IsPresent;

    public string SpicetifyText => SpicetifyStatus.IsApplied
        ? "Spicetify has changed Spotify's files, so SpotiKit can't be installed. Remove it and Spotify gets its own files back."
        : "Spicetify is installed on this PC. It and SpotiKit both change Spotify, so only one of them should be on it.";

    public bool IsWorking => State == InstallState.Working;
    public bool IsIdle => !IsWorking;
    public bool HasError => LastError is not null && State == InstallState.Failed;

    public bool IsInstalled => Spotify.HasSpotiKit;
    public string? InstalledVersion => Spotify.SpotiKitVersion;

    public bool IsCompleted => (State == InstallState.Completed && !_isUninstalling) || (State == InstallState.Idle && IsInstalled);

    public string ProgressText => $"{Progress * 100:0}%";

    public string? Blocker => Spotify.IsChecking ? null : InstallerService.InstallBlocker(Spotify.Installation with { IsRunning = false });

    public bool ShowBlocker => IsIdle && Blocker is not null && !SpicetifyStatus.IsApplied;

    public bool CanOfferClose => Spotify.IsRunning && IsIdle;

    public bool CanUninstall => IsIdle && IsInstalled;

    public bool WasRemovedByUpdate => _state.Load().Install?.WasReplaced(Spotify.Installation) == true;

    public StatusKind Status => State switch
    {
        InstallState.Working => StatusKind.Busy,
        InstallState.Completed when WasRemovedByUpdate => StatusKind.Warning,
        InstallState.Completed => StatusKind.Success,
        InstallState.Cancelled => StatusKind.Warning,
        InstallState.Failed => StatusKind.Error,
        _ when WasRemovedByUpdate => StatusKind.Warning,
        _ => IsInstalled ? StatusKind.Success : StatusKind.Neutral,
    };

    public string Headline => State switch
    {
        InstallState.Working => _isUninstalling ? "Removing SpotiKit" : "Installing SpotiKit",
        InstallState.Completed when WasRemovedByUpdate => "Removed by a Spotify update",
        InstallState.Completed => _isUninstalling ? "SpotiKit removed" : "Installation complete",
        InstallState.Cancelled => "Cancelled",
        InstallState.Failed => _isUninstalling ? "Removal failed" : "Installation failed",
        _ when IsInstalled => $"SpotiKit {InstalledVersion} is installed",
        _ when WasRemovedByUpdate => "Removed by a Spotify update",
        _ => "Ready to install",
    };

    public string Detail => State switch
    {
        InstallState.Working => CurrentStepTitle ?? "Starting…",
        InstallState.Completed when WasRemovedByUpdate => "Spotify replaced the patched app. Recheck Compatibility, then reinstall SpotiKit for the new build.",
        InstallState.Completed when _isUninstalling => "Spotify is back to its own files.",
        InstallState.Completed => "SpotiKit loads the next time Spotify starts.",
        InstallState.Cancelled => "Spotify was not changed.",
        InstallState.Failed => LastError?.Message ?? "Something went wrong.",
        _ when IsInstalled && AppUpdateService.IsNewer(FrameworkPackage.BundledVersion, InstalledVersion ?? "") =>
            $"Reinstall to update Spotify to SpotiKit {FrameworkPackage.BundledVersion}.",
        _ when IsInstalled => "Reinstall any time to repair it.",
        _ when WasRemovedByUpdate => "A Spotify update removed SpotiKit. Install it again.",
        _ when !Spotify.IsDesktopEdition => "Install the Spotify desktop app first.",
        _ => $"Adds SpotiKit {FrameworkPackage.BundledVersion} to Spotify.",
    };

    public string ActionText => IsInstalled ? "Reinstall SpotiKit" : "Install SpotiKit";

    private bool CanInstall() => IsIdle && Blocker is null;

    [RelayCommand(CanExecute = nameof(CanInstall), IncludeCancelCommand = true)]
    private async Task InstallAsync(CancellationToken cancellationToken)
    {
        var package = FrameworkPackage.Bundled;
        var changes = await Task.Run(() => _installer.Preview(package), cancellationToken);
        if (!await _dialogs.ConfirmAsync(IsInstalled ? "Reinstall SpotiKit?" : "Install SpotiKit?",
                Spotify.IsRunning
                    ? "Spotify closes for this and starts again when it's done. This is what changes in Spotify:"
                    : "This is what changes in Spotify:",
                IsInstalled ? "Reinstall" : "Install", changes))
            return;

        var closed = await _pause.CloseAsync(IsInstalled ? "reinstall SpotiKit" : "install SpotiKit");
        if (closed is null)
        {
            await _dialogs.AlertAsync("Spotify is still running", SpotifyPause.StillRunning);
            return;
        }
        await InstallPackageAsync(package, cancellationToken);
        if (closed.Value && (State != InstallState.Completed || !Settings.LaunchSpotifyAfterInstall))
            _pause.Resume(true);
    }

    public async Task InstallPackageAsync(FrameworkPackage package, CancellationToken cancellationToken = default)
    {
        if (!IsIdle)
            return;

        _isUninstalling = false;
        BuildPlan(InstallerService.InstallPlanFor(Spotify.Installation));
        StartRun();

        var result = await _installer.InstallAsync(package, Settings.BackupRetention, new Progress<InstallProgress>(ReportProgress),
            cancellationToken);

        if (result.Succeeded)
        {
            await AfterInstallAsync();
            FinishRun(InstallState.Completed);
        }
        else
        {
            FinishRun(cancellationToken.IsCancellationRequested ? InstallState.Cancelled : InstallState.Failed);
        }
    }

    [RelayCommand(CanExecute = nameof(CanUninstall))]
    private async Task UninstallAsync()
    {
        var running = Spotify.IsRunning;
        var confirmed = await _dialogs.ConfirmAsync(
            "Remove SpotiKit?",
            (running ? "Spotify will be closed first. " : "") + "Spotify goes back to its own files.",
            running ? "Close Spotify and remove" : "Remove SpotiKit", isDestructive: true);
        if (!confirmed)
            return;

        if (running)
        {
            _log.Info("Spotify", "Closing Spotify to remove SpotiKit…");
            var closed = await _spotifyService.CloseAsync(TimeSpan.FromSeconds(5));
            await Spotify.ReloadAsync();
            if (!closed || Spotify.IsRunning)
            {
                _log.Warning("Spotify", "Spotify is still running, so SpotiKit was not removed.");
                await _dialogs.AlertAsync("Spotify is still running",
                    SpotifyService.QuitHint);
                return;
            }
        }

        _isUninstalling = true;
        BuildPlan(InstallerService.UninstallPlan);
        StartRun();

        var result = await _installer.UninstallAsync(Settings.BackupRetention, new Progress<InstallProgress>(ReportProgress),
            CancellationToken.None);

        if (result.Succeeded && _state.Load().Hold is { Automatic: true })
        {
            try
            {
                _updates.Release();
                _log.Info("Spotify updates", "The automatic update hold was lifted because SpotiKit is no longer installed.");
            }
            catch (Exception ex)
            {
                _log.Error("Spotify updates", ex);
            }
        }

        if (running && !_spotifyService.IsSandboxed)
        {
            _spotifyService.Launch(Spotify.Installation);
            _log.Info("Spotify", "Starting Spotify again");
        }

        FinishRun(result.Succeeded ? InstallState.Completed : InstallState.Failed);
    }

    private bool CanCloseSpotify() => IsIdle && !IsClosingSpotify;

    [RelayCommand(CanExecute = nameof(CanCloseSpotify))]
    private async Task CloseSpotifyAsync()
    {
        IsClosingSpotify = true;
        CloseSpotifyCommand.NotifyCanExecuteChanged();
        _log.Info("Spotify", "Asking Spotify to close…");
        var closed = await _spotifyService.CloseAsync(TimeSpan.FromSeconds(5));
        if (closed)
            _log.Success("Spotify", "Spotify is closed.");
        else
            _log.Warning("Spotify", "Spotify is still running.", SpotifyService.QuitHint);
        await Spotify.ReloadAsync();
        IsClosingSpotify = false;
        CloseSpotifyCommand.NotifyCanExecuteChanged();
    }

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(StartSafeModeCommand))]
    public partial bool IsStartingSafeMode { get; private set; }

    private bool CanStartSafeMode() => IsIdle && IsInstalled && !IsStartingSafeMode && !_spotifyService.IsSandboxed;

    [RelayCommand(CanExecute = nameof(CanStartSafeMode))]
    private async Task StartSafeModeAsync()
    {
        if (!await _dialogs.ConfirmAsync("Start Spotify in safe mode?",
                "Spotify restarts without extensions, apps, themes and snippets. Under Installed in the Marketplace you can start them " +
                "one at a time to find the one causing trouble. Leave safe mode from the banner there or from the profile menu.",
                "Restart in safe mode"))
            return;

        IsStartingSafeMode = true;
        try
        {
            _log.Info("Safe mode", "Restarting Spotify in safe mode…");
            await SpotifyPage.OpenAsync(_spotifyService, Spotify.Installation, null);
            await SpotifyPage.EvaluateAsync(
                "localStorage.setItem('spotikit:safe-mode','true'); setTimeout(function () { location.reload(); }, 50); 'ok'");
            var deadline = DateTime.UtcNow.AddSeconds(30);
            while (true)
            {
                await Task.Delay(700);
                try
                {
                    if (await SpotifyPage.EvaluateAsync("!!(window.SpotiKit && window.SpotiKit.safeMode)") == "true")
                        break;
                }
                catch (Exception ex) when (ex is InvalidOperationException or System.Net.WebSockets.WebSocketException
                                               or System.Net.Http.HttpRequestException or TaskCanceledException)
                {
                }
                if (DateTime.UtcNow > deadline)
                    throw new TimeoutException("Spotify didn't come back in safe mode. Start it again and retry.");
            }
            _log.Success("Safe mode", "Spotify runs in safe mode. Extensions, apps, themes and snippets were not started.");
        }
        catch (Exception ex)
        {
            var entry = _log.Error("Safe mode", ex);
            await _dialogs.AlertAsync("Safe mode didn't start", entry.Message);
        }
        finally
        {
            IsStartingSafeMode = false;
            await Spotify.ReloadAsync();
        }
    }

    private bool CanRemoveSpicetify() => IsIdle && !IsRemovingSpicetify;

    [RelayCommand(CanExecute = nameof(CanRemoveSpicetify))]
    private async Task RemoveSpicetifyAsync()
    {
        var status = SpicetifyStatus;
        var running = Spotify.IsRunning && status.IsApplied;
        if (!await _dialogs.ConfirmAsync("Remove Spicetify?",
                (status.IsApplied ? "Spotify gets its own files back from Spicetify's backup. Its changed files are kept until that checks out. " : "") +
                (running ? "Spotify will be closed first. " : "") + "Then Spicetify is removed from this PC.",
                running ? "Close Spotify and remove" : "Remove Spicetify", isDestructive: true))
            return;
        var keepSettings = status.HasConfig && !await _dialogs.ConfirmAsync("Delete Spicetify's themes and extensions too?",
            "Its settings, themes and extensions are in %APPDATA%\\spicetify. Keep them if you want to use them with Spicetify again later.",
            "Delete them", isDestructive: true, cancelText: "Keep them");

        IsRemovingSpicetify = true;
        try
        {
            if (running)
            {
                _log.Info("Spotify", "Closing Spotify to remove Spicetify…");
                await _spotifyService.CloseAsync(TimeSpan.FromSeconds(5));
                await Spotify.ReloadAsync();
                if (Spotify.IsRunning)
                {
                    await _dialogs.AlertAsync("Spotify is still running", SpotifyService.QuitHint);
                    return;
                }
            }

            var installation = Spotify.Installation;
            var result = await Task.Run(() => _spicetify.Remove(installation, keepSettings));
            await Spotify.ReloadAsync();
            SpicetifyStatus = _spicetify.Detect(Spotify.Installation);
            if (running && result.Succeeded && !_spotifyService.IsSandboxed)
                _spotifyService.Launch(Spotify.Installation);
            await _dialogs.AlertAsync(result.Succeeded ? "Spicetify removed" : "Spicetify wasn't removed",
                result.Message + (result.PackageManagerCommand is { } command ? $" Spicetify itself came from a package manager; remove it with: {command}" : ""));
        }
        finally
        {
            IsRemovingSpicetify = false;
        }
    }

    [RelayCommand]
    private Task CopyLogAsync() => _shell.CopyAsync(ActivityLog.Format(LogEntries));

    [RelayCommand]
    private void OpenLogFolder() => _shell.OpenFolder(_log.LogsDirectory);

    private void StartRun()
    {
        LastError = null;
        Progress = 0;
        CurrentStepTitle = null;
        State = InstallState.Working;
    }

    private void FinishRun(InstallState state)
    {
        if (state == InstallState.Failed)
            LastError = LogEntries.LastOrDefault(e => e.Level == LogLevel.Error);

        if (state == InstallState.Completed)
        {
            foreach (var step in Steps)
                step.Status = StatusKind.Success;
            Progress = 1;
        }
        else
        {
            foreach (var step in Steps.Where(s => s.Status == StatusKind.Busy))
                step.Status = state == InstallState.Failed ? StatusKind.Error : StatusKind.Warning;
        }

        State = state;
        _ = RefreshAfterRunAsync();
    }

    private async Task RefreshAfterRunAsync()
    {
        await Spotify.ReloadAsync();
        OnPropertyChanged(nameof(IsCompleted));
        OperationCompleted?.Invoke(this, EventArgs.Empty);
    }

    private async Task AfterInstallAsync()
    {
        await Spotify.ReloadAsync();

        if (Settings.UpdateMode != SpotifyUpdateMode.All)
        {
            try
            {
                var status = _updates.GetStatus(Spotify.Installation);
                if (status.State == UpdateHoldState.UpdateStaged)
                    _log.Warning("Spotify updates", "Spotify has a downloaded update waiting, so updates were not held automatically.",
                        "Decide on the Updates page whether to keep or discard it.");
                else if (status.State == UpdateHoldState.Allowed)
                    _updates.Hold(Spotify.Installation, automatic: true, discardStagedUpdate: false);
            }
            catch (Exception ex)
            {
                _log.Error("Spotify updates", ex);
            }
        }

        if (Settings.LaunchSpotifyAfterInstall && !_spotifyService.IsSandboxed)
        {
            _spotifyService.Launch(Spotify.Installation);
            _log.Info("Spotify", "Starting Spotify");
        }
    }

    private void ReportProgress(InstallProgress report)
    {
        if (State != InstallState.Working)
            return;

        if (report.Plan is { } plan && !Steps.Select(step => step.Title).SequenceEqual(plan.Select(step => step.Title)))
            BuildPlan(plan);

        for (var i = 0; i < Steps.Count; i++)
        {
            var step = Steps[i];
            if (i < report.StepIndex)
            {
                step.Status = StatusKind.Success;
                step.Progress = 1;
            }
            else if (i == report.StepIndex)
            {
                step.Status = StatusKind.Busy;
                step.Progress = report.StepFraction;
                CurrentStepTitle = step.Title;
            }
        }

        Progress = (report.StepIndex + report.StepFraction) / Steps.Count;
    }

    private void BuildPlan(IReadOnlyList<InstallStepInfo> plan)
    {
        Steps.Clear();
        for (var i = 0; i < plan.Count; i++)
            Steps.Add(new InstallStepViewModel(i + 1, plan[i].Title, plan[i].Description, i == plan.Count - 1));
        Progress = State == InstallState.Idle && IsInstalled ? 1 : 0;
    }

    private void OnLogEntryAdded(object? sender, LogEntry entry)
    {
        void Add()
        {
            LogEntries.Add(entry);
            while (LogEntries.Count > MaxLogEntries)
                LogEntries.RemoveAt(0);
        }

        if (_ui is null || SynchronizationContext.Current == _ui)
            Add();
        else
            _ui.Post(_ => Add(), null);
    }

    private void OnSpotifyChanged(object? sender, PropertyChangedEventArgs e)
    {
        OnPropertyChanged(nameof(IsInstalled));
        OnPropertyChanged(nameof(InstalledVersion));
        OnPropertyChanged(nameof(Blocker));
        if (e.PropertyName == nameof(SpotifyStatusViewModel.Installation))
            SpicetifyStatus = _spicetify.Detect(Spotify.Installation);
        OnPropertyChanged(nameof(ShowBlocker));
        OnPropertyChanged(nameof(CanOfferClose));
        OnPropertyChanged(nameof(CanUninstall));
        OnPropertyChanged(nameof(WasRemovedByUpdate));
        OnPropertyChanged(nameof(Status));
        OnPropertyChanged(nameof(Headline));
        OnPropertyChanged(nameof(Detail));
        OnPropertyChanged(nameof(ActionText));
        OnPropertyChanged(nameof(IsCompleted));
        InstallCommand.NotifyCanExecuteChanged();
        UninstallCommand.NotifyCanExecuteChanged();
        StartSafeModeCommand.NotifyCanExecuteChanged();

        if (State == InstallState.Idle && e.PropertyName == nameof(SpotifyStatusViewModel.Installation))
        {
            var plan = InstallerService.InstallPlanFor(Spotify.Installation);
            if (Steps.Count != plan.Count)
                BuildPlan(plan);
            Progress = IsInstalled ? 1 : 0;
        }
    }
}

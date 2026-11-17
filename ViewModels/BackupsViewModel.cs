using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SpotiKit.Models;
using SpotiKit.Services;

namespace SpotiKit.ViewModels;

public sealed partial class BackupItemViewModel(BackupInfo info, string? restoreBlocker) : ObservableObject
{
    public BackupInfo Info { get; } = info;
    public string Id => Info.Manifest.Id;
    public string CreatedText => Info.Manifest.CreatedAt.ToString("g");
    public string VersionText => $"Spotify {Info.Manifest.SpotifyVersion}";
    public string SizeText => BackupsViewModel.FormatSize(Info.TotalSize);
    public string KindText => Info.Manifest.Kind == BackupKind.Manual ? "Made by you" : "Made before a change";
    public bool IsOriginal => Info.Manifest.IsPristine;
    public string TitleText => IsOriginal ? "Original Spotify" : "Spotify with SpotiKit";
    public string Directory => Info.Directory;
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanRestore))]
    public partial string? RestoreBlocker { get; set; } = restoreBlocker;

    public bool CanRestore => RestoreBlocker is null;
}

public partial class BackupsViewModel : ViewModelBase
{
    private readonly BackupService _backups;
    private readonly InstallerService _installer;
    private readonly ActivityLog _log;
    private readonly DialogService _dialogs;
    private readonly ShellService _shell;
    private readonly SpotifyPause _pause;

    public BackupsViewModel(BackupService backups, InstallerService installer, ActivityLog log, SpotifyStatusViewModel spotify,
        SettingsViewModel settings, DialogService dialogs, ShellService shell, SpotifyPause pause)
    {
        _pause = pause;
        _backups = backups;
        _installer = installer;
        _log = log;
        _dialogs = dialogs;
        _shell = shell;
        Spotify = spotify;
        Settings = settings;

        Spotify.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(SpotifyStatusViewModel.Installation))
                UpdateBlockers();
        };
    }

    private void UpdateBlockers()
    {
        foreach (var item in Backups)
            item.RestoreBlocker = BackupService.RestoreBlocker(item.Info, Spotify.Installation with { IsRunning = false });
    }

    public event EventHandler? ClientChanged;

    public SpotifyStatusViewModel Spotify { get; }
    public SettingsViewModel Settings { get; }

    public ObservableCollection<BackupItemViewModel> Backups { get; } = [];

    public IReadOnlyList<int> RetentionOptions { get; } = [3, 5, 10, 20];

    public string Location => _backups.BackupsDirectory;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Summary))]
    public partial long TotalSize { get; private set; }

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(CreateCommand), nameof(RestoreCommand), nameof(DeleteCommand))]
    public partial bool IsBusy { get; private set; }

    [ObservableProperty]
    public partial string? Message { get; private set; }

    [ObservableProperty]
    public partial StatusKind MessageStatus { get; private set; }

    public bool IsEmpty => Backups.Count == 0;

    public string Summary => Backups.Count == 0
        ? "No backups yet"
        : $"{Backups.Count} backup{(Backups.Count == 1 ? "" : "s")}, {FormatSize(TotalSize)}";

    public string Breakdown
    {
        get
        {
            var originals = Backups.Count(b => b.IsOriginal);
            return $"{Backups.Count - originals} latest, plus {originals} original{(originals == 1 ? "" : "s")} of Spotify";
        }
    }

    public int Retention
    {
        get => Settings.BackupRetention;
        set
        {
            if (Settings.BackupRetention == value)
                return;
            Settings.BackupRetention = value;
            OnPropertyChanged();
        }
    }

    public async Task RefreshAsync()
    {
        var client = Spotify.Installation;
        var list = await Task.Run(() => _backups.List());
        Backups.Clear();
        foreach (var backup in list)
            Backups.Add(new BackupItemViewModel(backup, BackupService.RestoreBlocker(backup, client with { IsRunning = false })));
        TotalSize = list.Sum(b => b.TotalSize);
        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(Summary));
        OnPropertyChanged(nameof(Breakdown));
    }

    private bool CanChange() => !IsBusy;

    [RelayCommand(CanExecute = nameof(CanChange))]
    private async Task CreateAsync()
    {
        IsBusy = true;
        try
        {
            await Spotify.ReloadAsync();
            var created = await Task.Run(() => _backups.Create(Spotify.Installation, BackupKind.Manual));
            _log.Success("Backup", $"Backup created ({FormatSize(created.TotalSize)})");
            var pruned = await Task.Run(() => _backups.Prune(Retention));
            foreach (var removed in pruned)
                _log.Info("Backup", $"Removed old backup {removed.Manifest.Id} (keeping {Retention})");
            Show(StatusKind.Success, created.Manifest.IsPristine
                ? "Backup of the original Spotify created."
                : "Backup created.");
        }
        catch (Exception ex)
        {
            Show(StatusKind.Error, _log.Error("Backup", ex).Message);
        }
        finally
        {
            IsBusy = false;
            await RefreshAsync();
        }
    }

    [RelayCommand(CanExecute = nameof(CanChange))]
    private async Task RestoreAsync(BackupItemViewModel item)
    {
        await Spotify.ReloadAsync();
        if (BackupService.RestoreBlocker(item.Info, Spotify.Installation with { IsRunning = false }) is { } blocker)
        {
            Show(StatusKind.Warning, blocker);
            await RefreshAsync();
            return;
        }

        var confirmed = await _dialogs.ConfirmAsync(
            item.IsOriginal ? "Restore the original client?" : "Restore this backup?",
            $"Spotify goes back to how it was on {item.CreatedText}. " +
            (item.IsOriginal ? "SpotiKit is removed from Spotify. " : "") +
            "The current state is backed up first." + (Spotify.IsRunning ? " Spotify closes for this and starts again afterwards." : ""),
            "Restore", isDestructive: true);
        if (!confirmed)
            return;

        IsBusy = true;
        var closed = await _pause.CloseAsync("restore a backup");
        if (closed is null)
        {
            Show(StatusKind.Error, SpotifyPause.StillRunning);
            IsBusy = false;
            return;
        }
        var result = await _installer.RestoreAsync(item.Info);
        Show(result.Succeeded ? StatusKind.Success : StatusKind.Error, result.Message);
        _pause.Resume(closed.Value);
        IsBusy = false;
        await Spotify.ReloadAsync();
        await RefreshAsync();
        ClientChanged?.Invoke(this, EventArgs.Empty);
    }

    [RelayCommand(CanExecute = nameof(CanChange))]
    private async Task DeleteAsync(BackupItemViewModel item)
    {
        var lastOriginal = item.IsOriginal &&
                           Backups.Count(b => b.IsOriginal && b.Info.Manifest.SpotifyVersion == item.Info.Manifest.SpotifyVersion) == 1;
        var confirmed = await _dialogs.ConfirmAsync(
            "Delete this backup?",
            lastOriginal
                ? $"This is the only original backup of Spotify {item.Info.Manifest.SpotifyVersion}. You can still uninstall SpotiKit without it."
                : $"The backup from {item.CreatedText} is deleted for good.",
            "Delete", isDestructive: true);
        if (!confirmed)
            return;

        try
        {
            _backups.Delete(item.Info);
            _log.Info("Backup", $"Deleted backup {item.Id}");
            Show(StatusKind.Success, "Backup deleted.");
        }
        catch (Exception ex)
        {
            Show(StatusKind.Error, _log.Error("Backup", ex).Message);
        }

        await RefreshAsync();
    }

    [RelayCommand]
    private void OpenFolder(BackupItemViewModel? item) => _shell.OpenFolder(item?.Directory ?? Location);

    private void Show(StatusKind status, string message)
    {
        MessageStatus = status;
        Message = message;
    }

    public static string FormatSize(long bytes) => bytes switch
    {
        >= 1024L * 1024 * 1024 => $"{bytes / 1024d / 1024 / 1024:0.0} GB",
        >= 1024 * 1024 => $"{bytes / 1024d / 1024:0.0} MB",
        >= 1024 => $"{bytes / 1024d:0} KB",
        _ => $"{bytes} B",
    };
}

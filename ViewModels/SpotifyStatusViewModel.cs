using System;
using System.Threading;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SpotiKit.Models;
using SpotiKit.Services;

namespace SpotiKit.ViewModels;

public partial class SpotifyStatusViewModel(SpotifyService spotifyService) : ViewModelBase
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Status), nameof(Headline), nameof(VersionText), nameof(PathText),
        nameof(RunningText), nameof(DetailText), nameof(EditionText), nameof(IsDesktopEdition), nameof(IsRunning),
        nameof(HasSpotiKit), nameof(SpotiKitVersion))]
    public partial SpotifyInstallation Installation { get; private set; } = SpotifyInstallation.NotFound;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Status), nameof(Headline))]
    public partial bool IsChecking { get; private set; } = true;

    public bool IsDesktopEdition => Installation.Edition == SpotifyEdition.Desktop;
    public bool IsRunning => Installation.IsRunning;

    public bool HasSpotiKit => Installation.HasSpotiKit;

    public string? SpotiKitVersion => Installation.Xpui?.SpotiKitVersion;

    public StatusKind Status => IsChecking
        ? StatusKind.Busy
        : Installation.Edition switch
        {
            SpotifyEdition.Desktop when Installation.XpuiKind == XpuiKind.Missing => StatusKind.Warning,
            SpotifyEdition.Desktop => StatusKind.Success,
            SpotifyEdition.MicrosoftStore => StatusKind.Warning,
            _ => StatusKind.Error,
        };

    public string Headline => IsChecking
        ? "Looking for Spotify…"
        : Installation.Edition switch
        {
            SpotifyEdition.Desktop when Installation.XpuiKind == XpuiKind.Missing => "Spotify files are missing",
            SpotifyEdition.Desktop => "Spotify is ready",
            SpotifyEdition.MicrosoftStore => "Store edition found",
            _ => "Spotify not found",
        };

    public string VersionText => Installation switch
    {
        { Version: { } version } => $"v{version}",
        { Edition: SpotifyEdition.MicrosoftStore } => "Store build",
        { IsInstalled: true } => "Unknown version",
        _ => "No version",
    };

    public string EditionText => Installation.Edition switch
    {
        SpotifyEdition.Desktop => "Desktop",
        SpotifyEdition.MicrosoftStore => "Microsoft Store",
        _ => "Not installed",
    };

    public string PathText => Installation.InstallPath ?? "No installation detected";

    public string RunningText => Installation.IsRunning ? "Running" : "Not running";

    public string DetailText => Installation switch
    {
        { Version: { } version } => $"Version {version}, {RunningText.ToLowerInvariant()}",
        { IsInstalled: true } => RunningText,
        _ => "Install the Spotify desktop app first",
    };

    [RelayCommand]
    public async Task RefreshAsync()
    {
        IsChecking = true;
        var minimumDuration = Task.Delay(650);
        Installation = await spotifyService.DetectAsync();
        await minimumDuration;
        IsChecking = false;
    }

    public async Task ReloadAsync() => Installation = await spotifyService.DetectAsync();

    private bool _isWatching;

    public async Task WatchRunningStateAsync()
    {
        if (_isWatching)
            return;
        _isWatching = true;

        var lastBuildCheck = DateTime.UtcNow;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        while (await timer.WaitForNextTickAsync())
        {
            if (IsChecking || !Installation.IsInstalled)
                continue;

            var running = await Task.Run(spotifyService.IsRunning);
            if (!IsChecking && (running != Installation.IsRunning ||
                OperatingSystem.IsMacOS() && DateTime.UtcNow - lastBuildCheck >= TimeSpan.FromSeconds(10)))
            {
                await ReloadAsync();
                lastBuildCheck = DateTime.UtcNow;
            }
        }
    }
}

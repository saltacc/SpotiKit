using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SpotiKit.Models;
using SpotiKit.Services;

namespace SpotiKit.ViewModels;

public partial class CompatibilityViewModel(
    SpotifyStatusViewModel spotify,
    CompatibilityService compatibilityService,
    BackupService backups,
    SpotifyVersionsViewModel versions) : ViewModelBase
{
    public SpotifyStatusViewModel Spotify { get; } = spotify;

    public ObservableCollection<CompatibilityResult> Checks { get; } = [];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Headline), nameof(OverallStatus), nameof(IsAllClear))]
    public partial bool IsChecking { get; private set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Headline), nameof(Score), nameof(ScoreText), nameof(OverallStatus), nameof(Summary), nameof(IsAllClear))]
    public partial int PassedCount { get; private set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Headline), nameof(Score), nameof(ScoreText), nameof(OverallStatus), nameof(Summary), nameof(IsAllClear))]
    public partial int IssueCount { get; private set; }

    public int TotalCount => Checks.Count;

    public double Score => TotalCount == 0 ? 0 : PassedCount / (double)TotalCount;

    public string ScoreText => $"{PassedCount}/{TotalCount}";

    public StatusKind OverallStatus => IsChecking
        ? StatusKind.Busy
        : Checks.Any(c => c.Status == StatusKind.Error) ? StatusKind.Error
        : IssueCount > 0 ? StatusKind.Warning
        : TotalCount > 0 ? StatusKind.Success
        : StatusKind.Neutral;

    public bool IsAllClear => OverallStatus == StatusKind.Success;

    public string Headline => OverallStatus switch
    {
        StatusKind.Busy => "Checking…",
        StatusKind.Success => "All clear",
        StatusKind.Warning => "Ready, with notes",
        StatusKind.Error => "Needs attention",
        _ => "Not checked yet",
    };

    public string Summary => TotalCount == 0
        ? "Run the checks to see if SpotiKit can be installed."
        : $"{PassedCount} of {TotalCount} passed" + (IssueCount > 0 ? $", {IssueCount} to review" : "");

    [RelayCommand]
    public async Task RunChecksAsync()
    {
        IsChecking = true;
        Checks.Clear();
        NotifyCountChanged();
        PassedCount = 0;
        IssueCount = 0;

        await Spotify.RefreshAsync();
        var client = Spotify.Installation;
        var original = await Task.Run(() => backups.FindPristine(client));
        var results = await compatibilityService.RunAsync(client, versions.List, original);

        foreach (var result in results)
        {
            Checks.Add(result);
            NotifyCountChanged();
            if (result.Status == StatusKind.Success)
                PassedCount++;
            else if (result.Status is StatusKind.Warning or StatusKind.Error)
                IssueCount++;
            await Task.Delay(70);
        }

        IsChecking = false;
    }

    public async Task UpdateQuietlyAsync()
    {
        if (IsChecking || Checks.Count == 0)
            return;

        var client = Spotify.Installation;
        var original = await Task.Run(() => backups.FindPristine(client));
        var results = await compatibilityService.RunAsync(client, versions.List, original);
        if (IsChecking)
            return;

        if (results.Count != Checks.Count)
        {
            Checks.Clear();
            foreach (var result in results)
                Checks.Add(result);
            NotifyCountChanged();
        }
        else
        {
            for (var i = 0; i < results.Count; i++)
                if (Checks[i] != results[i])
                    Checks[i] = results[i];
        }

        PassedCount = Checks.Count(c => c.Status == StatusKind.Success);
        IssueCount = Checks.Count(c => c.Status is StatusKind.Warning or StatusKind.Error);
        OnPropertyChanged(nameof(OverallStatus));
        OnPropertyChanged(nameof(IsAllClear));
    }

    private void NotifyCountChanged()
    {
        OnPropertyChanged(nameof(TotalCount));
        OnPropertyChanged(nameof(Score));
        OnPropertyChanged(nameof(ScoreText));
        OnPropertyChanged(nameof(Summary));
    }
}

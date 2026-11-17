using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SpotiKit.Models;
using SpotiKit.Services;

namespace SpotiKit.ViewModels;

public sealed record SpotifyVersionRow(string Version, string Detail, StatusKind Status, bool IsCurrent);

public partial class SpotifyVersionsViewModel : ViewModelBase
{
    private readonly SpotifyVersionListService _service;
    private readonly ActivityLog _log;

    public SpotifyVersionsViewModel(SpotifyVersionListService service, SpotifyStatusViewModel spotify, ActivityLog log)
    {
        _service = service;
        _log = log;
        Spotify = spotify;
        List = service.LoadLocal();
        Spotify.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(SpotifyStatusViewModel.Installation))
                OnPropertyChanged(nameof(Rows));
        };
    }

    public SpotifyStatusViewModel Spotify { get; }

    public event EventHandler? Changed;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Rows), nameof(SourceText), nameof(HasProblem), nameof(Problem))]
    public partial SpotifyVersionList List { get; private set; }

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(RefreshCommand))]
    public partial bool IsRefreshing { get; private set; }

    public bool IsApproved(string? version) => List.IsApproved(version);

    public SpotifyVersionEntry? Find(string? version) => List.Find(version);

    public IReadOnlyList<SpotifyVersionRow> Rows => List.Versions
        .OrderByDescending(v => v.Date ?? DateOnly.MinValue)
        .Select(v => new SpotifyVersionRow(Short(v.Version), Describe(v), v.Status switch
        {
            SpotifyVersionStatus.Approved when v.NeedsNewerApp(AppInfo.Version) => StatusKind.Warning,
            SpotifyVersionStatus.Approved => StatusKind.Success,
            _ => StatusKind.Error,
        }, string.Equals(v.Version, Spotify.Installation.Version, StringComparison.OrdinalIgnoreCase)))
        .ToList();

    public string SourceText => List.Source switch
    {
        SpotifyVersionListSource.GitHub => $"Updated {List.RetrievedAt!.Value.ToLocalTime():g}",
        SpotifyVersionListSource.Saved => $"Last updated {List.RetrievedAt!.Value.ToLocalTime():g}",
        _ => "Built-in list",
    };

    public bool HasProblem => List.Problem is not null;
    public string? Problem => List.Problem is null ? null : $"Couldn't update the list. Showing the {(List.Source == SpotifyVersionListSource.Saved ? "last saved" : "built-in")} one.";

    private bool CanRefresh() => !IsRefreshing;

    [RelayCommand(CanExecute = nameof(CanRefresh))]
    public async Task RefreshAsync()
    {
        IsRefreshing = true;
        try
        {
            List = await _service.RefreshAsync();
            if (List.Problem is { } problem)
                _log.Warning("Compatibility", $"The list of approved Spotify versions couldn't be updated: {problem}");
            Changed?.Invoke(this, EventArgs.Empty);
        }
        finally
        {
            IsRefreshing = false;
        }
    }

    private static string Short(string version) => string.Join('.', version.Split('.').Take(3));

    private static string Describe(SpotifyVersionEntry v)
    {
        var when = v.Date is { } d ? $" on {d.ToDateTime(TimeOnly.MinValue):d}" : "";
        var head = v.Status switch
        {
            SpotifyVersionStatus.Approved when v.NeedsNewerApp(AppInfo.Version) => $"Needs SpotiKit {v.MinApp} or newer",
            SpotifyVersionStatus.Approved => $"Supported{when}",
            _ => $"Doesn't work with SpotiKit{(v.Date is null ? "" : $" (reported{when})")}",
        };
        return v.Notes is { Length: > 0 } notes ? $"{head}. {notes}" : head;
    }
}

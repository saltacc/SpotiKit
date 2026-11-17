using System;
using System.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace SpotiKit.ViewModels;

public partial class DashboardViewModel : ViewModelBase
{
    private readonly Action<AppPage> _navigate;

    public DashboardViewModel(SpotifyStatusViewModel spotify, InstallViewModel install,
        CompatibilityViewModel compatibility, UpdatesViewModel updates, Action<AppPage> navigate)
    {
        Spotify = spotify;
        Install = install;
        Compatibility = compatibility;
        Updates = updates;
        _navigate = navigate;

        Install.PropertyChanged += OnInstallChanged;
    }

    public SpotifyStatusViewModel Spotify { get; }
    public InstallViewModel Install { get; }
    public CompatibilityViewModel Compatibility { get; }
    public UpdatesViewModel Updates { get; }

    public string SpotiKitStatusText => Install.IsInstalled
        ? $"v{Install.InstalledVersion}"
        : Install.WasRemovedByUpdate ? "Needs reinstall" : "Not installed";

    public string SpotiKitStatusDetail => Install.IsWorking
        ? Install.Detail
        : Install.IsInstalled ? "Loads the next time Spotify starts"
        : Install.WasRemovedByUpdate ? "A Spotify update replaced its files"
        : "Available on the Installation page";

    [RelayCommand]
    private void InstallNow()
    {
        _navigate(AppPage.Install);
        if (Install.InstallCommand.CanExecute(null))
            Install.InstallCommand.Execute(null);
    }

    [RelayCommand]
    private void Open(AppPage page) => _navigate(page);

    private void OnInstallChanged(object? sender, PropertyChangedEventArgs e)
    {
        OnPropertyChanged(nameof(SpotiKitStatusText));
        OnPropertyChanged(nameof(SpotiKitStatusDetail));
    }
}

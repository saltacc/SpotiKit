using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using SpotiKit.Services;

namespace SpotiKit.ViewModels;

public enum AppPage
{
    Home,
    Install,
    Compatibility,
    Backups,
    Updates,
    Developer,
    Settings,
}

public partial class MainViewModel : ViewModelBase
{
    private readonly IReadOnlyList<ViewModelBase> _pages;

    public MainViewModel() : this(SpotiKitPaths.FromEnvironment())
    {
    }

    public MainViewModel(SpotiKitPaths paths)
    {
        Paths = paths;
        paths.MoveLegacyFolders();
        var settingsService = new SettingsService(paths);
        var spotifyService = new SpotifyService(paths);
        var backupService = new BackupService(paths);
        var stateStore = new StateStore(paths);
        var log = new ActivityLog(paths);
        var devTools = new DevToolsService(paths, spotifyService, stateStore, log);
        var addons = new AddonCatalog(paths);
        var installer = new InstallerService(spotifyService, backupService, stateStore, log, devTools, addons: addons);
        var updateService = new SpotifyUpdateService(paths, stateStore, log);

        Dialogs = new DialogService();
        Shell = new ShellService();
        Spotify = new SpotifyStatusViewModel(spotifyService);
        Settings = new SettingsViewModel(settingsService, new ThemeService(), settingsService.Load(), log);
        Versions = new SpotifyVersionsViewModel(new SpotifyVersionListService(paths), Spotify, log);
        Compatibility = new CompatibilityViewModel(Spotify, new CompatibilityService(), backupService, Versions);
        Install = new InstallViewModel(installer, spotifyService, updateService, stateStore, log, Spotify, Settings, Dialogs, Shell,
            new SpicetifyService(paths, log));
        var pause = new SpotifyPause(spotifyService, Spotify, log);
        Backups = new BackupsViewModel(backupService, installer, log, Spotify, Settings, Dialogs, Shell, pause);
        Updates = new UpdatesViewModel(updateService, AppUpdateService.ForThisApp(), log, Spotify, Settings, Versions, Install,
            Dialogs, Shell, Navigate);
        var kit = new KitRunner();
        Developer = new DevViewModel(new AddonTemplates(paths), new AddonsViewModel(addons, Shell, () => Spotify.Installation.Version),
            new DevToolsViewModel(devTools, Spotify, log, pause), Install, spotifyService, Shell, log, Navigate,
            new LivePreviewService(paths, addons, spotifyService, log, kit), addons, new ProjectChecker(kit), kit);
        Dashboard = new DashboardViewModel(Spotify, Install, Compatibility, Updates, Navigate);

        Install.OperationCompleted += async (_, _) => await RefreshAfterChangeAsync();
        Backups.ClientChanged += async (_, _) => await RefreshAfterChangeAsync();
        Versions.Changed += async (_, _) =>
        {
            if (!Install.IsWorking)
                await Compatibility.UpdateQuietlyAsync();
        };

        var wasRunning = Spotify.IsRunning;
        Spotify.PropertyChanged += async (_, e) =>
        {
            if (e.PropertyName != nameof(SpotifyStatusViewModel.Installation) || Spotify.IsRunning == wasRunning)
                return;
            wasRunning = Spotify.IsRunning;
            if (!Install.IsWorking)
                await Compatibility.UpdateQuietlyAsync();
        };

        _pages = [Dashboard, Install, Compatibility, Backups, Updates, Developer, Settings];
        CurrentPage = Dashboard;
    }

    public SpotiKitPaths Paths { get; }
    public IReadOnlyList<ViewModelBase> Pages => _pages;
    public DialogService Dialogs { get; }
    public ShellService Shell { get; }
    public SpotifyStatusViewModel Spotify { get; }
    public DashboardViewModel Dashboard { get; }
    public InstallViewModel Install { get; }
    public CompatibilityViewModel Compatibility { get; }
    public BackupsViewModel Backups { get; }
    public UpdatesViewModel Updates { get; }
    public DevViewModel Developer { get; }
    public SettingsViewModel Settings { get; }
    public SpotifyVersionsViewModel Versions { get; }

    public string AppVersion => AppInfo.Version;

    public bool IsSandboxed => Paths.IsSandboxed;

    public string SandboxText => "Sandbox mode: your real Spotify is not touched";

    public string SandboxPath => Paths.SpotifyDirOverride ?? Paths.DataRoot;

    [ObservableProperty]
    public partial int SelectedPageIndex { get; set; }

    [ObservableProperty]
    public partial ViewModelBase CurrentPage { get; private set; }

    partial void OnSelectedPageIndexChanged(int value)
    {
        if (value >= 0 && value < _pages.Count)
            CurrentPage = _pages[value];
    }

    public void Navigate(AppPage page) => SelectedPageIndex = (int)page;

    public async Task InitializeAsync()
    {
        _ = AppUpdateService.CleanUpAsync(Environment.ProcessPath);
        Settings.ApplyOnStart();
        await Versions.RefreshAsync();
        await Compatibility.RunChecksAsync();
        Updates.Refresh();
        await Backups.RefreshAsync();
        if (Settings.CheckForUpdates)
            await Updates.CheckAsync();
        _ = Spotify.WatchRunningStateAsync();
    }

    private async Task RefreshAfterChangeAsync()
    {
        Developer.DevTools.Refresh();
        Developer.Addons.Refresh();
        await Compatibility.RunChecksAsync();
        Updates.Refresh();
        await Backups.RefreshAsync();
    }
}

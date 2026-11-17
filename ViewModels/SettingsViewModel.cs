using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using Avalonia.Media;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SpotiKit.Models;
using SpotiKit.Services;

namespace SpotiKit.ViewModels;

public partial class SettingsViewModel : ViewModelBase
{
    private readonly SettingsService _settingsService;
    private readonly ThemeService _themeService;
    private readonly ActivityLog _log;
    private readonly bool _isLoaded;

    public SettingsViewModel(SettingsService settingsService, ThemeService themeService, AppSettings settings, ActivityLog log)
    {
        _settingsService = settingsService;
        _themeService = themeService;
        _log = log;
        Settings = settings;

        LaunchSpotifyAfterInstall = settings.LaunchSpotifyAfterInstall;
        CheckForUpdates = settings.CheckForUpdates;
        UpdateMode = settings.UpdateMode;
        RunInBackground = settings.RunInBackground;
        BackupRetention = Math.Clamp(settings.BackupRetention, 1, 50);
        var custom = Color.TryParse(settings.CustomAccent, out var saved) ? saved : Color.Parse("#FF5C8A");
        _custom = new AccentSwatch(AccentOption.CustomName, Hex(custom), isCustom: true);
        Accents = new ObservableCollection<AccentSwatch>(AccentOption.All.Select(a => new AccentSwatch(a.Name, a.Color)).Append(_custom));
        CustomColor = custom;
        CustomHex = Hex(custom);
        SelectedAccent = Accents.FirstOrDefault(a => a.Name == settings.Accent) ?? Accents[0];
        _saveCustom = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
        _saveCustom.Tick += (_, _) =>
        {
            _saveCustom.Stop();
            Update(s => s.CustomAccent = _custom.Color);
        };
        _isLoaded = true;
    }

    public AppSettings Settings { get; }

    private readonly AccentSwatch _custom;
    private readonly DispatcherTimer _saveCustom;
    private bool _syncingHex;

    public ObservableCollection<AccentSwatch> Accents { get; }

    public string AppVersion => AppInfo.Version;

    [ObservableProperty] public partial bool LaunchSpotifyAfterInstall { get; set; }
    [ObservableProperty] public partial bool CheckForUpdates { get; set; }
    [ObservableProperty] public partial SpotifyUpdateMode UpdateMode { get; set; }
    [ObservableProperty] public partial bool RunInBackground { get; set; }
    [ObservableProperty] public partial string? ShortcutMessage { get; private set; }

    public bool CanRunInBackground => BackgroundSetup.ReleaseExe is not null;
    public string SpotifyUpdatesDescription => OperatingSystem.IsWindows()
        ? "Which Spotify updates are let through is set on the Updates page."
        : "Spotify manages its own updates. Check compatibility and reapply SpotiKit after an update.";
    [ObservableProperty] public partial int BackupRetention { get; set; }
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsCustomAccent))]
    public partial AccentSwatch SelectedAccent { get; set; }

    public bool IsCustomAccent => SelectedAccent?.IsCustom == true;

    [ObservableProperty] public partial Color CustomColor { get; set; }
    [ObservableProperty] public partial string CustomHex { get; set; } = "";

    partial void OnLaunchSpotifyAfterInstallChanged(bool value) => Update(s => s.LaunchSpotifyAfterInstall = value);
    partial void OnCheckForUpdatesChanged(bool value) => Update(s => s.CheckForUpdates = value);
    partial void OnUpdateModeChanged(SpotifyUpdateMode value) => Update(s => s.UpdateMode = value);

    partial void OnRunInBackgroundChanged(bool value)
    {
        Update(s => s.RunInBackground = value);
        if (_isLoaded)
            BackgroundSetup.Apply(Settings, _log, restart: false);
    }

    public void ApplyOnStart()
    {
        BackgroundSetup.Apply(Settings, _log, restart: true);
        if (!Settings.DesktopShortcutCreated && BackgroundSetup.ReleaseExe is not null &&
            BackgroundSetup.AddDesktopShortcut(_log) is not null)
            Update(s => s.DesktopShortcutCreated = true);
        else if (OperatingSystem.IsWindows() && File.Exists(WindowsIntegration.DesktopShortcutPath))
            BackgroundSetup.AddDesktopShortcut(_log);
    }

    [RelayCommand]
    private void AddDesktopShortcut()
    {
        var path = BackgroundSetup.AddDesktopShortcut(_log);
        ShortcutMessage = path is null ? "Couldn't add it. The Activity log on the Installation page says why." : "Added to your desktop.";
        if (path is not null)
            Update(s => s.DesktopShortcutCreated = true);
    }
    partial void OnBackupRetentionChanged(int value) => Update(s => s.BackupRetention = value);

    partial void OnSelectedAccentChanged(AccentSwatch value)
    {
        if (value is null)
            return;
        _themeService.ApplyAccent(value.Color);
        Update(s => s.Accent = value.Name);
    }

    partial void OnCustomColorChanged(Color value)
    {
        _custom.Color = Hex(value);
        if (!_syncingHex)
        {
            _syncingHex = true;
            CustomHex = _custom.Color;
            _syncingHex = false;
        }
        if (SelectedAccent == _custom)
            _themeService.ApplyAccent(_custom.Color);
        if (_isLoaded)
        {
            _saveCustom.Stop();
            _saveCustom.Start();
        }
    }

    partial void OnCustomHexChanged(string value)
    {
        if (_syncingHex)
            return;
        var text = value.Trim();
        if (!text.StartsWith('#'))
            text = "#" + text;
        if (text.Length != 7 || !Color.TryParse(text, out var color))
            return;
        _syncingHex = true;
        CustomColor = color;
        _syncingHex = false;
    }

    private static string Hex(Color color) => $"#{color.R:X2}{color.G:X2}{color.B:X2}";

    public void Save() => _settingsService.Save(Settings);

    private void Update(Action<AppSettings> apply)
    {
        if (!_isLoaded)
            return;
        apply(Settings);
        Save();
    }
}

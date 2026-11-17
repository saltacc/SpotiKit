using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SpotiKit.Models;
using SpotiKit.Services;

namespace SpotiKit.ViewModels;

public partial class DevViewModel : ViewModelBase
{
    private readonly AddonTemplates _templates;
    private readonly SpotifyService _spotifyService;
    private readonly ShellService _shell;
    private readonly ActivityLog _log;
    private readonly Action<AppPage> _navigate;
    private readonly LivePreviewService _live;
    private readonly AddonCatalog _catalog;
    private readonly ProjectChecker _checker;
    private readonly KitRunner _kit;
    private bool _switchingLive;

    public DevViewModel(AddonTemplates templates, AddonsViewModel addons, DevToolsViewModel devTools, InstallViewModel install,
        SpotifyService spotifyService, ShellService shell, ActivityLog log, Action<AppPage> navigate, LivePreviewService live,
        AddonCatalog catalog, ProjectChecker checker, KitRunner kit)
    {
        _catalog = catalog;
        _checker = checker;
        _kit = kit;
        _live = live;
        _live.Status += text => Dispatcher.UIThread.Post(() => LiveStatus = text);
        _templates = templates;
        _spotifyService = spotifyService;
        _shell = shell;
        _log = log;
        _navigate = navigate;
        Addons = addons;
        DevTools = devTools;
        Install = install;
        Install.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName is nameof(InstallViewModel.IsIdle) or nameof(InstallViewModel.Blocker))
                ApplyCommand.NotifyCanExecuteChanged();
        };
    }

    [ObservableProperty]
    public partial bool IsLivePreview { get; set; }

    [ObservableProperty]
    public partial string? LiveStatus { get; private set; }

    async partial void OnIsLivePreviewChanged(bool value)
    {
        if (_switchingLive || value == _live.IsRunning)
            return;
        _switchingLive = true;
        try
        {
            if (value)
            {
                await Install.Spotify.ReloadAsync();
                await _live.StartAsync(Install.Spotify.Installation);
            }
            else
                await _live.StopAsync();
        }
        catch (Exception ex) when (ex is InvalidOperationException or TimeoutException or IOException or TaskCanceledException)
        {
            LiveStatus = ex.Message;
            IsLivePreview = _live.IsRunning;
        }
        finally
        {
            _switchingLive = false;
        }
    }

    public AddonsViewModel Addons { get; }
    public DevToolsViewModel DevTools { get; }
    public InstallViewModel Install { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(NewId))]
    public partial string NewName { get; set; } = "";

    public string NewId => AddonTemplates.IdFor(NewName).Length > 0 ? AddonTemplates.FolderFor(NewName) : "…";

    [ObservableProperty]
    public partial bool IsTypeScript { get; set; }

    public ObservableCollection<ProjectCheckView> CheckResults { get; } = [];

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(CheckCommand))]
    public partial bool IsChecking { get; private set; }

    [ObservableProperty]
    public partial string? CheckSummary { get; private set; }

    [ObservableProperty]
    public partial string? Message { get; private set; }

    [ObservableProperty]
    public partial StatusKind MessageStatus { get; private set; }

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(ApplyCommand))]
    public partial bool IsApplying { get; private set; }

    [ObservableProperty]
    public partial string? ApplyMessage { get; private set; }

    [ObservableProperty]
    public partial StatusKind ApplyStatus { get; private set; }

    [RelayCommand]
    private void OpenDocs() => _shell.OpenUrl("https://spotikit.com/docs/development");

    [RelayCommand]
    private void Create(AddonKind kind)
    {
        try
        {
            var typescript = IsTypeScript && kind != AddonKind.Snippet;
            var created = _templates.Create(kind, NewName, Install.Spotify.Installation.Version, typescript);
            var what = kind switch
            {
                AddonKind.Theme => "Theme",
                AddonKind.Extension => "Extension",
                AddonKind.Snippet => "Snippet",
                _ => "Custom app",
            };
            MessageStatus = StatusKind.Success;
            Message = typescript
                ? KitRunner.FindNode() is null
                    ? $"{what} \"{created.Name}\" created in TypeScript. Building it needs Node.js from nodejs.org, then npm install in its folder."
                    : $"{what} \"{created.Name}\" created in TypeScript. Run npm install in its folder once; Live preview and Apply build it."
                : $"{what} \"{created.Name}\" created. Edit it, then apply it.";
            _log.Success("Developer", $"{what} {created.Id} created from the template at {created.Path}");
            NewName = "";
            Addons.Refresh();
            _shell.OpenFolder(created.Path);
        }
        catch (Exception ex) when (ex is ArgumentException or IOException or UnauthorizedAccessException)
        {
            MessageStatus = StatusKind.Error;
            Message = ex.Message;
        }
    }

    private bool CanCheck() => !IsChecking;

    [RelayCommand(CanExecute = nameof(CanCheck))]
    private async Task CheckAsync()
    {
        IsChecking = true;
        CheckResults.Clear();
        try
        {
            var sources = _catalog.Sources().Where(s => s.IsFolder).ToList();
            if (sources.Count == 0)
            {
                CheckSummary = "There are no project folders to check yet.";
                return;
            }
            int errors = 0, warnings = 0;
            var full = 0;
            foreach (var source in sources)
            {
                var report = await _checker.CheckAsync(source);
                errors += report.Errors;
                warnings += report.Warnings;
                if (report.Full)
                    full++;
                CheckResults.Add(new ProjectCheckView(report));
            }
            CheckSummary = (errors == 0 ? "No errors" : $"{errors} error{(errors == 1 ? "" : "s")}") +
                           (warnings > 0 ? $", {warnings} warning{(warnings == 1 ? "" : "s")}" : "") +
                           (full < sources.Count
                               ? ". Code and types are checked for projects with spotikit-kit installed (npm install)."
                               : ".");
            _log.Info("Developer", $"Checked {sources.Count} project(s): {CheckSummary}");
        }
        finally
        {
            IsChecking = false;
        }
    }

    private async Task<bool> BuildProjectsAsync()
    {
        foreach (var source in _catalog.Sources().Where(s => s.IsFolder))
        {
            if (!HasSource(source.FullPath))
                continue;
            try
            {
                await _kit.BuildAsync(source.FullPath);
                _log.Info("Developer", $"Built {source.Folder}");
            }
            catch (Exception ex) when (ex is InvalidOperationException or TimeoutException or IOException or System.ComponentModel.Win32Exception)
            {
                MessageStatus = StatusKind.Error;
                Message = $"{source.Folder} couldn't be built: {ex.Message}";
                return false;
            }
        }
        return true;
    }

    private static bool HasSource(string folder)
    {
        try
        {
            using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(folder, AddonCatalog.ManifestFile)));
            return json.RootElement.ValueKind == JsonValueKind.Object && json.RootElement.TryGetProperty("source", out var s) &&
                   s.ValueKind == JsonValueKind.String;
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            return false;
        }
    }

    private bool CanApply() => !IsApplying && Install.IsIdle && (Install.Blocker is null || Install.CanOfferClose);

    [RelayCommand(CanExecute = nameof(CanApply))]
    private async Task ApplyAsync()
    {
        IsApplying = true;
        ApplyMessage = null;
        try
        {
            if (_live.IsRunning)
            {
                await _live.StopAsync();
                IsLivePreview = false;
            }
            if (!await BuildProjectsAsync())
                return;
            Addons.Refresh();
            if (Install.Spotify.IsRunning)
            {
                _log.Info("Spotify", "Closing Spotify to apply your projects…");
                if (!await _spotifyService.CloseAsync(TimeSpan.FromSeconds(5)))
                {
                    MessageStatus = StatusKind.Error;
                    Message = "Spotify didn't close. Quit it from the tray icon and try again.";
                    return;
                }
                await Install.Spotify.ReloadAsync();
            }

            await Install.InstallPackageAsync(FrameworkPackage.Bundled);
            (ApplyStatus, ApplyMessage) = Install.State switch
            {
                InstallState.Completed => (StatusKind.Success, "Applied. Your projects are in Spotify."),
                InstallState.Cancelled => (StatusKind.Warning, "Applying was cancelled."),
                _ => (StatusKind.Error, "Applying didn't work. The Installation page shows why."),
            };
            if (Install.State == InstallState.Failed)
                _navigate(AppPage.Install);
        }
        finally
        {
            IsApplying = false;
        }
    }
}

public sealed class ProjectCheckView(ProjectReport report)
{
    public string Title { get; } = $"{report.Name}  ·  {report.Kind}";
    public StatusKind Status { get; } = report.Errors > 0 ? StatusKind.Error : report.Warnings > 0 ? StatusKind.Warning : StatusKind.Success;
    public string Summary { get; } = report.Errors == 0 && report.Warnings == 0
        ? "Everything looks right."
        : (report.Errors > 0 ? $"{report.Errors} error{(report.Errors == 1 ? "" : "s")}" : "No errors") +
          (report.Warnings > 0 ? $", {report.Warnings} warning{(report.Warnings == 1 ? "" : "s")}" : "") +
          (report.Full ? "" : " (manifest and files)");
    public IReadOnlyList<string> Lines { get; } = report.Issues.OrderByDescending(i => i.IsError).Take(8)
        .Select(i => (i.IsError ? "Error  " : "Note  ") + i.Text).ToList();
}

using System;
using System.Collections.Generic;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SpotiKit.Services;

namespace SpotiKit.ViewModels;

public partial class AddonsViewModel : ViewModelBase
{
    private readonly AddonCatalog _catalog;
    private readonly ShellService _shell;
    private readonly Func<string?> _spotifyVersion;

    public AddonsViewModel(AddonCatalog catalog, ShellService shell, Func<string?>? spotifyVersion = null)
    {
        _catalog = catalog;
        _shell = shell;
        _spotifyVersion = spotifyVersion ?? (() => null);
        Refresh();
    }

    [ObservableProperty] public partial IReadOnlyList<string> Items { get; private set; } = [];
    [ObservableProperty] public partial IReadOnlyList<string> Skipped { get; private set; } = [];
    [ObservableProperty] public partial string Summary { get; private set; } = "";

    public bool HasItems => Items.Count > 0;
    public bool HasSkipped => Skipped.Count > 0;

    public string ThemesDir => _catalog.ThemesDir;

    [RelayCommand]
    public void Refresh()
    {
        var set = _catalog.Load(_spotifyVersion());
        Items = set.Themes.Select(t => Row("Theme", t))
            .Concat(set.ExtensionInfo.Select(e => Row("Extension", e)))
            .Concat(set.Apps.Select(a => Row("Custom app", a)))
            .Concat(set.Snippets.Select(s => Row("Snippet", s)))
            .ToList();
        Skipped = set.Skipped.Concat(set.Warnings).ToList();
        Summary = $"{Count(set.Themes.Count, "theme")}, {Count(set.Extensions.Count, "extension")}, {Count(set.Apps.Count, "custom app")}, {Count(set.Snippets.Count, "snippet")}";
        OnPropertyChanged(nameof(HasItems));
        OnPropertyChanged(nameof(HasSkipped));
    }

    [RelayCommand]
    private void OpenThemes() => _shell.OpenFolder(_catalog.ThemesDir);

    [RelayCommand]
    private void OpenExtensions() => _shell.OpenFolder(_catalog.ExtensionsDir);

    [RelayCommand]
    private void OpenApps() => _shell.OpenFolder(_catalog.AppsDir);

    [RelayCommand]
    private void OpenSnippets() => _shell.OpenFolder(_catalog.SnippetsDir);

    private static string Row(string kind, AddonInfo info) =>
        info.Folder is { } folder && !string.Equals(folder, info.Name, StringComparison.OrdinalIgnoreCase) && !string.Equals(folder, info.Name + ".js", StringComparison.OrdinalIgnoreCase)
            ? $"{kind} · {info.Name} (folder {folder})"
            : $"{kind} · {info.Name}";

    private static string Count(int n, string noun) => $"{n} {noun}{(n == 1 ? "" : "s")}";
}

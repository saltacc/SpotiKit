using System;
using System.Threading;
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using SpotiKit.Controls;
using SpotiKit.Services;
using SpotiKit.ViewModels;
using SpotiKit.Views;

namespace SpotiKit;

public partial class App : Application
{
    private static Mutex? _windowOpen;

    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    private async void OnAboutSpotiKit(object? sender, EventArgs e)
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop &&
            desktop.MainWindow?.DataContext is MainViewModel viewModel)
            await viewModel.Dialogs.AlertAsync("About SpotiKit",
                $"SpotiKit {AppInfo.Version}\nCustomize Spotify with themes, extensions, apps, and snippets.");
    }

    public override void OnFrameworkInitializationCompleted()
    {
        SmoothScrolling.Enable();
        if (OperatingSystem.IsWindows())
            _windowOpen = new Mutex(false, WindowsIntegration.WindowMutex);

        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            var viewModel = new MainViewModel();
            viewModel.Shell.QuitApp = () => desktop.Shutdown();
            desktop.MainWindow = new MainWindow
            {
                DataContext = viewModel,
            };
            _ = viewModel.InitializeAsync();
        }

        base.OnFrameworkInitializationCompleted();
    }
}

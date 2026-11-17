using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Threading;
using SpotiKit.Controls;
using Avalonia.Input.Platform;
using Avalonia.Interactivity;
using SpotiKit.ViewModels;

namespace SpotiKit.Views;

public partial class MainWindow : Window
{
    // macOS title bar: a toolbar-height bar so the native traffic lights sit vertically centred,
    // with the branding pushed past them. The lights span about x=10..72 depending on the bar style.
    private const double MacTitleBarHeight = 52;
    private const double MacTrafficLightInset = 84;
    private const double ContentInset = 20;

    public MainWindow()
    {
        InitializeComponent();
        ApplyPlatformChrome();
    }

    private void ApplyPlatformChrome()
    {
        if (!OperatingSystem.IsMacOS())
            return;

        // The native traffic lights stay; the Windows-style caption buttons would only duplicate them.
        if (this.FindControl<StackPanel>("CaptionButtons") is { } captions)
            captions.IsVisible = false;

        if (this.FindControl<Grid>("ChromeGrid") is { RowDefinitions.Count: > 0 } chrome)
            chrome.RowDefinitions[0].Height = new GridLength(MacTitleBarHeight);

        // Asks AppKit for a taller title bar so the traffic lights are centred in our bar
        // instead of hugging the top edge of it.
        ExtendClientAreaTitleBarHeightHint = MacTitleBarHeight;

        UpdateMacTitleBarInset();
    }

    // In full screen the traffic lights only appear with the menu bar, so the branding can move back to the edge.
    private void UpdateMacTitleBarInset()
    {
        if (!OperatingSystem.IsMacOS() || this.FindControl<Grid>("TitleBarContent") is not { } content)
            return;

        var left = WindowState == WindowState.FullScreen ? ContentInset : MacTrafficLightInset;
        content.Margin = new Thickness(left, 0, ContentInset, 0);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == WindowStateProperty)
            UpdateMacTitleBarInset();
    }

    protected override void OnDataContextChanged(EventArgs e)
    {
        base.OnDataContextChanged(e);

        if (DataContext is not MainViewModel vm)
            return;

        vm.Shell.CopyText = text => Clipboard is { } clipboard ? clipboard.SetTextAsync(text) : Task.CompletedTask;
    }

    protected override void OnOpened(EventArgs e)
    {
        base.OnOpened(e);
        DispatcherTimer.RunOnce(Prewarm, TimeSpan.FromMilliseconds(400));
    }

    // Warms the pages and the transition up so the first page change doesn't stutter.
    private void Prewarm()
    {
        if (DataContext is not MainViewModel vm || this.FindControl<Panel>("PrewarmHost") is not { } host)
            return;

        var pages = vm.Pages.Where(p => p != vm.CurrentPage).ToList();
        var views = new System.Collections.Generic.List<Control>();

        void Build(int index)
        {
            host.Children.Clear();
            if (!IsVisible)
            {
                host.IsVisible = false;
                return;
            }
            if (index >= pages.Count)
            {
                _ = Transition();
                return;
            }
            if (new ViewLocator().Build(pages[index]) is { } view)
            {
                view.DataContext = pages[index];
                host.Children.Add(view);
                views.Add(view);
            }
            Dispatcher.UIThread.Post(() => Build(index + 1), DispatcherPriority.Background);
        }

        async Task Transition()
        {
            if (views.Count >= 2)
            {
                // Copies: an animation can stay stuck to a page and hide it later.
                var from = (Control)Activator.CreateInstance(views[^1].GetType())!;
                var to = (Control)Activator.CreateInstance(views[^2].GetType())!;
                from.DataContext = views[^1].DataContext;
                to.DataContext = views[^2].DataContext;
                host.Children.Add(from);
                host.Children.Add(to);
                // A finished animation keeps ticking until it's cancelled.
                using var done = new CancellationTokenSource();
                await new FadeScaleTransition().Start(from, to, true, done.Token);
                done.Cancel();
                host.Children.Clear();
            }
            // A see-through panel costs a layer every frame.
            host.IsVisible = false;
        }

        Dispatcher.UIThread.Post(() => Build(0), DispatcherPriority.Background);
    }

    private void OnMinimizeClick(object? sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

    private void OnMaximizeClick(object? sender, RoutedEventArgs e) =>
        WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

    private void OnCloseClick(object? sender, RoutedEventArgs e) => Close();
}

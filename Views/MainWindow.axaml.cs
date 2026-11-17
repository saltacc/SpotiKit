using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Threading;
using SpotiKit.Controls;
using Avalonia.Input.Platform;
using Avalonia.Interactivity;
using SpotiKit.ViewModels;

namespace SpotiKit.Views;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
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

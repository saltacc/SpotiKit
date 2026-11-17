using System;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace SpotiKit.Controls;

public class GlassDialogHost : ContentControl
{
    public static readonly StyledProperty<object?> DialogProperty =
        AvaloniaProperty.Register<GlassDialogHost, object?>(nameof(Dialog));

    private static readonly TimeSpan CloseDuration = TimeSpan.FromMilliseconds(220);

    private DispatcherTimer? _closeTimer;

    static GlassDialogHost()
    {
        IsVisibleProperty.OverrideDefaultValue<GlassDialogHost>(false);
    }

    public object? Dialog
    {
        get => GetValue(DialogProperty);
        set => SetValue(DialogProperty, value);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == DialogProperty)
            Sync();
    }

    private void Sync()
    {
        _closeTimer?.Stop();

        if (Dialog is { } dialog)
        {
            Content = dialog;
            var wasVisible = IsVisible;
            IsVisible = true;

            Dispatcher.UIThread.Post(() =>
            {
                if (Dialog is null)
                    return;
                PseudoClasses.Set(":open", true);
                FocusCancel();
            }, wasVisible ? DispatcherPriority.Normal : DispatcherPriority.Render);
            return;
        }

        PseudoClasses.Set(":open", false);
        _closeTimer = new DispatcherTimer { Interval = CloseDuration };
        _closeTimer.Tick += (_, _) =>
        {
            _closeTimer.Stop();
            if (Dialog is not null)
                return;
            IsVisible = false;
            Content = null;
        };
        _closeTimer.Start();
    }

    private void FocusCancel()
    {
        var buttons = this.GetVisualDescendants().OfType<Button>().ToList();
        var target = buttons.FirstOrDefault(b => b.IsCancel) ?? buttons.FirstOrDefault();
        target?.Focus(NavigationMethod.Unspecified);
    }
}

using System;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Threading;

namespace SpotiKit.Controls;

public sealed class GlassToolTip
{
    public static readonly AttachedProperty<string?> TipProperty =
        AvaloniaProperty.RegisterAttached<GlassToolTip, Control, string?>("Tip");

    private static readonly TimeSpan InitialDelay = TimeSpan.FromMilliseconds(500);
    private static readonly DispatcherTimer DelayTimer = new() { Interval = InitialDelay };
    private static Control? _pending;

    static GlassToolTip()
    {
        TipProperty.Changed.AddClassHandler<Control>(OnTipChanged);
        DelayTimer.Tick += (_, _) =>
        {
            DelayTimer.Stop();
            if (_pending is { } target)
                Show(target);
        };
    }

    private GlassToolTip()
    {
    }

    public static string? GetTip(Control control) => control.GetValue(TipProperty);

    public static void SetTip(Control control, string? value) => control.SetValue(TipProperty, value);

    private static void OnTipChanged(Control control, AvaloniaPropertyChangedEventArgs e)
    {
        var wasSet = e.OldValue is not null;
        var isSet = e.NewValue is not null;
        if (wasSet == isSet)
            return;

        if (e.NewValue is string tip && string.IsNullOrEmpty(AutomationProperties.GetName(control)))
            AutomationProperties.SetName(control, tip);

        if (isSet)
        {
            control.PointerEntered += OnPointerEntered;
            control.PointerExited += OnPointerLeft;
            control.PointerPressed += OnPointerLeft;
            control.DetachedFromVisualTree += OnDetached;
        }
        else
        {
            control.PointerEntered -= OnPointerEntered;
            control.PointerExited -= OnPointerLeft;
            control.PointerPressed -= OnPointerLeft;
            control.DetachedFromVisualTree -= OnDetached;
        }
    }

    private static void OnPointerEntered(object? sender, PointerEventArgs e)
    {
        if (sender is not Control control)
            return;

        _pending = control;
        if (GlassToolTipHost.For(control) is { IsOpen: true })
        {
            Show(control);
            return;
        }

        DelayTimer.Stop();
        DelayTimer.Start();
    }

    private static void OnPointerLeft(object? sender, EventArgs e)
    {
        if (sender is not Control control)
            return;

        DelayTimer.Stop();
        _pending = null;
        GlassToolTipHost.For(control)?.Hide(control);
    }

    private static void OnDetached(object? sender, VisualTreeAttachmentEventArgs e) => OnPointerLeft(sender, e);

    private static void Show(Control target)
    {
        if (GetTip(target) is { Length: > 0 } text && target.IsPointerOver)
            GlassToolTipHost.For(target)?.Show(target, text);
    }
}

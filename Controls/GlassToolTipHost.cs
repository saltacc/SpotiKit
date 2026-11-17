using System;
using System.Runtime.CompilerServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Metadata;
using Avalonia.Controls.Primitives;
using Avalonia.Threading;

namespace SpotiKit.Controls;

[TemplatePart("PART_Popup", typeof(Popup))]
public class GlassToolTipHost : TemplatedControl
{
    public static readonly StyledProperty<string?> TextProperty =
        AvaloniaProperty.Register<GlassToolTipHost, string?>(nameof(Text));

    private static readonly ConditionalWeakTable<TopLevel, GlassToolTipHost> Hosts = new();

    private Popup? _popup;
    private Control? _target;
    private BlurPopupWindow? _window;

    static GlassToolTipHost()
    {
        IsHitTestVisibleProperty.OverrideDefaultValue<GlassToolTipHost>(false);
    }

    public string? Text
    {
        get => GetValue(TextProperty);
        set => SetValue(TextProperty, value);
    }

    public bool IsOpen { get; private set; }

    internal static GlassToolTipHost? For(Visual visual) =>
        TopLevel.GetTopLevel(visual) is { } topLevel && Hosts.TryGetValue(topLevel, out var host) ? host : null;

    internal void Show(Control target, string text)
    {
        if (_popup is null || _window is null)
            return;

        Text = text;
        IsOpen = true;

        if (_popup.IsOpen && ReferenceEquals(_target, target))
        {
            PseudoClasses.Set(":open", true);
            _window.FadeTo(1);
            return;
        }

        _target = target;
        ClosePopup();
        _popup.PlacementTarget = target;
        _popup.IsOpen = true;
    }

    internal void Hide(Control target)
    {
        if (!ReferenceEquals(_target, target) || !IsOpen || _window is null)
            return;

        IsOpen = false;
        _window.FadeTo(0, () =>
        {
            if (!IsOpen)
                ClosePopup();
        });
    }

    protected override void OnApplyTemplate(TemplateAppliedEventArgs e)
    {
        base.OnApplyTemplate(e);

        if (_popup is not null)
            _popup.Opened -= OnPopupOpened;

        _popup = e.NameScope.Find<Popup>("PART_Popup");
        if (_popup is not null)
            _popup.Opened += OnPopupOpened;
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (TopLevel.GetTopLevel(this) is { } topLevel)
        {
            Hosts.AddOrUpdate(topLevel, this);
            _window = new BlurPopupWindow(topLevel, fadeInSeconds: 0.16, fadeOutSeconds: 0.14);
        }
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        if (TopLevel.GetTopLevel(this) is { } topLevel)
            Hosts.Remove(topLevel);
        _window = null;
        base.OnDetachedFromVisualTree(e);
    }

    private void OnPopupOpened(object? sender, EventArgs e)
    {
        if (_popup?.Child is { } child && _window is not null)
        {
            _window.Attach(child);
            _window.FadeTo(1);
        }

        Dispatcher.UIThread.Post(() =>
        {
            if (IsOpen)
                PseudoClasses.Set(":open", true);
        }, DispatcherPriority.Render);
    }

    private void ClosePopup()
    {
        _window?.Detach();
        PseudoClasses.Set(":open", false);
        if (_popup is not null)
            _popup.IsOpen = false;
    }
}

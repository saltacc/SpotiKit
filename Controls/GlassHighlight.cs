using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.VisualTree;

namespace SpotiKit.Controls;

public class GlassHighlight : Control
{
    public static readonly StyledProperty<bool> IsActiveProperty =
        AvaloniaProperty.Register<GlassHighlight, bool>(nameof(IsActive));

    public static readonly StyledProperty<CornerRadius> CornerRadiusProperty =
        AvaloniaProperty.Register<GlassHighlight, CornerRadius>(nameof(CornerRadius));

    private Spring _intensity = new(0.6, 300);
    private Spring _x = new(0.5, 300);
    private Spring _y = new(0.5, 300);

    private InputElement? _source;
    private bool _isAnimating;
    private bool _hasPosition;
    private TimeSpan? _lastFrame;

    static GlassHighlight()
    {
        IsHitTestVisibleProperty.OverrideDefaultValue<GlassHighlight>(false);
        AffectsRender<GlassHighlight>(CornerRadiusProperty);
    }

    public bool IsActive
    {
        get => GetValue(IsActiveProperty);
        set => SetValue(IsActiveProperty, value);
    }

    public CornerRadius CornerRadius
    {
        get => GetValue(CornerRadiusProperty);
        set => SetValue(CornerRadiusProperty, value);
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        _source = TemplatedParent as InputElement ?? this.FindAncestorOfType<InputElement>();
        _source?.AddHandler(PointerMovedEvent, OnPointerMoved, RoutingStrategies.Bubble, handledEventsToo: true);
        _source?.AddHandler(PointerEnteredEvent, OnPointerMoved, RoutingStrategies.Direct, handledEventsToo: true);
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        _source?.RemoveHandler(PointerMovedEvent, OnPointerMoved);
        _source?.RemoveHandler(PointerEnteredEvent, OnPointerMoved);
        _source = null;
        base.OnDetachedFromVisualTree(e);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == IsActiveProperty)
        {
            _intensity.Target = change.GetNewValue<bool>() ? 1 : 0;
            StartAnimating();
        }
    }

    private void OnPointerMoved(object? sender, PointerEventArgs e)
    {
        var position = e.GetPosition(this);
        if (!_hasPosition || _intensity.Value < 0.01)
        {
            _x.SnapTo(position.X);
            _y.SnapTo(position.Y);
            _hasPosition = true;
        }

        _x.Target = position.X;
        _y.Target = position.Y;
        StartAnimating();
    }

    private void StartAnimating()
    {
        if (_isAnimating || TopLevel.GetTopLevel(this) is not { } topLevel)
            return;

        _isAnimating = true;
        _lastFrame = null;
        topLevel.RequestAnimationFrame(OnFrame);
    }

    private void OnFrame(TimeSpan time)
    {
        var dt = _lastFrame is { } last ? Math.Clamp((time - last).TotalSeconds, 0, 0.05) : 1 / 60.0;
        _lastFrame = time;

        _intensity.Step(dt);
        _x.Step(dt);
        _y.Step(dt);
        InvalidateVisual();

        if ((_intensity.IsSettled && _x.IsSettled && _y.IsSettled) || TopLevel.GetTopLevel(this) is not { } topLevel)
        {
            _isAnimating = false;
            return;
        }

        topLevel.RequestAnimationFrame(OnFrame);
    }

    public override void Render(DrawingContext context)
    {
        var intensity = Math.Clamp(_intensity.Value, 0, 1);
        if (intensity < 0.002 || !_hasPosition)
            return;

        var bounds = new Rect(Bounds.Size);
        var radius = Math.Clamp(Math.Min(bounds.Width, bounds.Height) * 0.9, 70, 190);
        var position = new Point(Math.Clamp(_x.Value, 0, bounds.Width), Math.Clamp(_y.Value, 0, bounds.Height));

        var light = new RadialGradientBrush
        {
            Center = new RelativePoint(position, RelativeUnit.Absolute),
            GradientOrigin = new RelativePoint(position, RelativeUnit.Absolute),
            RadiusX = new RelativeScalar(radius, RelativeUnit.Absolute),
            RadiusY = new RelativeScalar(radius, RelativeUnit.Absolute),
            GradientStops =
            {
                new GradientStop(Color.FromArgb((byte)(0x14 * intensity), 255, 255, 255), 0),
                new GradientStop(Color.FromArgb((byte)(0x0E * intensity), 255, 255, 255), 0.45),
                new GradientStop(Color.FromArgb(0, 255, 255, 255), 1),
            },
        };

        using (context.PushClip(new RoundedRect(bounds, CornerRadius)))
        {
            context.FillRectangle(new SolidColorBrush(Colors.White, 0.015 * intensity), bounds);
            context.FillRectangle(light, bounds);
        }
    }
}

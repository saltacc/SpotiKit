using System;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Automation.Peers;
using Avalonia.Automation.Provider;
using Avalonia.Controls;
using Avalonia.Controls.Metadata;
using Avalonia.Controls.Primitives;
using Avalonia.Data;
using Avalonia.Input;
using Avalonia.Media;

namespace SpotiKit.Controls;

[TemplatePart("PART_Track", typeof(Border))]
[TemplatePart("PART_Knob", typeof(Control))]
[TemplatePart("PART_GlassTrack", typeof(Border))]
[TemplatePart("PART_Surface", typeof(Control))]
[TemplatePart("PART_Rim", typeof(Control))]
public class LiquidToggle : TemplatedControl
{
    public static readonly StyledProperty<bool> IsCheckedProperty =
        AvaloniaProperty.Register<LiquidToggle, bool>(nameof(IsChecked), defaultBindingMode: BindingMode.TwoWay);

    private const double KnobInset = 2;
    private const double Travel = 20;
    private const double PressedScale = 1.5;
    private static readonly Color TrackOffColor = Color.FromArgb(0x5C, 0x78, 0x78, 0x80);

    private Spring _value = new(1, 1000);
    private Spring _velocity = new(0.5, 300);
    private Spring _press = new(1, 1000);
    private Spring _scaleX = new(0.6, 250);
    private Spring _scaleY = new(0.7, 250);

    private Border? _track;
    private Control? _knob;
    private Border? _glassTrack;
    private Control? _surface;
    private Control? _rim;

    private bool _isAnimating;
    private bool _releasePending;
    private bool _isUpdatingFromInput;
    private TimeSpan? _lastFrame;

    private bool _isDragging;
    private bool _didDrag;
    private double _dragFraction;
    private Point _lastPointer;

    static LiquidToggle()
    {
        FocusableProperty.OverrideDefaultValue<LiquidToggle>(true);
    }

    public LiquidToggle()
    {
        _scaleX.SnapTo(1);
        _scaleY.SnapTo(1);
        ResourcesChanged += (_, _) => UpdateVisuals();
    }

    public bool IsChecked
    {
        get => GetValue(IsCheckedProperty);
        set => SetValue(IsCheckedProperty, value);
    }

    protected override void OnApplyTemplate(TemplateAppliedEventArgs e)
    {
        base.OnApplyTemplate(e);
        _track = e.NameScope.Find<Border>("PART_Track");
        _knob = e.NameScope.Find<Control>("PART_Knob");
        _glassTrack = e.NameScope.Find<Border>("PART_GlassTrack");
        _surface = e.NameScope.Find<Control>("PART_Surface");
        _rim = e.NameScope.Find<Control>("PART_Rim");

        _value.SnapTo(IsChecked ? 1 : 0);
        SnapKnobToPixels();
        UpdateVisuals();
    }

    // The window can't be looked up anymore once detached.
    private TopLevel? _scalingSource;

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        _scalingSource = TopLevel.GetTopLevel(this);
        if (_scalingSource is not null)
            _scalingSource.ScalingChanged += OnScalingChanged;
        SnapKnobToPixels();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        if (_scalingSource is not null)
            _scalingSource.ScalingChanged -= OnScalingChanged;
        _scalingSource = null;
        base.OnDetachedFromVisualTree(e);
    }

    private void OnScalingChanged(object? sender, EventArgs e)
    {
        SnapKnobToPixels();
        UpdateVisuals();
    }

    private void SnapKnobToPixels()
    {
        if (_knob is null || TopLevel.GetTopLevel(this) is not { } topLevel)
            return;

        var scaling = topLevel.RenderScaling;
        var trackPixels = Math.Round(Height * scaling);
        var gapPixels = Math.Max(1, Math.Round(KnobInset * scaling));
        _knob.Height = (trackPixels - 2 * gapPixels) / scaling;
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        if (change.Property == IsCheckedProperty)
        {
            if (!_isUpdatingFromInput)
                AnimateTo(change.GetNewValue<bool>() ? 1 : 0);
            if (_peer is { } peer)
                peer.RaiseToggled(change.GetOldValue<bool>(), change.GetNewValue<bool>());
        }
    }

    private LiquidToggleAutomationPeer? _peer;

    protected override AutomationPeer OnCreateAutomationPeer() => _peer = new LiquidToggleAutomationPeer(this);

    private sealed class LiquidToggleAutomationPeer(LiquidToggle owner) : ControlAutomationPeer(owner), IToggleProvider
    {
        public ToggleState ToggleState => owner.IsChecked ? ToggleState.On : ToggleState.Off;

        public void Toggle()
        {
            if (owner.IsEnabled)
                owner.SetCurrentValue(IsCheckedProperty, !owner.IsChecked);
        }

        public void RaiseToggled(bool oldValue, bool newValue) =>
            RaisePropertyChangedEvent(TogglePatternIdentifiers.ToggleStateProperty,
                oldValue ? ToggleState.On : ToggleState.Off, newValue ? ToggleState.On : ToggleState.Off);

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.CheckBox;
    }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
            return;

        e.Pointer.Capture(this);
        e.Handled = true;
        _isDragging = true;
        _didDrag = false;
        _dragFraction = _value.Target;
        _lastPointer = e.GetPosition(this);
        Press();
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        if (!_isDragging)
            return;

        var position = e.GetPosition(this);
        var dx = position.X - _lastPointer.X;
        _lastPointer = position;
        if (Math.Abs(dx) < double.Epsilon)
            return;

        _didDrag = true;
        _dragFraction = Math.Clamp(_dragFraction + dx / Travel, 0, 1);
        _value.Target = _dragFraction;
        StartAnimating();
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        if (!_isDragging)
            return;

        EndDrag();
        e.Pointer.Capture(null);
    }

    protected override void OnPointerCaptureLost(PointerCaptureLostEventArgs e)
    {
        base.OnPointerCaptureLost(e);
        if (_isDragging)
            EndDrag();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.Key is Key.Space or Key.Enter)
        {
            SetCurrentValue(IsCheckedProperty, !IsChecked);
            e.Handled = true;
        }
    }

    private void EndDrag()
    {
        _isDragging = false;
        var isChecked = _didDrag ? _value.Target >= 0.5 : !IsChecked;
        _value.Target = isChecked ? 1 : 0;

        _isUpdatingFromInput = true;
        SetCurrentValue(IsCheckedProperty, isChecked);
        _isUpdatingFromInput = false;

        Release();
    }

    private void AnimateTo(double target)
    {
        if (_knob is null)
        {
            _value.SnapTo(target);
            return;
        }

        Press();
        _value.Target = target;
        Release();
    }

    private void Press()
    {
        _releasePending = false;
        _press.Target = 1;
        _scaleX.Target = PressedScale;
        _scaleY.Target = PressedScale;
        StartAnimating();
    }

    private void Release()
    {
        _releasePending = true;
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

        _value.Step(dt);
        _velocity.Target = _value.Velocity;
        _velocity.Step(dt);
        _press.Step(dt);
        _scaleX.Step(dt);
        _scaleY.Step(dt);

        if (_releasePending && !_isDragging && Math.Abs(_value.Value - _value.Target) < 0.025)
        {
            _releasePending = false;
            _press.Target = 0;
            _scaleX.Target = 1;
            _scaleY.Target = 1;
        }

        UpdateVisuals();

        var settled = _value.IsSettled && _velocity.IsSettled && _press.IsSettled &&
                      _scaleX.IsSettled && _scaleY.IsSettled && !_releasePending;
        if (settled || TopLevel.GetTopLevel(this) is not { } topLevel)
        {
            _isAnimating = false;
            return;
        }

        topLevel.RequestAnimationFrame(OnFrame);
    }

    private void UpdateVisuals()
    {
        if (_track is null || _knob is null || _glassTrack is null || _surface is null || _rim is null)
            return;

        var fraction = Math.Clamp(_value.Value, 0, 1);
        var press = Math.Clamp(_press.Value, 0, 1);

        var trackBrush = new SolidColorBrush(Lerp(TrackOffColor, AccentColor(), fraction));
        _track.Background = trackBrush;
        _glassTrack.Background = trackBrush;

        var speed = Math.Abs(_velocity.Value) / 50;
        var scaleX = _scaleX.Value / (1 - Math.Clamp(speed * 0.75, 0, 0.2));
        var scaleY = _scaleY.Value * (1 - Math.Clamp(speed * 0.25, 0, 0.2));

        var knobX = KnobInset + fraction * Travel;
        var knobY = (Bounds.Height - _knob.Bounds.Height) / 2;
        _knob.RenderTransform = new MatrixTransform(
            Matrix.CreateScale(scaleX, scaleY) * Matrix.CreateTranslation(knobX, 0));

        _glassTrack.Margin = new Thickness(-knobX, -knobY, 0, 0);
        var lensScale = 1 - 0.25 * press;
        _glassTrack.RenderTransformOrigin = new RelativePoint(
            knobX + _knob.Bounds.Width / 2, knobY + _knob.Bounds.Height / 2, RelativeUnit.Absolute);
        _glassTrack.RenderTransform = new ScaleTransform(lensScale, lensScale);

        _surface.Opacity = 1 - press;
        _rim.Opacity = press;
    }

    private Color AccentColor() =>
        this.TryFindResource("AccentBrush", ActualThemeVariant, out var resource) && resource is ISolidColorBrush brush
            ? brush.Color
            : Color.FromRgb(0x4C, 0x6F, 0xFF);

    private static Color Lerp(Color from, Color to, double t) => Color.FromArgb(
        (byte)Math.Round(from.A + (to.A - from.A) * t),
        (byte)Math.Round(from.R + (to.R - from.R) * t),
        (byte)Math.Round(from.G + (to.G - from.G) * t),
        (byte)Math.Round(from.B + (to.B - from.B) * t));
}

using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Data;
using Avalonia.Input;
using Avalonia.Media;

namespace SpotiKit.Controls;

public sealed class AccentPicker : Control
{
    public static readonly StyledProperty<Color> ColorProperty =
        AvaloniaProperty.Register<AccentPicker, Color>(nameof(Color), Colors.White, defaultBindingMode: BindingMode.TwoWay);

    private const double FieldHeight = 150;
    private const double HueHeight = 16;
    private const double Gap = 16;
    private const double ThumbRadius = 9;
    private const double Radius = 14;

    private static readonly BoxShadows Rim = BoxShadows.Parse("inset 0 1 0 0 #66FFFFFF, inset 0 -1 0 0 #14FFFFFF, inset 0 0 0 1 #1FFFFFFF");
    private static readonly BoxShadows ThumbShadow = BoxShadows.Parse("0 2 6 0 #66000000");
    private static readonly IBrush Lighten = Gradient(new RelativePoint(0, 0, RelativeUnit.Relative), new RelativePoint(1, 0, RelativeUnit.Relative),
        Colors.White, Color.FromArgb(0, 255, 255, 255));
    private static readonly IBrush Darken = Gradient(new RelativePoint(0, 0, RelativeUnit.Relative), new RelativePoint(0, 1, RelativeUnit.Relative),
        Color.FromArgb(0, 0, 0, 0), Colors.Black);
    private static readonly IBrush Rainbow = new LinearGradientBrush
    {
        StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative),
        EndPoint = new RelativePoint(1, 0, RelativeUnit.Relative),
        GradientStops =
        {
            new GradientStop(Color.Parse("#FF0000"), 0),
            new GradientStop(Color.Parse("#FFFF00"), 1 / 6.0),
            new GradientStop(Color.Parse("#00FF00"), 2 / 6.0),
            new GradientStop(Color.Parse("#00FFFF"), 3 / 6.0),
            new GradientStop(Color.Parse("#0000FF"), 4 / 6.0),
            new GradientStop(Color.Parse("#FF00FF"), 5 / 6.0),
            new GradientStop(Color.Parse("#FF0000"), 1),
        },
    };

    private double _hue;
    private double _saturation;
    private double _value;
    private bool _setting;
    private Area _dragging;

    private enum Area { None, Field, Hue }

    static AccentPicker()
    {
        FocusableProperty.OverrideDefaultValue<AccentPicker>(true);
        AffectsRender<AccentPicker>(ColorProperty);
    }

    public Color Color
    {
        get => GetValue(ColorProperty);
        set => SetValue(ColorProperty, value);
    }

    private Rect Field => new(0, 0, Bounds.Width, FieldHeight);
    private Rect Hue => new(0, FieldHeight + Gap, Bounds.Width, HueHeight);

    protected override Size MeasureOverride(Size availableSize) =>
        new(double.IsInfinity(availableSize.Width) ? 280 : availableSize.Width, FieldHeight + Gap + HueHeight);

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property != ColorProperty || _setting)
            return;
        var hsv = change.GetNewValue<Color>().ToHsv();
        if (hsv.S > 0.001 && hsv.V > 0.001)
            _hue = hsv.H;
        _saturation = hsv.S;
        _value = hsv.V;
    }

    public override void Render(DrawingContext context)
    {
        var field = new RoundedRect(Field, Radius);
        context.DrawRectangle(new SolidColorBrush(HsvColor.ToRgb(_hue, 1, 1)), null, field);
        context.DrawRectangle(Lighten, null, field);
        context.DrawRectangle(Darken, null, field);
        context.DrawRectangle(null, null, field, Rim);

        var hue = new RoundedRect(Hue, HueHeight / 2);
        context.DrawRectangle(Rainbow, null, hue);
        context.DrawRectangle(null, null, hue, Rim);

        DrawThumb(context, new Point(_saturation * Field.Width, (1 - _value) * FieldHeight), Color);
        DrawThumb(context, new Point(_hue / 360 * Hue.Width, Hue.Center.Y), HsvColor.ToRgb(_hue, 1, 1));
    }

    private static void DrawThumb(DrawingContext context, Point center, Color fill)
    {
        var box = new Rect(center.X - ThumbRadius, center.Y - ThumbRadius, ThumbRadius * 2, ThumbRadius * 2);
        context.DrawRectangle(new SolidColorBrush(fill), new Pen(Brushes.White, 2.5), new RoundedRect(box, ThumbRadius), ThumbShadow);
    }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        var point = e.GetPosition(this);
        _dragging = point.Y <= FieldHeight + Gap / 2 ? Area.Field : Area.Hue;
        e.Pointer.Capture(this);
        Focus();
        Pick(point);
        e.Handled = true;
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        if (_dragging != Area.None)
            Pick(e.GetPosition(this));
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        _dragging = Area.None;
        e.Pointer.Capture(null);
    }

    protected override void OnPointerCaptureLost(PointerCaptureLostEventArgs e)
    {
        base.OnPointerCaptureLost(e);
        _dragging = Area.None;
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        const double step = 0.02;
        var shift = e.KeyModifiers.HasFlag(KeyModifiers.Shift);
        switch (e.Key)
        {
            case Key.Left when shift: _hue = (_hue + 356) % 360; break;
            case Key.Right when shift: _hue = (_hue + 4) % 360; break;
            case Key.Left: _saturation = Math.Max(0, _saturation - step); break;
            case Key.Right: _saturation = Math.Min(1, _saturation + step); break;
            case Key.Up: _value = Math.Min(1, _value + step); break;
            case Key.Down: _value = Math.Max(0, _value - step); break;
            default: return;
        }
        Commit();
        e.Handled = true;
    }

    private void Pick(Point point)
    {
        if (Bounds.Width <= 0)
            return;
        var x = Math.Clamp(point.X / Bounds.Width, 0, 1);
        if (_dragging == Area.Field)
        {
            _saturation = x;
            _value = 1 - Math.Clamp(point.Y / FieldHeight, 0, 1);
        }
        else
        {
            _hue = x * 360;
        }
        Commit();
    }

    private void Commit()
    {
        _setting = true;
        SetCurrentValue(ColorProperty, HsvColor.ToRgb(Math.Min(_hue, 359.999), _saturation, _value));
        _setting = false;
        InvalidateVisual();
    }

    private static LinearGradientBrush Gradient(RelativePoint start, RelativePoint end, Color from, Color to) => new()
    {
        StartPoint = start,
        EndPoint = end,
        GradientStops = { new GradientStop(from, 0), new GradientStop(to, 1) },
    };
}

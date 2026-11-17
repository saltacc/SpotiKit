using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;

namespace SpotiKit.Controls;

public class ProgressRing : TemplatedControl
{
    public static readonly StyledProperty<double> ValueProperty =
        AvaloniaProperty.Register<ProgressRing, double>(nameof(Value));

    public static readonly StyledProperty<bool> IsIndeterminateProperty =
        AvaloniaProperty.Register<ProgressRing, bool>(nameof(IsIndeterminate));

    public static readonly StyledProperty<double> ThicknessProperty =
        AvaloniaProperty.Register<ProgressRing, double>(nameof(Thickness), 8);

    public static readonly DirectProperty<ProgressRing, double> SweepAngleProperty =
        AvaloniaProperty.RegisterDirect<ProgressRing, double>(nameof(SweepAngle), o => o.SweepAngle);

    private double _sweepAngle;

    public double Value
    {
        get => GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    public bool IsIndeterminate
    {
        get => GetValue(IsIndeterminateProperty);
        set => SetValue(IsIndeterminateProperty, value);
    }

    public double Thickness
    {
        get => GetValue(ThicknessProperty);
        set => SetValue(ThicknessProperty, value);
    }

    public double SweepAngle
    {
        get => _sweepAngle;
        private set => SetAndRaise(SweepAngleProperty, ref _sweepAngle, value);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        if (change.Property == ValueProperty)
            SweepAngle = Math.Clamp(change.GetNewValue<double>(), 0, 1) * 359.9;
        else if (change.Property == IsIndeterminateProperty)
            PseudoClasses.Set(":indeterminate", change.GetNewValue<bool>());
    }
}

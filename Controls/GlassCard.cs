using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;

namespace SpotiKit.Controls;

public class GlassCard : ContentControl
{
    public static readonly DirectProperty<GlassCard, bool> IsLitProperty =
        AvaloniaProperty.RegisterDirect<GlassCard, bool>(nameof(IsLit), o => o.IsLit);

    private bool _isLit;
    private bool _isHolding;

    public GlassCard()
    {
        AddHandler(PointerPressedEvent, OnAnyPointerPressed, RoutingStrategies.Tunnel, handledEventsToo: true);
        AddHandler(PointerReleasedEvent, OnAnyPointerReleased, RoutingStrategies.Bubble, handledEventsToo: true);
        AddHandler(PointerCaptureLostEvent, OnAnyPointerReleased, RoutingStrategies.Bubble, handledEventsToo: true);
    }

    public bool IsLit
    {
        get => _isLit;
        private set
        {
            if (SetAndRaise(IsLitProperty, ref _isLit, value))
                PseudoClasses.Set(":lit", value);
        }
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == IsPointerOverProperty)
            UpdateLit();
    }

    private void OnAnyPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        _isHolding = true;
        UpdateLit();
    }

    private void OnAnyPointerReleased(object? sender, RoutedEventArgs e)
    {
        if (!_isHolding)
            return;
        _isHolding = false;
        UpdateLit();
    }

    private void UpdateLit() => IsLit = IsPointerOver || _isHolding;
}

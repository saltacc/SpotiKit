using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using SpotiKit.Models;

namespace SpotiKit.Controls;

public class StatusIndicator : TemplatedControl
{
    public static readonly StyledProperty<StatusKind> KindProperty =
        AvaloniaProperty.Register<StatusIndicator, StatusKind>(nameof(Kind));

    public StatusKind Kind
    {
        get => GetValue(KindProperty);
        set => SetValue(KindProperty, value);
    }

    public StatusIndicator()
    {
        UpdatePseudoClasses(Kind);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        if (change.Property == KindProperty)
            UpdatePseudoClasses(change.GetNewValue<StatusKind>());
    }

    private void UpdatePseudoClasses(StatusKind kind)
    {
        PseudoClasses.Set(":busy", kind == StatusKind.Busy);
        PseudoClasses.Set(":success", kind == StatusKind.Success);
        PseudoClasses.Set(":warning", kind == StatusKind.Warning);
        PseudoClasses.Set(":error", kind == StatusKind.Error);
    }
}

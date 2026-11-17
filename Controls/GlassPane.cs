using Avalonia;
using Avalonia.Controls;

namespace SpotiKit.Controls;

public class GlassPane : ContentControl
{
    public static readonly StyledProperty<HeroArt?> ArtProperty =
        AvaloniaProperty.Register<GlassPane, HeroArt?>(nameof(Art));

    public HeroArt? Art
    {
        get => GetValue(ArtProperty);
        set => SetValue(ArtProperty, value);
    }
}

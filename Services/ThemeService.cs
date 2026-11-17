using Avalonia;
using Avalonia.Media;

namespace SpotiKit.Services;

public sealed class ThemeService
{
    public void ApplyAccent(string hex)
    {
        if (Application.Current is not { } app || !Color.TryParse(hex, out var color))
            return;

        app.Resources["AccentBrush"] = new SolidColorBrush(color);
        app.Resources["AccentSoftBrush"] = new SolidColorBrush(color, 0.16);
    }
}

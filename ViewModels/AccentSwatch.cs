using Avalonia.Media;
using CommunityToolkit.Mvvm.ComponentModel;

namespace SpotiKit.ViewModels;

public sealed partial class AccentSwatch(string name, string color, bool isCustom = false) : ObservableObject
{
    public string Name { get; } = name;
    public bool IsCustom { get; } = isCustom;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Brush))]
    public partial string Color { get; set; } = color;

    public IBrush Brush => new SolidColorBrush(Avalonia.Media.Color.Parse(Color));
}

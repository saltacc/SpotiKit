using System;
using System.Globalization;
using Avalonia;
using Avalonia.Data.Converters;
using Avalonia.Media;
using Avalonia.Media.Transformation;
using SpotiKit.Models;

namespace SpotiKit.Controls;

public sealed class StatusBrushConverter : IValueConverter
{
    public static StatusBrushConverter Instance { get; } = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var key = value switch
        {
            StatusKind.Success => "SuccessBrush",
            StatusKind.Warning => "WarningBrush",
            StatusKind.Error => "ErrorBrush",
            StatusKind.Busy => "AccentBrush",
            _ => "NeutralBrush",
        };

        return Application.Current?.TryGetResource(key, Application.Current.ActualThemeVariant, out var brush) == true
            ? brush
            : Brushes.Gray;
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

public sealed class StatusGlyphConverter : IValueConverter
{
    public static StatusGlyphConverter Instance { get; } = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var key = value switch
        {
            StatusKind.Success => "IconCheck",
            StatusKind.Warning => "IconExclaim",
            StatusKind.Error => "IconClose",
            _ => "IconDash",
        };
        return Application.Current?.TryGetResource(key, null, out var geometry) == true ? geometry : null;
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

public sealed class ResourceKeyConverter : IValueConverter
{
    public static ResourceKeyConverter Instance { get; } = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is string key && Application.Current?.TryGetResource(key, null, out var resource) == true
            ? resource
            : null;

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

public sealed class IndexToOffsetConverter : IValueConverter
{
    public double Step { get; set; } = 48;

    // A transform, not a margin: no layout pass per frame.
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        TransformOperations.Parse(FormattableString.Invariant($"translateY({(value is int index && index >= 0 ? index * Step : 0)}px)"));

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}


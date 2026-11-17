using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Media;

namespace SpotiKit.Controls;

public class StrokeIcon : Control
{
    public static readonly StyledProperty<Geometry?> DataProperty =
        AvaloniaProperty.Register<StrokeIcon, Geometry?>(nameof(Data));

    public static readonly StyledProperty<IBrush?> ForegroundProperty =
        TextElement.ForegroundProperty.AddOwner<StrokeIcon>();

    public static readonly StyledProperty<double> StrokeThicknessProperty =
        AvaloniaProperty.Register<StrokeIcon, double>(nameof(StrokeThickness), 1.8);

    public static readonly StyledProperty<double> GridSizeProperty =
        AvaloniaProperty.Register<StrokeIcon, double>(nameof(GridSize), 24);

    public static readonly StyledProperty<bool> IsFilledProperty =
        AvaloniaProperty.Register<StrokeIcon, bool>(nameof(IsFilled));

    static StrokeIcon()
    {
        AffectsRender<StrokeIcon>(DataProperty, ForegroundProperty, StrokeThicknessProperty, GridSizeProperty,
            IsFilledProperty);
        WidthProperty.OverrideDefaultValue<StrokeIcon>(18);
        HeightProperty.OverrideDefaultValue<StrokeIcon>(18);
    }

    public Geometry? Data
    {
        get => GetValue(DataProperty);
        set => SetValue(DataProperty, value);
    }

    public IBrush? Foreground
    {
        get => GetValue(ForegroundProperty);
        set => SetValue(ForegroundProperty, value);
    }

    public double StrokeThickness
    {
        get => GetValue(StrokeThicknessProperty);
        set => SetValue(StrokeThicknessProperty, value);
    }

    public double GridSize
    {
        get => GetValue(GridSizeProperty);
        set => SetValue(GridSizeProperty, value);
    }

    public bool IsFilled
    {
        get => GetValue(IsFilledProperty);
        set => SetValue(IsFilledProperty, value);
    }

    public override void Render(DrawingContext context)
    {
        if (Data is null || Foreground is null || GridSize <= 0)
            return;

        var scale = System.Math.Min(Bounds.Width, Bounds.Height) / GridSize;
        if (scale <= 0)
            return;

        var offset = new Vector((Bounds.Width - GridSize * scale) / 2, (Bounds.Height - GridSize * scale) / 2);

        using (context.PushTransform(Matrix.CreateScale(scale, scale) * Matrix.CreateTranslation(offset)))
        {
            if (IsFilled)
                context.DrawGeometry(Foreground, null, Data);
            else
                context.DrawGeometry(null,
                    new Pen(Foreground, StrokeThickness / scale, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round),
                    Data);
        }
    }
}

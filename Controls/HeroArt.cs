using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.VisualTree;

namespace SpotiKit.Controls;

public class HeroArt : Control
{
    public static readonly StyledProperty<IImage?> SourceProperty =
        AvaloniaProperty.Register<HeroArt, IImage?>(nameof(Source));

    public static readonly StyledProperty<IBrush?> BackgroundProperty =
        Border.BackgroundProperty.AddOwner<HeroArt>();

    public static readonly StyledProperty<double> FocusXProperty =
        AvaloniaProperty.Register<HeroArt, double>(nameof(FocusX), 0.5);

    public static readonly StyledProperty<double> FocusYProperty =
        AvaloniaProperty.Register<HeroArt, double>(nameof(FocusY), 0.5);

    public static readonly StyledProperty<double> ZoomProperty =
        AvaloniaProperty.Register<HeroArt, double>(nameof(Zoom), 1);

    public static readonly StyledProperty<double> ParallaxProperty =
        AvaloniaProperty.Register<HeroArt, double>(nameof(Parallax), 14);

    private Spring _driftX = new(0.9, 60);
    private Spring _driftY = new(0.9, 60);
    private InputElement? _pointerSource;
    private bool _isAnimating;
    private TimeSpan? _lastFrame;

    static HeroArt()
    {
        IsHitTestVisibleProperty.OverrideDefaultValue<HeroArt>(false);
        AffectsRender<HeroArt>(SourceProperty, BackgroundProperty, FocusXProperty, FocusYProperty, ZoomProperty);
    }

    public event EventHandler? ArtChanged;

    public IImage? Source
    {
        get => GetValue(SourceProperty);
        set => SetValue(SourceProperty, value);
    }

    public IBrush? Background
    {
        get => GetValue(BackgroundProperty);
        set => SetValue(BackgroundProperty, value);
    }

    public double FocusX
    {
        get => GetValue(FocusXProperty);
        set => SetValue(FocusXProperty, value);
    }

    public double FocusY
    {
        get => GetValue(FocusYProperty);
        set => SetValue(FocusYProperty, value);
    }

    public double Zoom
    {
        get => GetValue(ZoomProperty);
        set => SetValue(ZoomProperty, value);
    }

    public double Parallax
    {
        get => GetValue(ParallaxProperty);
        set => SetValue(ParallaxProperty, value);
    }

    public void DrawArt(DrawingContext context, bool blurred = false)
    {
        var bounds = new Rect(Bounds.Size);
        if (Background is { } background)
            context.FillRectangle(background, bounds);

        if (Source is not { } source || source.Size.Width <= 0 || bounds.Height <= 0)
            return;

        var image = blurred ? BlurredSource ?? source : source;

        var scale = bounds.Height / source.Size.Height * Zoom;
        var size = new Size(source.Size.Width * scale, source.Size.Height * scale);
        var centre = new Point(FocusX * bounds.Width + _driftX.Value, FocusY * bounds.Height + _driftY.Value);
        var imageRect = new Rect(centre.X - size.Width / 2, centre.Y - size.Height / 2, size.Width, size.Height);

        var fade = new LinearGradientBrush
        {
            StartPoint = new RelativePoint(imageRect.Left, 0, RelativeUnit.Absolute),
            EndPoint = new RelativePoint(imageRect.Right, 0, RelativeUnit.Absolute),
            GradientStops =
            {
                new GradientStop(Colors.Transparent, 0),
                new GradientStop(Colors.Black, 0.2),
                new GradientStop(Colors.Black, 0.8),
                new GradientStop(Colors.Transparent, 1),
            },
        };

        using (context.PushOpacityMask(fade, imageRect))
            context.DrawImage(image, new Rect(image.Size), imageRect);
    }

    private IImage? _blurredSource;

    private IImage? BlurredSource => _blurredSource ??= CreateBlurredCopy(Source);

    private static IImage? CreateBlurredCopy(IImage? source)
    {
        if (source is null || source.Size.Width < 4 || source.Size.Height < 4)
            return null;

        var size = new PixelSize((int)(source.Size.Width / 4), (int)(source.Size.Height / 4));
        var target = new RenderTargetBitmap(size);
        var rect = new Rect(0, 0, size.Width, size.Height);
        using (var context = target.CreateDrawingContext())
        using (context.PushEffect(new BlurEffect { Radius = 7 }, rect))
            context.DrawImage(source, new Rect(source.Size), rect);
        return target;
    }

    public override void Render(DrawingContext context)
    {
        using (context.PushClip(new Rect(Bounds.Size)))
            DrawArt(context);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == SourceProperty)
            _blurredSource = null;

        if (change.Property == BoundsProperty || change.Property == ZoomProperty ||
            change.Property == FocusXProperty || change.Property == FocusYProperty ||
            change.Property == SourceProperty)
            ArtChanged?.Invoke(this, EventArgs.Empty);
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        _pointerSource = this.FindAncestorOfType<GlassCard>();
        _pointerSource?.AddHandler(PointerMovedEvent, OnPointerMoved, RoutingStrategies.Bubble, handledEventsToo: true);
        _pointerSource?.AddHandler(PointerExitedEvent, OnPointerExited, RoutingStrategies.Direct, handledEventsToo: true);
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        _pointerSource?.RemoveHandler(PointerMovedEvent, OnPointerMoved);
        _pointerSource?.RemoveHandler(PointerExitedEvent, OnPointerExited);
        _pointerSource = null;
        base.OnDetachedFromVisualTree(e);
    }

    private void OnPointerMoved(object? sender, PointerEventArgs e)
    {
        if (Bounds.Width <= 0 || Bounds.Height <= 0)
            return;

        var p = e.GetPosition(this);
        _driftX.Target = -(p.X / Bounds.Width - 0.5) * 2 * Parallax;
        _driftY.Target = -(p.Y / Bounds.Height - 0.5) * 2 * Parallax * 0.6;
        StartAnimating();
    }

    private void OnPointerExited(object? sender, PointerEventArgs e)
    {
        _driftX.Target = 0;
        _driftY.Target = 0;
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

        _driftX.Step(dt);
        _driftY.Step(dt);
        InvalidateVisual();
        ArtChanged?.Invoke(this, EventArgs.Empty);

        if ((_driftX.IsSettled && _driftY.IsSettled) || TopLevel.GetTopLevel(this) is not { } topLevel)
        {
            _isAnimating = false;
            return;
        }

        topLevel.RequestAnimationFrame(OnFrame);
    }
}

public class ArtGlass : Control
{
    public static readonly StyledProperty<HeroArt?> ArtProperty =
        AvaloniaProperty.Register<ArtGlass, HeroArt?>(nameof(Art));

    public static readonly StyledProperty<CornerRadius> CornerRadiusProperty =
        AvaloniaProperty.Register<ArtGlass, CornerRadius>(nameof(CornerRadius));

    static ArtGlass()
    {
        IsHitTestVisibleProperty.OverrideDefaultValue<ArtGlass>(false);
        AffectsRender<ArtGlass>(CornerRadiusProperty);
    }

    public HeroArt? Art
    {
        get => GetValue(ArtProperty);
        set => SetValue(ArtProperty, value);
    }

    public CornerRadius CornerRadius
    {
        get => GetValue(CornerRadiusProperty);
        set => SetValue(CornerRadiusProperty, value);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == ArtProperty)
        {
            if (change.GetOldValue<HeroArt?>() is { } oldArt)
                oldArt.ArtChanged -= OnArtChanged;
            if (change.GetNewValue<HeroArt?>() is { } newArt)
                newArt.ArtChanged += OnArtChanged;
            InvalidateVisual();
        }
    }

    private void OnArtChanged(object? sender, EventArgs e) => InvalidateVisual();

    public override void Render(DrawingContext context)
    {
        if (Art is not { } art || art.TransformToVisual(this) is not { } transform)
            return;

        var bounds = new Rect(Bounds.Size);

        using (context.PushClip(new RoundedRect(bounds, CornerRadius)))
        using (context.PushTransform(transform))
            art.DrawArt(context, blurred: true);
    }
}

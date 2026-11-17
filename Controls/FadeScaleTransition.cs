using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Animation;
using Avalonia.Animation.Easings;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Styling;

namespace SpotiKit.Controls;

public class FadeScaleTransition : IPageTransition
{
    public TimeSpan Duration { get; set; } = TimeSpan.FromMilliseconds(320);

    public double Scale { get; set; } = 0.985;

    public async Task Start(Visual? from, Visual? to, bool forward, CancellationToken cancellationToken)
    {
        if (cancellationToken.IsCancellationRequested)
            return;

        var animations = new List<Task>();

        if (from is not null)
        {
            var fadeOut = new Animation
            {
                Duration = TimeSpan.FromMilliseconds(110),
                Easing = new SplineEasing(0.4, 0, 1, 1),
                FillMode = FillMode.Forward,
                Children =
                {
                    Frame(0, 1, 1),
                    Frame(1, 0, 1 + (1 - Scale) / 2),
                },
            };
            animations.Add(fadeOut.RunAsync(from, cancellationToken));
        }

        if (to is not null)
        {
            to.Opacity = 0;
            to.IsVisible = true;
            await NextFrame(to);
            await NextFrame(to);
            if (cancellationToken.IsCancellationRequested)
                return;

            var fadeIn = new Animation
            {
                Duration = Duration,
                Delay = TimeSpan.FromMilliseconds(50),
                Easing = new SplineEasing(0.2, 0, 0, 1),
                FillMode = FillMode.Both,
                Children =
                {
                    Frame(0, 0, Scale),
                    Frame(1, 1, 1),
                },
            };
            animations.Add(fadeIn.RunAsync(to, cancellationToken));
        }

        await Task.WhenAll(animations);

        if (from is not null && !cancellationToken.IsCancellationRequested)
            from.IsVisible = false;
    }

    private static Task NextFrame(Visual visual)
    {
        if (TopLevel.GetTopLevel(visual) is not { } topLevel)
            return Task.CompletedTask;

        var frame = new TaskCompletionSource();
        topLevel.RequestAnimationFrame(_ => frame.TrySetResult());
        return frame.Task;
    }

    private static KeyFrame Frame(double cue, double opacity, double scale) => new()
    {
        Cue = new Cue(cue),
        Setters =
        {
            new Setter(Visual.OpacityProperty, opacity),
            new Setter(ScaleTransform.ScaleXProperty, scale),
            new Setter(ScaleTransform.ScaleYProperty, scale),
        },
    };
}

using System;
using System.Runtime.CompilerServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.VisualTree;

namespace SpotiKit.Controls;

public static class SmoothScrolling
{
    private const double StepPerNotch = 110;

    private const double Sharpness = 16;

    private static readonly ConditionalWeakTable<ScrollViewer, State> States = new();
    private static bool _enabled;

    private sealed class State
    {
        public double Target;
        public double Current;
        public bool IsRunning;
        public TimeSpan? LastFrame;
    }

    public static void Enable()
    {
        if (_enabled)
            return;
        _enabled = true;
        InputElement.PointerWheelChangedEvent.AddClassHandler<ScrollViewer>(OnWheel, RoutingStrategies.Tunnel);
    }

    private static void OnWheel(ScrollViewer viewer, PointerWheelEventArgs e)
    {
        if (e.Handled || e.Delta.Y == 0 || e.KeyModifiers != KeyModifiers.None)
            return;

        if (!ReferenceEquals(PickViewer(e.Source as Visual, viewer, e.Delta.Y), viewer))
            return;

        e.Handled = true;
        var state = States.GetValue(viewer, _ => new State());
        if (!state.IsRunning)
        {
            state.Current = viewer.Offset.Y;
            state.Target = viewer.Offset.Y;
        }

        state.Target = Math.Clamp(state.Target - e.Delta.Y * StepPerNotch, 0, MaxOffset(viewer));
        if (state.IsRunning || TopLevel.GetTopLevel(viewer) is not { } topLevel)
            return;

        state.IsRunning = true;
        state.LastFrame = null;
        topLevel.RequestAnimationFrame(time => OnFrame(viewer, state, time));
    }

    private static void OnFrame(ScrollViewer viewer, State state, TimeSpan time)
    {
        if (!state.IsRunning)
            return;

        if (Math.Abs(viewer.Offset.Y - state.Current) > 1)
        {
            state.IsRunning = false;
            return;
        }

        var dt = state.LastFrame is { } last ? Math.Clamp((time - last).TotalSeconds, 0, 0.05) : 1 / 60d;
        state.LastFrame = time;

        state.Target = Math.Clamp(state.Target, 0, MaxOffset(viewer));
        var remaining = state.Target - state.Current;
        state.Current = Math.Abs(remaining) < 0.5
            ? state.Target
            : state.Current + remaining * (1 - Math.Exp(-Sharpness * dt));
        viewer.Offset = viewer.Offset.WithY(state.Current);

        if (state.Current != state.Target && TopLevel.GetTopLevel(viewer) is { } topLevel)
            topLevel.RequestAnimationFrame(t => OnFrame(viewer, state, t));
        else
            state.IsRunning = false;
    }

    private static ScrollViewer? PickViewer(Visual? source, ScrollViewer outermost, double delta)
    {
        for (var visual = source; visual is not null; visual = visual.GetVisualParent())
        {
            if (visual is ScrollViewer candidate && CanMove(candidate, delta))
                return candidate;
            if (ReferenceEquals(visual, outermost))
                break;
        }

        return null;
    }

    private static bool CanMove(ScrollViewer viewer, double delta)
    {
        if (viewer.VerticalScrollBarVisibility == Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled)
            return false;

        var max = MaxOffset(viewer);
        if (max <= 0)
            return false;

        if (States.TryGetValue(viewer, out var state) && state.IsRunning)
            return true;
        var at = viewer.Offset.Y;
        return delta > 0 ? at > 0.5 : at < max - 0.5;
    }

    private static double MaxOffset(ScrollViewer viewer) => Math.Max(0, viewer.Extent.Height - viewer.Viewport.Height);
}

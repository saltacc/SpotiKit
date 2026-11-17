using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Avalonia.Controls;
using Avalonia.Media;

namespace SpotiKit.Controls;

internal sealed class BlurPopupWindow
{
    private readonly TopLevel _owner;
    private readonly double _fadeInSeconds;
    private readonly double _fadeOutSeconds;
    private readonly Stopwatch _clock = new();

    private IntPtr _hwnd;
    private double _alpha;
    private double _target;
    private bool _isFading;
    private Action? _faded;

    public BlurPopupWindow(TopLevel owner, double fadeInSeconds, double fadeOutSeconds)
    {
        _owner = owner;
        _fadeInSeconds = fadeInSeconds;
        _fadeOutSeconds = fadeOutSeconds;
    }

    public bool CanFade => _hwnd != IntPtr.Zero;

    public void Attach(Control popupChild)
    {
        _hwnd = IntPtr.Zero;
        if (TopLevel.GetTopLevel(popupChild) is not { } popupRoot)
            return;

        popupRoot.TransparencyLevelHint = [WindowTransparencyLevel.AcrylicBlur, WindowTransparencyLevel.Blur];
        popupRoot.Background = Brushes.Transparent;
        _hwnd = Prepare(popupRoot);
        _alpha = 0;
        SetAlpha(0);
    }

    public void Detach()
    {
        _isFading = false;
        _hwnd = IntPtr.Zero;
    }

    public void FadeTo(double target, Action? done = null)
    {
        _target = target;
        _faded = done;
        if (!CanFade)
        {
            done?.Invoke();
            return;
        }

        if (_isFading)
            return;
        _isFading = true;
        _clock.Restart();
        _owner.RequestAnimationFrame(OnFrame);
    }

    private void OnFrame(TimeSpan _)
    {
        if (!_isFading)
            return;

        var elapsed = _clock.Elapsed.TotalSeconds;
        _clock.Restart();
        _alpha = _target > _alpha
            ? Math.Min(_target, _alpha + elapsed / _fadeInSeconds)
            : Math.Max(_target, _alpha - elapsed / _fadeOutSeconds);
        SetAlpha(_alpha);

        if (Math.Abs(_alpha - _target) > 0.001)
        {
            _owner.RequestAnimationFrame(OnFrame);
            return;
        }

        _isFading = false;
        var done = _faded;
        _faded = null;
        done?.Invoke();
    }

    private void SetAlpha(double alpha)
    {
        const uint LwaAlpha = 0x2;
        if (_hwnd != IntPtr.Zero)
            SetLayeredWindowAttributes(_hwnd, 0, (byte)Math.Round(Math.Clamp(alpha, 0, 1) * 255), LwaAlpha);
    }

    private static IntPtr Prepare(TopLevel popupRoot)
    {
        if (!OperatingSystem.IsWindows() || popupRoot.TryGetPlatformHandle() is not { } platformHandle)
            return IntPtr.Zero;

        var hwnd = platformHandle.Handle;

        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            const int DwmwaWindowCornerPreference = 33, DwmwcpRound = 2;
            const int DwmwaBorderColor = 34;
            const uint DwmwaColorNone = 0xFFFFFFFE;

            var corner = DwmwcpRound;
            DwmSetWindowAttribute(hwnd, DwmwaWindowCornerPreference, ref corner, sizeof(int));
            var borderColor = DwmwaColorNone;
            DwmSetWindowAttribute(hwnd, DwmwaBorderColor, ref borderColor, sizeof(uint));
        }

        const int GwlExStyle = -20;
        const long WsExLayered = 0x00080000;
        SetWindowLongPtr(hwnd, GwlExStyle, (IntPtr)(GetWindowLongPtr(hwnd, GwlExStyle).ToInt64() | WsExLayered));
        return hwnd;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref uint value, int size);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);

    [DllImport("user32.dll")]
    private static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint colorKey, byte alpha, uint flags);
}

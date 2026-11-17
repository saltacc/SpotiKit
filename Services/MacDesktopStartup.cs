using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Threading;

namespace SpotiKit.Services;

internal enum MacDisplayAvailability { Unknown, Active, Inactive }

internal static class MacDesktopStartup
{
    // A sleeping or disconnected display is temporary, rather than a corrupt application.
    internal const int DisplayUnavailableExitCode = 75;
    private const string DisplayTimerFailure =
        "Avalonia.Native was not able to start the RenderTimer. Native error code is: -6661";
    private static readonly TimeSpan DisplayGracePeriod = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(250);
    internal const string UnavailableMessage =
        "SpotiKit could not open its window because macOS has no usable active display. " +
        "Wake or connect a display, then open SpotiKit again.";

    [SupportedOSPlatform("macos")]
    public static int Run(Action startDesktop, Action<string> report)
    {
        return Run(startDesktop, () =>
        {
            var clock = Stopwatch.StartNew();
            return WaitForDisplay(ReadDisplayAvailability, DisplayGracePeriod, () => clock.Elapsed,
                delay => Thread.Sleep(delay), report);
        }, report);
    }

    internal static int Run(Action startDesktop, Func<bool> waitForDisplay, Action<string> report)
    {
        if (!waitForDisplay())
        {
            report(UnavailableMessage);
            return DisplayUnavailableExitCode;
        }
        try
        {
            startDesktop();
            return 0;
        }
        catch (InvalidOperationException error) when (IsDisplayTimerFailure(error))
        {
            // A display can sleep between the preflight and Avalonia's native timer registration.
            // Avalonia cannot safely be initialized twice in this process, so exit cleanly.
            report("SpotiKit could not initialize its Mac display timer. Wake or connect a display, then open SpotiKit again. " +
                "If the display is already awake, include this startup log when reporting the problem." + Environment.NewLine + error);
            return DisplayUnavailableExitCode;
        }
    }

    internal static bool WaitForDisplay(Func<MacDisplayAvailability> read, TimeSpan timeout,
        Func<TimeSpan> elapsed, Action<TimeSpan> pause, Action<string> report,
        CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(timeout, TimeSpan.Zero);
        var reported = false;
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            // Failure to query CoreGraphics is not evidence that no display is available.
            // Let Avalonia try, retaining its specific timer failure handling above.
            if (read() != MacDisplayAvailability.Inactive)
                return true;
            var remaining = timeout - elapsed();
            if (remaining <= TimeSpan.Zero)
                return false;
            if (!reported)
            {
                report("SpotiKit is waiting for an active Mac display. Wake or connect a display to open its window.");
                reported = true;
            }
            pause(remaining < PollInterval ? remaining : PollInterval);
        }
    }

    internal static bool IsDisplayTimerFailure(Exception error) =>
        error is InvalidOperationException && error.Message.Equals(DisplayTimerFailure, StringComparison.Ordinal);

    [SupportedOSPlatform("macos")]
    internal static MacDisplayAvailability ReadDisplayAvailability()
    {
        var result = GetActiveDisplays(0, IntPtr.Zero, out var count);
        return result != 0 ? MacDisplayAvailability.Unknown : count > 0 ? MacDisplayAvailability.Active : MacDisplayAvailability.Inactive;
    }

    [DllImport("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", EntryPoint = "CGGetActiveDisplayList")]
    private static extern int GetActiveDisplays(uint maximum, IntPtr displays, out uint displayCount);
}

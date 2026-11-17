using System;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Threading;
using System.Threading.Tasks;

namespace SpotiKit.Services;

internal static class MacProcessControl
{
    private static readonly Lazy<IntPtr> AppKit = new(() => NativeLibrary.Load("/System/Library/Frameworks/AppKit.framework/AppKit"));

    [SupportedOSPlatform("macos")]
    public static bool RequestQuit(int processId)
    {
        _ = AppKit.Value;
        var pool = Send(GetClass("NSAutoreleasePool"), Selector("new"));
        try
        {
            var application = ApplicationForProcess(GetClass("NSRunningApplication"), Selector("runningApplicationWithProcessIdentifier:"), processId);
            // terminate sends the normal AppKit quit request. Its return value only acknowledges dispatch.
            return application != IntPtr.Zero && SendBoolean(application, Selector("terminate"));
        }
        finally
        {
            if (pool != IntPtr.Zero)
                SendVoid(pool, Selector("drain"));
        }
    }

    public static async Task<bool> QuitAsync(TimeSpan timeout, Func<int[]> runningProcessIds,
        Func<int, bool> requestQuit, CancellationToken cancellationToken)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(timeout, TimeSpan.Zero);
        cancellationToken.ThrowIfCancellationRequested();
        var timer = Stopwatch.StartNew();
        foreach (var processId in runningProcessIds().Distinct())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!requestQuit(processId) && runningProcessIds().Contains(processId))
                return false;
        }

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (runningProcessIds().Length == 0)
                return true;
            var remaining = timeout - timer.Elapsed;
            if (remaining <= TimeSpan.Zero)
                return false;
            await Task.Delay(remaining < TimeSpan.FromMilliseconds(100) ? remaining : TimeSpan.FromMilliseconds(100), cancellationToken)
                .ConfigureAwait(false);
        }
    }

    [DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_getClass")]
    private static extern IntPtr GetClass(string name);

    [DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "sel_registerName")]
    private static extern IntPtr Selector(string name);

    [DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_msgSend")]
    private static extern IntPtr Send(IntPtr receiver, IntPtr selector);

    [DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_msgSend")]
    private static extern IntPtr ApplicationForProcess(IntPtr receiver, IntPtr selector, int processId);

    [DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_msgSend")]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SendBoolean(IntPtr receiver, IntPtr selector);

    [DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_msgSend")]
    private static extern void SendVoid(IntPtr receiver, IntPtr selector);
}

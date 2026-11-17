using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Runtime.Versioning;
using System.Text;
using System.Security.Cryptography;
using System.Threading;
using Avalonia.Platform;
using Microsoft.Win32;

namespace SpotiKit.Services;

[SupportedOSPlatform("windows")]
public static class WindowsIntegration
{
    public const string WindowMutex = @"Local\SpotiKit.Window";
    public const string BackgroundMutex = @"Local\SpotiKit.Background";
    public const string StopEvent = @"Local\SpotiKit.Background.Stop";

    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValue = "SpotiKit";

    public static bool IsWindowOpen() => IsHeld(WindowMutex);

    public static bool IsBackgroundRunning() => IsHeld(BackgroundMutex);

    private static bool IsHeld(string name)
    {
        if (!Mutex.TryOpenExisting(name, out var mutex))
            return false;
        mutex.Dispose();
        return true;
    }

    public static bool StartsWithWindows(string exe) =>
        Registry.CurrentUser.OpenSubKey(RunKey)?.GetValue(RunValue) is string value &&
        value.Contains(exe, StringComparison.OrdinalIgnoreCase);

    public static void StartWithWindows(string exe)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        key.SetValue(RunValue, $"\"{exe}\" --background");
    }

    public static void DontStartWithWindows()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
        key?.DeleteValue(RunValue, throwOnMissingValue: false);
    }

    public static void StartBackground(string exe) =>
        Process.Start(new ProcessStartInfo(exe, "--background") { UseShellExecute = false, CreateNoWindow = true });

    public static void StopBackground()
    {
        if (EventWaitHandle.TryOpenExisting(StopEvent, out var stop))
            using (stop)
                stop.Set();
    }

    public static string DesktopShortcutPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "SpotiKit.lnk");

    public static string CreateDesktopShortcut(string exe)
    {
        var icon = IconFile() ?? exe;
        // Rewriting it makes the desktop redraw every icon.
        if (ShortcutPointsTo(DesktopShortcutPath, exe, icon))
            return DesktopShortcutPath;

        var link = (IShellLinkW)new ShellLink();
        link.SetPath(exe);
        link.SetWorkingDirectory(Path.GetDirectoryName(exe)!);
        link.SetIconLocation(icon, 0);
        link.SetDescription("Themes, extensions and custom apps for Spotify");
        ((IPersistFile)link).Save(DesktopShortcutPath, true);
        Marshal.FinalReleaseComObject(link);
        RefreshItem(DesktopShortcutPath);
        return DesktopShortcutPath;
    }

    private static bool ShortcutPointsTo(string shortcut, string exe, string icon)
    {
        if (!File.Exists(shortcut))
            return false;
        var link = (IShellLinkW)new ShellLink();
        try
        {
            ((IPersistFile)link).Load(shortcut, 0);
            var path = new StringBuilder(1024);
            link.GetPath(path, path.Capacity, IntPtr.Zero, 0);
            var iconPath = new StringBuilder(1024);
            link.GetIconLocation(iconPath, iconPath.Capacity, out _);
            return string.Equals(path.ToString(), exe, StringComparison.OrdinalIgnoreCase) &&
                   string.Equals(iconPath.ToString(), icon, StringComparison.OrdinalIgnoreCase);
        }
        catch (COMException)
        {
            return false;
        }
        finally
        {
            Marshal.FinalReleaseComObject(link);
        }
    }

    private static string? IconFile()
    {
        try
        {
            using var source = AssetLoader.Open(new Uri("avares://SpotiKit/Assets/SpotiKit.ico"));
            using var buffer = new MemoryStream();
            source.CopyTo(buffer);
            var bytes = buffer.ToArray();
            var name = "SpotiKit-" + Convert.ToHexString(SHA256.HashData(bytes))[..12].ToLowerInvariant() + ".ico";
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SpotiKit", "icons");
            var path = Path.Combine(dir, name);
            if (!File.Exists(path))
            {
                Directory.CreateDirectory(dir);
                File.WriteAllBytes(path, bytes);
            }
            return path;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            return null;
        }
    }

    public static void RefreshItem(string path)
    {
        var text = Marshal.StringToHGlobalUni(path);
        try
        {
            SHChangeNotify(0x00002000, 0x0005, text, IntPtr.Zero);
        }
        finally
        {
            Marshal.FreeHGlobal(text);
        }
    }

    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);

    [ComImport]
    [Guid("00021401-0000-0000-C000-000000000046")]
    private class ShellLink;

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("000214F9-0000-0000-C000-000000000046")]
    private interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int size, IntPtr data, int flags);
        void GetIDList(out IntPtr list);
        void SetIDList(IntPtr list);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int size);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int size);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int size);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int show);
        void SetShowCmd(int show);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, int reserved);
        void Resolve(IntPtr window, int flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
    }
}

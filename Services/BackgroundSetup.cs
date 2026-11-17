using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using SpotiKit.Models;

namespace SpotiKit.Services;

public static class BackgroundSetup
{
    public static string? ReleaseExe
    {
        get
        {
            var app = AppUpdateService.ForThisApp();
            return OperatingSystem.IsWindows() && app.CannotUpdateReason is null ? app.ExePath : null;
        }
    }

    public static void Apply(AppSettings settings, ActivityLog log, bool restart)
    {
        if (!OperatingSystem.IsWindows() || ReleaseExe is not { } exe)
            return;
        try
        {
            if (!settings.RunInBackground)
            {
                WindowsIntegration.DontStartWithWindows();
                WindowsIntegration.StopBackground();
                return;
            }

            if (!WindowsIntegration.StartsWithWindows(exe))
                WindowsIntegration.StartWithWindows(exe);
            if (restart && WindowsIntegration.IsBackgroundRunning())
                WindowsIntegration.StopBackground();
            if (restart || !WindowsIntegration.IsBackgroundRunning())
                WindowsIntegration.StartBackground(exe);
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or IOException or Win32Exception)
        {
            log.Warning("Background", $"Couldn't set up the background updates: {ex.Message}");
        }
    }

    public static string? AddDesktopShortcut(ActivityLog log)
    {
        if (!OperatingSystem.IsWindows())
            return null;
        try
        {
            var exe = ReleaseExe ?? Environment.ProcessPath;
            return exe is null ? null : WindowsIntegration.CreateDesktopShortcut(exe);
        }
        catch (Exception ex) when (ex is COMException or UnauthorizedAccessException or IOException)
        {
            log.Warning("Desktop", $"Couldn't add the desktop shortcut: {ex.Message}");
            return null;
        }
    }
}

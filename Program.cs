using Avalonia;
using System;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Threading;
using SpotiKit.Services;

namespace SpotiKit;

sealed class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        if (args is ["--devtools", ..])
            return RunDevTools(args.Length > 1 ? args[1] : "status");
        if (args is ["--background", ..] && OperatingSystem.IsWindows())
            return RunBackground(once: args.Contains("--once"));

        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
        return 0;
    }

    public static AppBuilder BuildAvaloniaApp()
        => AppBuilder.Configure<App>()
            .UsePlatformDetect()
#if DEBUG
            .WithDeveloperTools()
#endif
            .WithInterFont()
            .LogToTrace();

    private static int RunDevTools(string command)
    {
        if (OperatingSystem.IsWindows())
            AttachConsole(-1);

        var paths = SpotiKitPaths.FromEnvironment();
        var state = new StateStore(paths);
        var log = new ActivityLog(paths);
        var devTools = new DevToolsService(paths, new SpotifyService(paths), state, log);

        try
        {
            switch (command)
            {
                case "on":
                    Console.WriteLine(devTools.Enable());
                    return 0;
                case "off":
                    Console.WriteLine(devTools.Disable());
                    return 0;
                case "status":
                    var status = devTools.GetStatus();
                    Console.WriteLine($"{status.State}: {status.Message}");
                    Console.WriteLine($"File: {devTools.BnkPath}");
                    return 0;
                default:
                    Console.Error.WriteLine("Usage: SpotiKit --devtools [status|on|off]");
                    return 2;
            }
        }
        catch (Exception ex)
        {
            var (message, hint) = FriendlyError.Describe(ex);
            log.Error("DevTools", ex);
            Console.Error.WriteLine(hint is null ? message : $"{message} {hint}");
            return 1;
        }
    }

    [SupportedOSPlatform("windows")]
    private static int RunBackground(bool once)
    {
        if (once)
            AttachConsole(-1);

        using var single = new Mutex(false, WindowsIntegration.BackgroundMutex);
        try
        {
            if (!single.WaitOne(once ? TimeSpan.Zero : TimeSpan.FromMinutes(2)))
                return 0;
        }
        catch (AbandonedMutexException)
        {
        }

        using var stop = new EventWaitHandle(false, EventResetMode.AutoReset, WindowsIntegration.StopEvent);
        var paths = SpotiKitPaths.FromEnvironment();
        var settings = new SettingsService(paths);
        var state = new StateStore(paths);
        var log = new ActivityLog(paths);
        var spotify = new SpotifyService(paths);
        var app = AppUpdateService.ForThisApp();
        AppUpdateService.CleanUpAsync(app.ExePath).GetAwaiter().GetResult();
        var devTools = new DevToolsService(paths, spotify, state, log);
        var keeper = new UpdateKeeper(settings, state, log, spotify, new SpotifyUpdateService(paths, state, log),
            new SpotifyVersionListService(paths), new SpotifyReleaseService(),
            new InstallerService(spotify, new BackupService(paths), state, log, devTools, addons: new AddonCatalog(paths)),
            app, WindowsIntegration.IsWindowOpen, devTools);

        while (once || settings.Load().RunInBackground)
        {
            var result = KeeperResult.Done;
            try
            {
                result = keeper.RunOnceAsync().GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                log.Error("Background", ex);
            }

            if (result == KeeperResult.RestartForAppUpdate)
            {
                single.ReleaseMutex();
                WindowsIntegration.StartBackground(app.ExePath!);
                return 0;
            }
            if (once || stop.WaitOne(TimeSpan.FromMinutes(1)))
                return 0;
        }
        return 0;
    }

    [DllImport("kernel32.dll")]
    private static extern bool AttachConsole(int processId);
}

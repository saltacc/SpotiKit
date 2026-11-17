using System;
using System.Threading.Tasks;
using SpotiKit.Services;

namespace SpotiKit.ViewModels;

public sealed class SpotifyPause(SpotifyService service, SpotifyStatusViewModel spotify, ActivityLog log)
{
    public const string StillRunning = "Spotify didn't close. Quit it from the tray icon (right-click, Quit) and try again.";

    public async Task<bool?> CloseAsync(string reason)
    {
        await spotify.ReloadAsync();
        if (!spotify.IsRunning)
            return false;

        log.Info("Spotify", $"Closing Spotify to {reason}…");
        await service.CloseAsync(TimeSpan.FromSeconds(5));
        await spotify.ReloadAsync();
        if (!spotify.IsRunning)
            return true;

        log.Warning("Spotify", "Spotify is still running.", "Quit it from the tray icon (right-click, Quit) and try again.");
        return null;
    }

    public void Resume(bool wasRunning)
    {
        if (!wasRunning || service.IsSandboxed || service.IsRunning())
            return;
        service.Launch(spotify.Installation);
        log.Info("Spotify", "Starting Spotify again");
    }
}

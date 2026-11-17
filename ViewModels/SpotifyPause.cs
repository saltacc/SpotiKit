using System;
using System.Threading.Tasks;
using SpotiKit.Services;

namespace SpotiKit.ViewModels;

public sealed class SpotifyPause(SpotifyService service, SpotifyStatusViewModel spotify, ActivityLog log)
{
    public static string StillRunning => $"Spotify didn't close. {SpotifyService.QuitHint}";

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

        log.Warning("Spotify", "Spotify is still running.", SpotifyService.QuitHint);
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

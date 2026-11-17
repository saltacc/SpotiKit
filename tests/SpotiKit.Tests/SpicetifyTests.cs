using System.IO;
using System.Linq;
using SpotiKit.Models;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class SpicetifyTests
{
    private sealed class Setup
    {
        public required Sandbox Box { get; init; }
        public required SpicetifyFolders Folders { get; init; }
        public string UserPath { get; set; } = "";

        public SpicetifyService Service() =>
            new(Box.Paths, new ActivityLog(Box.Paths), Folders, () => UserPath, value => UserPath = value);

        public SpotifyInstallation Spotify() => new SpotifyService(Box.Paths).Detect() with { IsRunning = false };

        public string Apps => Path.Combine(Box.SpotifyDir, "Apps");
    }

    private static Setup Applied(Sandbox box, string? backupVersion = null)
    {
        var folders = new SpicetifyFolders(Path.Combine(box.Root, "Roaming", "spicetify"), Path.Combine(box.Root, "Local", "spicetify"),
            Path.Combine(box.Root, "Home", "spicetify-cli"));
        var setup = new Setup { Box = box, Folders = folders };
        var backup = Path.Combine(folders.Config, "Backup");
        Directory.CreateDirectory(backup);
        File.Copy(box.XpuiPath, Path.Combine(backup, "xpui.spa"));
        File.WriteAllText(Path.Combine(folders.Config, "config-xpui.ini"),
            $"[Setting]\nspotify_path = x\n\n[Backup]\nversion = {backupVersion ?? setup.Spotify().Version + ".g1234abcd"}\nwith = 2.40.0\n");
        Directory.CreateDirectory(Path.Combine(folders.Config, "Themes", "Dribbblish"));
        Directory.CreateDirectory(folders.Binary);
        File.WriteAllText(Path.Combine(folders.Binary, "spicetify.exe"), "");

        File.Delete(box.XpuiPath);
        Directory.CreateDirectory(Path.Combine(setup.Apps, "xpui"));
        File.WriteAllText(Path.Combine(setup.Apps, "xpui", "index.html"), Sandbox.SampleIndex.Replace("</body>", "<script src=\"helper/spicetifyWrapper.js\"></script></body>"));
        setup.UserPath = $@"C:\Tools;{folders.Binary}\;D:\Other";
        return setup;
    }

    [Fact]
    public void Nothing_is_found_without_Spicetify()
    {
        using var box = new Sandbox();
        var folders = new SpicetifyFolders(Path.Combine(box.Root, "a"), Path.Combine(box.Root, "b"), Path.Combine(box.Root, "c"));
        var status = new SpicetifyService(box.Paths, new ActivityLog(box.Paths), folders, () => "", _ => { })
            .Detect(new SpotifyService(box.Paths).Detect());

        Assert.False(status.IsApplied);
        Assert.False(status.HasConfig);
        Assert.Null(status.Binary);
    }

    [Fact]
    public void Removing_restores_Spotify_and_takes_Spicetify_off_the_PC()
    {
        using var box = new Sandbox();
        var setup = Applied(box);
        var service = setup.Service();
        var status = service.Detect(setup.Spotify());
        Assert.True(status.IsApplied);
        Assert.True(status.HasConfig);
        Assert.NotNull(status.Binary);

        var result = service.Remove(setup.Spotify(), keepSettings: false);

        Assert.True(result.Succeeded, result.Message);
        var restored = XpuiPatcher.Inspect(Path.Combine(setup.Apps, "xpui.spa"));
        Assert.True(restored.IsPatchable);
        Assert.False(Directory.Exists(Path.Combine(setup.Apps, "xpui")));
        Assert.False(Directory.Exists(setup.Folders.Config));
        Assert.False(Directory.Exists(setup.Folders.Binary));
        Assert.Equal(@"C:\Tools;D:\Other", setup.UserPath);
        var kept = Directory.GetDirectories(Path.Combine(box.Paths.DataRoot, "Spicetify backup")).Single();
        Assert.True(File.Exists(Path.Combine(kept, "Apps", "xpui", "index.html")));
        Assert.False(service.Detect(setup.Spotify()).IsPresent);
    }

    [Fact]
    public void Settings_can_be_kept()
    {
        using var box = new Sandbox();
        var setup = Applied(box);

        var result = setup.Service().Remove(setup.Spotify(), keepSettings: true);

        Assert.True(result.Succeeded, result.Message);
        Assert.True(Directory.Exists(Path.Combine(setup.Folders.Config, "Themes", "Dribbblish")));
        Assert.False(Directory.Exists(setup.Folders.Binary));
    }

    [Fact]
    public void A_backup_of_another_Spotify_version_changes_nothing()
    {
        using var box = new Sandbox();
        var setup = Applied(box, backupVersion: "1.2.0.1");

        var result = setup.Service().Remove(setup.Spotify(), keepSettings: false);

        Assert.False(result.Succeeded);
        Assert.Contains("1.2.0.1", result.Message);
        Assert.True(Directory.Exists(Path.Combine(setup.Apps, "xpui")));
        Assert.True(Directory.Exists(setup.Folders.Config));
        Assert.True(File.Exists(Path.Combine(setup.Folders.Binary, "spicetify.exe")));
    }

    [Fact]
    public void Nothing_happens_while_Spotify_runs()
    {
        using var box = new Sandbox();
        var setup = Applied(box);

        var result = setup.Service().Remove(setup.Spotify() with { IsRunning = true }, keepSettings: false);

        Assert.False(result.Succeeded);
        Assert.True(Directory.Exists(Path.Combine(setup.Apps, "xpui")));
    }
}

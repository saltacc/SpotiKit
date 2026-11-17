using System;
using System.IO;
using SpotiKit.Models;

namespace SpotiKit.Services;

internal static class MacInstallPreflight
{
    public static bool AppliesTo(SpotifyInstallation client) => OperatingSystem.IsMacOS() &&
        client.InstallPath is { } resources && MacApplicationBundle.FromResources(resources) is { } bundle &&
        MacBundleFiles.IsComplete(bundle);

    public static string? Problem(SpotifyInstallation client)
    {
        if (!AppliesTo(client)) return null;
        try
        {
            RequireWritableParent(MacApplicationBundle.FromResources(client.InstallPath!)!);
            return null;
        }
        catch (IOException error)
        {
            return error.Message;
        }
    }

    public static void RequireWritableParent(string bundle)
    {
        MacBundleFiles.RequireMacOS();
        // A pending journal may need to restore a currently missing target app.
        bundle = MacBundleFiles.RequireBundle(bundle, mustExist: false);
        var parent = Path.GetDirectoryName(bundle)!;
        var probe = Path.Combine(parent, ".spotikit-preflight-" + Guid.NewGuid().ToString("N"));
        var moved = probe + "-moved";
        var journal = probe + ".json";
        var movedJournal = journal + ".moved";
        try
        {
            if (!Directory.Exists(parent))
                throw new DirectoryNotFoundException("The Spotify app's parent folder was not found.");
            // Publication stages whole sibling apps and persists a sibling journal. Checking
            // Resources/Apps would miss parent ACLs and unnecessarily touch the signed bundle.
            Directory.CreateDirectory(probe);
            File.WriteAllBytes(Path.Combine(probe, "write-check"), []);
            Directory.Move(probe, moved);
            Directory.Delete(moved, recursive: true);
            using (var file = new FileStream(journal, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                file.WriteByte(0);
                file.Flush(flushToDisk: true);
            }
            File.Move(journal, movedJournal);
            File.Delete(movedJournal);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        {
            throw new IOException($"SpotiKit needs permission to create, rename, and remove apps in {parent}. " +
                "Move Spotify to your own ~/Applications folder or use an account that can change this folder, then try again. " +
                error.Message, error);
        }
        finally
        {
            TryDeleteFile(journal);
            TryDeleteFile(movedJournal);
            MacBundleFiles.TryDelete(probe);
            MacBundleFiles.TryDelete(moved);
        }
    }

    private static void TryDeleteFile(string path)
    {
        try { File.Delete(path); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException) { }
    }
}

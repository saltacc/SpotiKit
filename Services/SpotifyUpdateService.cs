using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;
using SpotiKit.Models;

namespace SpotiKit.Services;

public sealed class SpotifyUpdateService(SpotiKitPaths paths, StateStore state, ActivityLog log)
{
    private const string Operation = "Spotify updates";
    private const string LegacySignature = "Created by SpotiKit to hold Spotify updates.";

    public string UpdatePath => Path.Combine(paths.SpotifyLocalDataDir, "Update");

    public UpdateWindowRecord? Window => state.Load().UpdateWindow;

    public SpotifyUpdateStatus GetStatus(SpotifyInstallation spotify)
    {
        var hold = state.Load().Hold;
        if (spotify.Edition != SpotifyEdition.Desktop || !OperatingSystem.IsWindows())
            return new SpotifyUpdateStatus(UpdateHoldState.NotSupported, UpdatePath, null, hold, false);

        var updatedDespiteHold = hold is { SpotifyVersion: { } heldVersion } &&
                                 spotify.Version is { } current &&
                                 !string.Equals(heldVersion, current, StringComparison.OrdinalIgnoreCase);

        if (File.Exists(UpdatePath))
        {
            var ours = IsOurLegacyFile();
            return new SpotifyUpdateStatus(ours ? UpdateHoldState.HeldBySpotiKit : UpdateHoldState.HeldByOtherTool,
                UpdatePath, null, ours ? hold : null, ours && updatedDespiteHold);
        }

        if (Directory.Exists(UpdatePath))
        {
            if (IsLocked())
            {
                var ours = hold is not null;
                return new SpotifyUpdateStatus(ours ? UpdateHoldState.HeldBySpotiKit : UpdateHoldState.HeldByOtherTool,
                    UpdatePath, null, ours ? hold : null, ours && updatedDespiteHold);
            }

            if (Directory.EnumerateFileSystemEntries(UpdatePath).Any())
                return new SpotifyUpdateStatus(UpdateHoldState.UpdateStaged, UpdatePath, StagedVersion(), null, false);
        }

        return new SpotifyUpdateStatus(UpdateHoldState.Allowed, UpdatePath, null, null, false);
    }

    public void Hold(SpotifyInstallation spotify, bool automatic, bool discardStagedUpdate)
    {
        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException("Holding Spotify updates is not available on this platform. Spotify manages its own updates.");
        if (spotify.Edition != SpotifyEdition.Desktop)
            throw new InvalidOperationException("Only the Spotify desktop client's updates can be held. The Microsoft Store manages its own updates.");

        var status = GetStatus(spotify);
        if (status.State == UpdateHoldState.HeldByOtherTool)
            throw new InvalidOperationException("Another tool is already holding Spotify updates. SpotiKit leaves its blocker alone.");

        if (File.Exists(UpdatePath))
        {
            File.SetAttributes(UpdatePath, FileAttributes.Normal);
            File.Delete(UpdatePath);
        }

        if (Directory.Exists(UpdatePath) && !IsLocked())
        {
            if (Directory.EnumerateFileSystemEntries(UpdatePath).Any() && !discardStagedUpdate)
                throw new InvalidOperationException("Spotify has already downloaded an update. Holding updates would discard it.");
            Directory.Delete(UpdatePath, recursive: true);
            log.Info(Operation, "Removed the update Spotify had downloaded");
        }

        if (!Directory.Exists(UpdatePath))
        {
            Directory.CreateDirectory(UpdatePath);
            Lock();
        }

        state.Update(s => s with { Hold = new UpdateHoldRecord(DateTimeOffset.Now, spotify.Version, automatic), UpdateWindow = null });
        log.Success(Operation, automatic
            ? $"Updates held automatically while SpotiKit is installed (Spotify {spotify.Version})."
            : $"Updates held at Spotify {spotify.Version}.");
    }

    public void Release(bool includeOtherTools = false, bool quiet = false)
    {
        if (!OperatingSystem.IsWindows())
            return;
        var ours = state.Load().Hold is not null;
        if (File.Exists(UpdatePath))
        {
            if (!IsOurLegacyFile() && !includeOtherTools)
                throw new InvalidOperationException("The update blocker was created by another tool.");
            File.SetAttributes(UpdatePath, FileAttributes.Normal);
            File.Delete(UpdatePath);
        }
        else if (OperatingSystem.IsWindows() && Directory.Exists(UpdatePath) && IsLocked())
        {
            if (!ours && !includeOtherTools)
                throw new InvalidOperationException("The update blocker was created by another tool.");
            Unlock();
            Directory.Delete(UpdatePath, recursive: true);
        }

        state.Update(s => s with { Hold = null, UpdateWindow = null });
        if (!quiet)
            log.Success(Operation, "Spotify updates are allowed again. Spotify installs the latest version on its own.");
    }

    [SupportedOSPlatform("windows")]
    private static SecurityIdentifier CurrentUser() => WindowsIdentity.GetCurrent().User!;

    [SupportedOSPlatform("windows")]
    private void Lock()
    {
        var user = "*" + CurrentUser().Value;
        Icacls(UpdatePath, "/deny", user + ":(D)");
        Icacls(UpdatePath, "/deny", user + ":(R)");
    }

    [SupportedOSPlatform("windows")]
    private void Unlock()
    {
        var acl = new DirectoryInfo(UpdatePath).GetAccessControl();
        foreach (var sid in acl.GetAccessRules(true, false, typeof(SecurityIdentifier)).OfType<FileSystemAccessRule>()
                     .Where(r => r.AccessControlType == AccessControlType.Deny)
                     .Select(r => r.IdentityReference.Value)
                     .Distinct())
            Icacls(UpdatePath, "/remove:d", "*" + sid);
    }

    private static void Icacls(params string[] arguments)
    {
        var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "icacls.exe"))
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in arguments)
            start.ArgumentList.Add(argument);
        using var process = Process.Start(start)!;
        var output = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0)
            throw new IOException($"Windows refused to change the access rights of {arguments[0]}: {output.Trim()}");
    }

    [SupportedOSPlatform("windows")]
    private bool IsLocked()
    {
        try
        {
            var acl = new DirectoryInfo(UpdatePath).GetAccessControl();
            return acl.GetAccessRules(true, false, typeof(SecurityIdentifier)).OfType<FileSystemAccessRule>()
                .Any(r => r.AccessControlType == AccessControlType.Deny &&
                          (r.FileSystemRights & (FileSystemRights.Delete | FileSystemRights.ReadData)) != 0);
        }
        catch (UnauthorizedAccessException)
        {
            return true;
        }
    }

    private bool IsOurLegacyFile()
    {
        try
        {
            using var reader = new StreamReader(UpdatePath);
            return reader.ReadLine()?.StartsWith(LegacySignature, StringComparison.Ordinal) == true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    public string? StagedVersion()
    {
        try
        {
            var installer = Directory.EnumerateFiles(UpdatePath, "*.exe", SearchOption.AllDirectories)
                .OrderByDescending(f => new FileInfo(f).Length)
                .FirstOrDefault();
            return installer is null ? null : SpotifyReleaseService.ReadVersion(installer);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }
}

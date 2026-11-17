using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using SpotiKit.Models;

namespace SpotiKit.Services;

public sealed record InstallStepInfo(string Title, string Description);

public sealed record InstallProgress(int StepIndex, double StepFraction);

public sealed record OperationResult(bool Succeeded, string Message);

public sealed record InstallChange(string Label, string Value, string? Note = null);

public sealed class InstallerService(SpotifyService spotify, BackupService backups, StateStore state, ActivityLog log,
    DevToolsService? devTools = null, ClassMapCatalog? classMaps = null, AddonCatalog? addons = null)
{
    private const string Install = "Install";
    private const string Uninstall = "Uninstall";
    private const string Restore = "Restore";

    private static readonly TimeSpan MinimumStepTime = TimeSpan.FromMilliseconds(650);

    private static readonly TimeSpan HoldAtFull = TimeSpan.FromMilliseconds(380);

    private static readonly TimeSpan ReportInterval = TimeSpan.FromMilliseconds(40);

    private readonly SemaphoreSlim _gate = new(1, 1);

    public static IReadOnlyList<InstallStepInfo> InstallPlan { get; } =
    [
        new("Checking Spotify", "Version, files and free space"),
        new("Backing up", "Saving a copy of Spotify's files"),
        new("Installing", "Adding SpotiKit to Spotify"),
        new("Checking", "Making sure everything is in place"),
    ];

    public static IReadOnlyList<InstallStepInfo> UninstallPlan { get; } =
    [
        new("Checking Spotify", "Making sure Spotify is closed"),
        new("Backing up", "Saving a copy of Spotify's files"),
        new("Removing SpotiKit", "Restoring Spotify's own files"),
        new("Checking", "Comparing with the original files"),
    ];

    public static string? InstallBlocker(SpotifyInstallation s)
    {
        if (s.Edition == SpotifyEdition.MicrosoftStore)
            return "The Microsoft Store version of Spotify can't be changed. Install Spotify from spotify.com.";
        if (s.Edition != SpotifyEdition.Desktop)
            return "Spotify wasn't found.";
        if (s.XpuiKind == XpuiKind.Folder)
            return "Spotify's files are unpacked, probably by another mod like Spicetify. Restore Spotify with it first.";
        if (s.XpuiKind == XpuiKind.Missing || s.XpuiPath is null)
            return "Spotify's files are missing. Reinstall Spotify.";
        if (s.Xpui is not { IsReadable: true } xpui)
            return $"Spotify's files can't be read. {s.Xpui?.Error}";
        if (!xpui.HasIndex || !xpui.HasBodyAnchor)
            return "This Spotify version is built differently than SpotiKit expects.";
        if (xpui.ForeignMods.Count > 0)
            return $"{string.Join(" and ", xpui.ForeignMods)} is installed. Remove it first.";
        if (s.IsRunning)
            return "Spotify is running. Close it first.";
        if (InsufficientSpace(s) is { } space)
            return space;
        return null;
    }

    public IReadOnlyList<InstallChange> Preview(FrameworkPackage package)
    {
        var client = spotify.Detect();
        var changes = new List<InstallChange>();
        var installed = client.Xpui?.SpotiKitVersion;
        var sameFiles = installed == package.Version && client.XpuiPath is not null &&
                        XpuiPatcher.ReadLoader(client.XpuiPath) is { } loader &&
                        FileHash.Sha256(System.Text.Encoding.UTF8.GetBytes(loader)) == package.LoaderSha256;
        changes.Add(new("SpotiKit", installed is null
            ? $"{package.Version} (new)"
            : installed != package.Version ? $"{installed} → {package.Version}"
            : sameFiles ? $"{package.Version} (same files, repaired)" : $"{package.Version} (changed since the last install)"));
        changes.Add(new("Spotify", client.Version ?? "unknown version", "Not updated or changed in any other way"));

        var mappings = (classMaps ?? ClassMapCatalog.Bundled).For(client.Version);
        changes.Add(new("Class names", mappings.Count > 0
            ? $"{mappings.Count} stable names for this Spotify version"
            : "None for this Spotify version", mappings.Count > 0 ? null : "Themes that rely on them may look off"));

        if (addons is not null)
        {
            var set = addons.Load(client.Version);
            var parts = new List<string>();
            if (set.Extensions.Count > 0) parts.Add(Count(set.Extensions.Count, "extension"));
            if (set.Apps.Count > 0) parts.Add(Count(set.Apps.Count, "app"));
            if (set.Themes.Count > 0) parts.Add(Count(set.Themes.Count, "theme"));
            if (set.Snippets.Count > 0) parts.Add(Count(set.Snippets.Count, "snippet"));
            var names = set.ExtensionInfo.Select(e => e.Name).Concat(set.Apps.Select(a => a.Name)).Concat(set.Themes.Select(t => t.Name))
                .Concat(set.Snippets.Select(s => s.Name)).ToList();
            changes.Add(new("Your projects", parts.Count > 0 ? string.Join(", ", parts) : "None",
                names.Count > 0 ? string.Join(", ", names.Take(6)) + (names.Count > 6 ? $" and {names.Count - 6} more" : "") : null));
            if (set.Skipped.Count > 0)
                changes.Add(new("Left out", Count(set.Skipped.Count, "project"), set.Skipped[0]));
        }

        if (client.XpuiPath is not null)
            changes.Add(new("Changed file", Path.GetFileName(client.XpuiPath) + $" ({Megabytes(client.XpuiPath)})",
                "Backed up first. Nothing else in Spotify's folder is touched."));
        return changes;
    }

    private static string Count(int n, string noun) => $"{n} {noun}{(n == 1 ? "" : "s")}";

    public Task<OperationResult> InstallAsync(FrameworkPackage package, int keepBackups, IProgress<InstallProgress> progress,
        CancellationToken cancellationToken) =>
        RunExclusiveAsync(Install, async () =>
        {
            var client = await StepAsync(0, progress, cancellationToken, () =>
            {
                var current = spotify.Detect();
                if (InstallBlocker(current) is { } blocker)
                    throw new InvalidOperationException(blocker);
                log.Info(Install, $"Spotify {current.Version} (desktop) at {current.InstallPath}");
                log.Info(Install, $"Spotify's files: {Megabytes(current.XpuiPath!)}" +
                                  (current.HasSpotiKit ? $", SpotiKit {current.Xpui!.SpotiKitVersion} already present" : ""));
                return current;
            }).ConfigureAwait(false);

            var backup = await StepAsync(1, progress, cancellationToken, () =>
            {
                var created = backups.Create(client, BackupKind.Automatic);
                log.Success(Install, $"Backup {created.Manifest.Id} created ({Megabytes(created.TotalSize)})");
                foreach (var removed in backups.Prune(keepBackups))
                    log.Info(Install, $"Removed old backup {removed.Manifest.Id} (keeping {keepBackups})");
                return created;
            }).ConfigureAwait(false);

            try
            {
                var classMap = await StepAsync(2, progress, CancellationToken.None, () =>
                {
                    var mappings = (classMaps ?? ClassMapCatalog.Bundled).For(client.Version);
                    var addonSet = addons?.Load(client.Version) ?? AddonSet.Empty;
                    var result = XpuiPatcher.Inject(client.XpuiPath!, package.LoaderScript, package.Version, mappings, client.Version, addonSet);
                    log.Info(Install, $"SpotiKit {package.Version} added");
                    LogClassMap(result, mappings.Count);
                    LogAddons(addonSet);
                    return result;
                }).ConfigureAwait(false);

                await StepAsync(3, progress, CancellationToken.None, () =>
                {
                    var check = XpuiPatcher.Inspect(client.XpuiPath!);
                    var loader = XpuiPatcher.ReadLoader(client.XpuiPath!);
                    if (!check.HasSpotiKit || loader is null ||
                        FileHash.Sha256(System.Text.Encoding.UTF8.GetBytes(loader)) != package.LoaderSha256)
                        throw new InvalidDataException("The installed loader does not match the package.");
                    if (classMap.Applied.Count > 0 &&
                        XpuiPatcher.ReadClassMap(client.XpuiPath!)?.Applied.Count != classMap.Applied.Count)
                        throw new InvalidDataException("The class map in the client does not match what was applied.");

                    state.Update(s => s with
                    {
                        Install = new InstallRecord(package.Version, package.Channel, DateTimeOffset.Now,
                            client.Version ?? "unknown", backup.Manifest.Id, package.LoaderSha256),
                    });
                    log.Success(Install, $"SpotiKit {package.Version} is installed. It loads the next time Spotify starts.");
                    return true;
                }).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                RollBack(Install, backup, ex);
                throw;
            }

            return new OperationResult(true, $"SpotiKit {package.Version} installed.");
        });

    public Task<OperationResult> UninstallAsync(int keepBackups, IProgress<InstallProgress> progress,
        CancellationToken cancellationToken) =>
        RunExclusiveAsync(Uninstall, async () =>
        {
            var client = await StepAsync(0, progress, cancellationToken, () =>
            {
                var current = spotify.Detect();
                if (current is not { Edition: SpotifyEdition.Desktop, XpuiKind: XpuiKind.Spa, XpuiPath: not null })
                    throw new InvalidOperationException("The Spotify desktop client with its standard files was not found.");
                if (!current.HasSpotiKit)
                    throw new InvalidOperationException("SpotiKit is not installed in this Spotify client, so there is nothing to remove.");
                if (current.IsRunning)
                    throw new InvalidOperationException("Spotify is running. Close it first.");
                log.Info(Uninstall, $"Spotify {current.Version}: removing SpotiKit {current.Xpui!.SpotiKitVersion}");
                return current;
            }).ConfigureAwait(false);

            var backup = await StepAsync(1, progress, cancellationToken, () =>
            {
                var created = backups.Create(client, BackupKind.Automatic);
                log.Success(Uninstall, $"Backup {created.Manifest.Id} created");
                backups.Prune(keepBackups);
                return created;
            }).ConfigureAwait(false);

            try
            {
                await StepAsync(2, progress, CancellationToken.None, () =>
                {
                    XpuiPatcher.Remove(client.XpuiPath!);
                    log.Info(Uninstall, "SpotiKit removed from Spotify's files");
                    if (devTools is not null && state.Load().DevTools is not null)
                        log.Info(Uninstall, devTools.Disable());
                    return true;
                }).ConfigureAwait(false);

                await StepAsync(3, progress, CancellationToken.None, () =>
                {
                    if (backups.FindPristine(client.Version) is { } original)
                    {
                        var originalSpa = Path.Combine(original.Directory, "files", original.Manifest.Files[0].RelativePath);
                        var differing = XpuiPatcher.DifferingEntries(originalSpa, client.XpuiPath!);
                        if (differing.Count == 0)
                            log.Success(Uninstall, "Spotify's files match the original again");
                        else
                            log.Warning(Uninstall, $"{differing.Count} file(s) differ from the original backup: {string.Join(", ", differing.Take(5))}",
                                $"Restore backup {original.Manifest.Id} from the Backups page to get the exact original client.");
                    }
                    else
                    {
                        log.Info(Uninstall, "No original backup for this Spotify version to compare with; SpotiKit's changes were removed.");
                    }

                    state.Update(s => s with { Install = null });
                    log.Success(Uninstall, "SpotiKit was removed from Spotify.");
                    return true;
                }).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                RollBack(Uninstall, backup, ex);
                throw;
            }

            return new OperationResult(true, "SpotiKit removed.");
        });

    public Task<OperationResult> RestoreAsync(BackupInfo backup) =>
        RunExclusiveAsync(Restore, () => Task.Run(() =>
        {
            var client = spotify.Detect();
            if (BackupService.RestoreBlocker(backup, client) is { } blocker)
                throw new InvalidOperationException(blocker);
            if (!backups.Verify(backup, out var problem))
                throw new InvalidDataException($"The backup can't be used: {problem}");

            log.Info(Restore, $"Restoring backup {backup.Manifest.Id} (Spotify {backup.Manifest.SpotifyVersion})");

            BackupInfo? safety = null;
            if (client.XpuiPath is not null && FileHash.Sha256(client.XpuiPath) != backup.Manifest.Files[0].Sha256)
            {
                safety = backups.Create(client, BackupKind.Automatic);
                log.Info(Restore, $"Current state saved as backup {safety.Manifest.Id} first");
            }

            try
            {
                backups.Restore(backup, client);
            }
            catch (Exception ex)
            {
                if (safety is not null)
                    RollBack(Restore, safety, ex);
                throw;
            }

            var restored = spotify.Detect();
            if (!restored.HasSpotiKit)
                state.Update(s => s with { Install = null });
            log.Success(Restore, backup.Manifest.IsPristine
                ? "The original Spotify client was restored."
                : $"Backup {backup.Manifest.Id} was restored.");
            return new OperationResult(true, "Backup restored.");
        }));

    private async Task<OperationResult> RunExclusiveAsync(string operation, Func<Task<OperationResult>> work)
    {
        if (!await _gate.WaitAsync(0).ConfigureAwait(false))
            return new OperationResult(false, "Another SpotiKit operation is still running.");

        try
        {
            log.Info(operation, "Started");
            return await work().ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            log.Warning(operation, "Cancelled before Spotify was changed. Nothing was modified.");
            return new OperationResult(false, "Cancelled. Spotify was not changed.");
        }
        catch (Exception ex)
        {
            var entry = log.Error(operation, ex);
            return new OperationResult(false, entry.Message);
        }
        finally
        {
            _gate.Release();
        }
    }

    private static async Task<T> StepAsync<T>(int index, IProgress<InstallProgress> progress, CancellationToken cancellationToken,
        Func<T> work)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var clock = Stopwatch.StartNew();
        var task = Task.Run(work);

        while (!task.IsCompleted || clock.Elapsed < MinimumStepTime)
        {
            var t = clock.Elapsed.TotalMilliseconds / MinimumStepTime.TotalMilliseconds;
            var fraction = task.IsCompleted ? Math.Min(1, t) : Math.Min(0.9, t * 0.9);
            progress.Report(new InstallProgress(index, fraction));

            var tick = Task.Delay(ReportInterval, CancellationToken.None);
            if (task.IsCompleted)
                await tick.ConfigureAwait(false);
            else
                await Task.WhenAny(task, tick).ConfigureAwait(false);
        }

        var result = await task.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        progress.Report(new InstallProgress(index, 1));
        await Task.Delay(HoldAtFull, CancellationToken.None).ConfigureAwait(false);
        return result;
    }

    private void RollBack(string operation, BackupInfo backup, Exception cause)
    {
        log.Warning(operation, $"Something went wrong ({FriendlyError.Describe(cause).Message}). Rolling back to backup {backup.Manifest.Id}…");
        try
        {
            backups.Restore(backup, spotify.Detect());
            log.Success(operation, "Rolled back: Spotify is exactly as it was before.");
        }
        catch (Exception rollbackError)
        {
            log.Error(operation, rollbackError);
            log.Warning(operation, "The automatic rollback failed.",
                $"Restore backup {backup.Manifest.Id} from the Backups page, or reinstall Spotify.");
        }
    }

    private static string? InsufficientSpace(SpotifyInstallation s)
    {
        try
        {
            var size = new FileInfo(s.XpuiPath!).Length;
            var root = Path.GetPathRoot(s.XpuiPath);
            if (string.IsNullOrEmpty(root))
                return null;
            var needed = size * 3 + 20L * 1024 * 1024;
            return new DriveInfo(root).AvailableFreeSpace < needed
                ? $"Not enough free disk space: about {needed / 1024 / 1024} MB are needed for the backup and a working copy."
                : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return null;
        }
    }

    private void LogClassMap(ClassMapResult result, int available)
    {
        if (available == 0)
        {
            log.Info(Install, $"No class map for Spotify {result.SpotifyVersion}: its generated class names were left as they are.");
            return;
        }

        var selectors = result.Applied.Sum(a => a.Total);
        var sheets = result.Applied.SelectMany(a => a.Files).Select(f => f.Entry).Distinct().Count();
        log.Info(Install, $"Class map for Spotify {result.SpotifyVersion}: {result.Applied.Count} of {available} classes renamed " +
                          $"({selectors} selectors in {sheets} stylesheets)");
        foreach (var group in result.Skipped.GroupBy(s => s.Reason.Contains("not found", StringComparison.Ordinal) ? "not in this client's styles"
                     : s.Reason.Contains("already exists", StringComparison.Ordinal) ? "name already used by Spotify" : s.Reason))
            log.Warning(Install, $"{group.Count()} class map entries skipped ({group.Key}), for example {group.First().Generated}");
    }

    private void LogAddons(AddonSet set)
    {
        log.Info(Install, $"Packaged {set.Extensions.Count} extension(s), {set.Apps.Count} app(s) and {set.Themes.Count} theme(s) " +
                          $"({Megabytes(set.TotalBytes)})");
        foreach (var reason in set.Skipped)
            log.Warning(Install, $"Project left out: {reason}");
        foreach (var warning in set.Warnings)
            log.Warning(Install, warning);
    }

    private static string Megabytes(string path) => Megabytes(new FileInfo(path).Length);

    private static string Megabytes(long bytes) => $"{bytes / 1024d / 1024:0.0} MB";
}

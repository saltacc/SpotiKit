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

public sealed record InstallProgress(int StepIndex, double StepFraction)
{
    public IReadOnlyList<InstallStepInfo>? Plan { get; init; }
}

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

    private static IReadOnlyList<InstallStepInfo> StandardInstallPlan { get; } =
    [
        new("Checking Spotify", "Version, files and free space"),
        new("Backing up", "Saving a copy of Spotify's files"),
        new("Installing", "Adding SpotiKit to Spotify"),
        new("Checking", "Making sure everything is in place"),
    ];

    private static IReadOnlyList<InstallStepInfo> MacInstallPlan { get; } =
    [
        .. StandardInstallPlan.Take(3),
        new("Signing Spotify", "Signing the app locally and verifying its signature"),
        StandardInstallPlan[3],
    ];

    public static IReadOnlyList<InstallStepInfo> InstallPlan =>
        OperatingSystem.IsMacOS() ? MacInstallPlan : StandardInstallPlan;

    public static IReadOnlyList<InstallStepInfo> InstallPlanFor(SpotifyInstallation client) =>
        IsMacBundle(client) || OperatingSystem.IsMacOS() && !client.IsInstalled ? MacInstallPlan : StandardInstallPlan;

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
        if (OperatingSystem.IsMacOS() && s.InstallPath is { } resources &&
            MacApplicationBundle.FromResources(resources) is { } bundle && MacBundleFiles.IsComplete(bundle) &&
            (s.Version is null || s.Build?.ResourceFingerprint is null || s.Build.Architecture == "unknown"))
            return "This Mac Spotify bundle could not be identified. Restore or reinstall Spotify before changing it.";
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
        changes.Add(new("Spotify", client.Version ?? "unknown version", "The installed Spotify version is kept"));

        var selected = (classMaps ?? ClassMapCatalog.Bundled).Select(client);
        var mappings = selected.Mappings;
        changes.Add(new("Class names", mappings.Count > 0
            ? selected.IsFallback ? $"{mappings.Count} candidate names from Spotify {selected.Profile!.SpotifyVersion}"
                : $"{mappings.Count} stable names for this Spotify version"
            : "No verified mapping for this build", selected.Description));

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
                IsMacBundle(client) ? "The complete app is backed up and signed locally after installing."
                    : "Backed up first. Nothing else in Spotify's folder is touched."));
        return changes;
    }

    private static string Count(int n, string noun) => $"{n} {noun}{(n == 1 ? "" : "s")}";

    public Task<OperationResult> InstallAsync(FrameworkPackage package, int keepBackups, IProgress<InstallProgress> progress,
        CancellationToken cancellationToken) =>
        RunExclusiveAsync(Install, async () =>
        {
            var client = await StepAsync(0, progress, cancellationToken, () =>
            {
                var current = spotify.Detect(freshBuild: true);
                RequireCompleteNativeMacTarget(current);
                if (InstallBlocker(current) is { } blocker)
                    throw new InvalidOperationException(blocker);
                log.Info(Install, $"Spotify {current.Version} (desktop) at {current.InstallPath}");
                log.Info(Install, $"Spotify's files: {Megabytes(current.XpuiPath!)}" +
                                  (current.HasSpotiKit ? $", SpotiKit {current.Xpui!.SpotiKitVersion} already present" : ""));
                return current;
            }).ConfigureAwait(false);

            var macTransaction = IsMacBundle(client);
            progress.Report(new InstallProgress(0, 1) { Plan = InstallPlanFor(client) });
            var backup = await StepAsync(1, progress, cancellationToken, () =>
            {
                var created = backups.Create(client, BackupKind.Automatic);
                log.Success(Install, $"Backup {created.Manifest.Id} created ({Megabytes(created.TotalSize)})");
                foreach (var removed in backups.Prune(keepBackups))
                    log.Info(Install, $"Removed old backup {removed.Manifest.Id} (keeping {keepBackups})");
                return created;
            }).ConfigureAwait(false);

            string? published = null;
            MacBundleTransaction? transaction = null;
            try
            {
                var prepared = await StepAsync(2, progress, CancellationToken.None, () =>
                {
                    var selected = (classMaps ?? ClassMapCatalog.Bundled).Select(client);
                    var mappings = selected.Mappings;
                    var addonSet = addons?.Load(client.Version) ?? AddonSet.Empty;
                    ClassMapResult Patch(SpotifyInstallation target)
                    {
                        var applied = XpuiPatcher.Inject(target.XpuiPath!, package.LoaderScript, package.Version, mappings, client.Version, addonSet, selected);
                        if (XpuiPatcher.ReadLoader(target.XpuiPath!) is not { } installedLoader ||
                            FileHash.Sha256(System.Text.Encoding.UTF8.GetBytes(installedLoader)) != package.LoaderSha256)
                            throw new InvalidDataException("The staged loader does not match the package.");
                        return applied;
                    }
                    ClassMapResult result;
                    if (macTransaction)
                    {
                        if (backup.Manifest.BundleFingerprint is null)
                            throw new IOException("The complete Mac recovery snapshot is missing. Recheck compatibility and retry.");
                        transaction = new MacBundleTransaction(client, spotify.IsRunning,
                            expectedFingerprint: backup.Manifest.BundleFingerprint);
                        result = Patch(transaction.WorkingClient);
                    }
                    else
                        result = Mutate(client, false, Patch);
                    return (Classes: result, Selection: selected, Addons: addonSet);
                }).ConfigureAwait(false);

                if (transaction is not null)
                    await StepAsync(3, progress, CancellationToken.None, () =>
                    {
                        log.Info(Install, "Signing the Mac Spotify app locally…");
                        transaction.Commit();
                        published = transaction.PublishedFingerprint;
                        LogRetainedRecovery(transaction);
                        log.Success(Install, "The Mac Spotify bundle was signed locally and its complete signature verified.");
                        return true;
                    }).ConfigureAwait(false);

                if (prepared.Selection.IsFallback)
                    log.Warning(Install, prepared.Selection.Description);
                else
                    log.Info(Install, prepared.Selection.Description);
                log.Info(Install, $"SpotiKit {package.Version} added");
                LogClassMap(prepared.Classes, prepared.Selection.Mappings.Count);
                LogAddons(prepared.Addons);

                await StepAsync(macTransaction ? 4 : 3, progress, CancellationToken.None, () =>
                {
                    var check = XpuiPatcher.Inspect(client.XpuiPath!);
                    var loader = XpuiPatcher.ReadLoader(client.XpuiPath!);
                    if (!check.HasSpotiKit || loader is null ||
                        FileHash.Sha256(System.Text.Encoding.UTF8.GetBytes(loader)) != package.LoaderSha256)
                        throw new InvalidDataException("The installed loader does not match the package.");
                    if (prepared.Classes.Applied.Count > 0 &&
                        XpuiPatcher.ReadClassMap(client.XpuiPath!)?.Applied.Count != prepared.Classes.Applied.Count)
                        throw new InvalidDataException("The class map in the client does not match what was applied.");

                    state.Update(s => s with
                    {
                        Install = new InstallRecord(package.Version, package.Channel, DateTimeOffset.Now,
                            client.Version ?? "unknown", backup.Manifest.Id, package.LoaderSha256) { Build = client.Build },
                    });
                    log.Success(Install, $"SpotiKit {package.Version} is installed. It loads the next time Spotify starts.");
                    return true;
                }).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                RollBackPublished(Install, client, backup, published, macTransaction, ex);
                throw;
            }
            finally
            {
                transaction?.Dispose();
            }

            return new OperationResult(true, $"SpotiKit {package.Version} installed.");
        });

    public Task<OperationResult> UninstallAsync(int keepBackups, IProgress<InstallProgress> progress,
        CancellationToken cancellationToken) =>
        RunExclusiveAsync(Uninstall, async () =>
        {
            var client = await StepAsync(0, progress, cancellationToken, () =>
            {
                var current = spotify.Detect(freshBuild: true);
                RequireCompleteNativeMacTarget(current);
                if (current is not { Edition: SpotifyEdition.Desktop, XpuiKind: XpuiKind.Spa, XpuiPath: not null })
                    throw new InvalidOperationException("The Spotify desktop client with its standard files was not found.");
                if (!current.HasSpotiKit)
                    throw new InvalidOperationException("SpotiKit is not installed in this Spotify client, so there is nothing to remove.");
                if (current.IsRunning)
                    throw new InvalidOperationException("Spotify is running. Close it first.");
                log.Info(Uninstall, $"Spotify {current.Version}: removing SpotiKit {current.Xpui!.SpotiKitVersion}");
                return current;
            }).ConfigureAwait(false);

            var macTransaction = IsMacBundle(client);
            var backup = await StepAsync(1, progress, cancellationToken, () =>
            {
                var created = backups.Create(client, BackupKind.Automatic);
                log.Success(Uninstall, $"Backup {created.Manifest.Id} created");
                backups.Prune(keepBackups);
                return created;
            }).ConfigureAwait(false);

            string? published = null;
            try
            {
                await StepAsync(2, progress, CancellationToken.None, () =>
                {
                    var original = backups.FindPristine(client);
                    if (macTransaction && original?.Manifest.FullBundle == true)
                    {
                        backups.Restore(original, client, fingerprint => published = fingerprint,
                            expectedFingerprint: backup.Manifest.BundleFingerprint);
                        if (XpuiPatcher.Inspect(client.XpuiPath!).HasSpotiKit)
                            throw new InvalidDataException("The restored original bundle still contains SpotiKit.");
                    }
                    else
                        Mutate(client, macTransaction, target =>
                        {
                            XpuiPatcher.Remove(target.XpuiPath!);
                            if (XpuiPatcher.Inspect(target.XpuiPath!).HasSpotiKit)
                                throw new InvalidDataException("SpotiKit is still in the staged archive.");
                            return true;
                        }, fingerprint => published = fingerprint, backup.Manifest.BundleFingerprint);
                    log.Info(Uninstall, "SpotiKit removed from Spotify's files");
                    if (devTools is not null && state.Load().DevTools is not null)
                        log.Info(Uninstall, devTools.Disable());
                    return true;
                }).ConfigureAwait(false);

                await StepAsync(3, progress, CancellationToken.None, () =>
                {
                    if (backups.FindPristine(client) is { } original)
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
                RollBackPublished(Uninstall, client, backup, published, macTransaction, ex);
                throw;
            }

            return new OperationResult(true, "SpotiKit removed.");
        });

    public Task<OperationResult> RestoreAsync(BackupInfo backup) =>
        RunExclusiveAsync(Restore, () => Task.Run(() =>
        {
            var client = spotify.Detect(freshBuild: true);
            var macTransaction = IsMacBundle(client);
            RequireCompleteNativeMacTarget(client);
            var expectedBundle = macTransaction
                ? MacBundleFiles.Fingerprint(MacApplicationBundle.FromResources(client.InstallPath!)!) : null;
            if (BackupService.RestoreBlocker(backup, client) is { } blocker)
                throw new InvalidOperationException(blocker);
            if (!backups.Verify(backup, out var problem))
                throw new InvalidDataException($"The backup can't be used: {problem}");

            log.Info(Restore, $"Restoring backup {backup.Manifest.Id} (Spotify {backup.Manifest.SpotifyVersion})");

            BackupInfo? safety = null;
            if (client.XpuiPath is not null && (FileHash.Sha256(client.XpuiPath) != backup.Manifest.Files[0].Sha256 ||
                macTransaction && expectedBundle != backup.Manifest.BundleFingerprint))
            {
                safety = backups.Create(client, BackupKind.Automatic);
                log.Info(Restore, $"Current state saved as backup {safety.Manifest.Id} first");
            }

            try
            {
                backups.Restore(backup, client, expectedFingerprint: safety?.Manifest.BundleFingerprint ?? expectedBundle);
            }
            catch (Exception ex)
            {
                if (safety is not null && !macTransaction)
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
        progress.Report(new InstallProgress(index, 0));
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

    private void RollBack(string operation, BackupInfo backup, Exception cause, string? expectedFingerprint = null)
    {
        log.Warning(operation, $"Something went wrong ({FriendlyError.Describe(cause).Message}). Rolling back to backup {backup.Manifest.Id}…");
        try
        {
            backups.Restore(backup, spotify.Detect(freshBuild: true), expectedFingerprint: expectedFingerprint);
            log.Success(operation, "Rolled back: Spotify is exactly as it was before.");
        }
        catch (Exception rollbackError)
        {
            log.Error(operation, rollbackError);
            log.Warning(operation, "The automatic rollback failed.",
                $"Restore backup {backup.Manifest.Id} from the Backups page, or reinstall Spotify.");
        }
    }

    private static bool IsMacBundle(SpotifyInstallation client) => OperatingSystem.IsMacOS() &&
        client.InstallPath is { } resources && MacApplicationBundle.FromResources(resources) is { } bundle &&
        MacBundleFiles.IsComplete(bundle);

    private void RequireCompleteNativeMacTarget(SpotifyInstallation client)
    {
        if (OperatingSystem.IsMacOS() && !spotify.IsSandboxed && client.InstallPath is { } resources &&
            MacApplicationBundle.FromResources(resources) is { } bundle && !MacBundleFiles.IsComplete(bundle))
            throw new InvalidOperationException("Spotify's Mac app is incomplete. Reinstall the complete Spotify app before changing it.");
        if (MacInstallPreflight.Problem(client) is { } problem)
            throw new InvalidOperationException(problem);
    }

    private void RollBackPublished(string operation, SpotifyInstallation client, BackupInfo backup, string? published,
        bool macTransaction, Exception failure)
    {
        if (!macTransaction) { RollBack(operation, backup, failure); return; }
        if (published is null) return; // The transaction owns recovery before a successful publication.
        var bundle = MacApplicationBundle.FromResources(client.InstallPath!)!;
        string? actual = null;
        try { actual = MacBundleFiles.Fingerprint(bundle); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        if (actual == published)
            RollBack(operation, backup, failure, published);
        else
            log.Warning(operation, "Spotify changed after publication. The newer app was left untouched.",
                $"The pre-operation recovery copy is backup {backup.Manifest.Id}.");
    }

    private T Mutate<T>(SpotifyInstallation client, bool macTransaction, Func<SpotifyInstallation, T> change,
        Action<string>? onPublished = null, string? expectedFingerprint = null)
    {
        if (!macTransaction)
        {
            if (IsMacBundle(client)) throw new IOException("Spotify changed into a complete app during this operation. Recheck compatibility and retry.");
            return change(client);
        }
        if (expectedFingerprint is null)
            throw new IOException("The complete Mac recovery snapshot is missing. Recheck compatibility and retry.");
        using var transaction = new MacBundleTransaction(client, spotify.IsRunning, expectedFingerprint: expectedFingerprint);
        var result = change(transaction.WorkingClient);
        transaction.Commit();
        LogRetainedRecovery(transaction);
        onPublished?.Invoke(transaction.PublishedFingerprint!);
        log.Success(Install, "The Mac Spotify bundle was signed locally and its complete signature verified.");
        return result;
    }

    private void LogRetainedRecovery(MacBundleTransaction transaction)
    {
        if (transaction.RetentionMessage is { } message)
            log.Warning("Spotify recovery", message);
    }

    private static string? InsufficientSpace(SpotifyInstallation s)
    {
        try
        {
            var size = IsMacBundle(s)
                ? MacBundleFiles.Size(MacApplicationBundle.FromResources(s.InstallPath!)!)
                : new FileInfo(s.XpuiPath!).Length;
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

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace SpotiKit.Services;

public sealed record MacBundleRecoveryResult(
    string? OriginalBundle,
    string JournalPath,
    bool Recovered,
    bool NeedsAttention,
    string Message,
    string? RecoveryBundle = null,
    string? RetainedRecord = null);

public static class MacBundleRecovery
{
    public static IReadOnlyList<MacBundleRecoveryResult> RecoverPending(SpotiKitPaths paths)
    {
        if (!OperatingSystem.IsMacOS()) return [];
        // An override scopes recovery as well as installation. A data-only sandbox must never
        // discover and change a production app merely because it can see /Applications.
        if (paths.SpotifyDirOverride is { } resources)
        {
            var bundle = MacApplicationBundle.FromResources(resources);
            return bundle is null ? [] : RecoverInDirectory(Path.GetDirectoryName(bundle)!, bundle);
        }
        if (paths.IsSandboxed) return [];
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var userApplications = Path.Combine(home, "Applications");
        return RecoverInDirectory("/Applications", "/Applications/Spotify.app")
            .Concat(RecoverInDirectory(userApplications, Path.Combine(userApplications, "Spotify.app"))).ToArray();
    }

    internal static IReadOnlyList<MacBundleRecoveryResult> RecoverInDirectory(string directory, string? target = null,
        MacBundleSigner? signer = null)
    {
        MacBundleFiles.RequireMacOS();
        signer ??= new MacBundleSigner();
        var results = new List<MacBundleRecoveryResult>();
        if (!Directory.Exists(directory)) return results;
        string[] journals;
        try { journals = Directory.GetFiles(directory, MacBundleJournal.SearchPattern).Order(StringComparer.Ordinal).ToArray(); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return [new(null, directory, false, true, "SpotiKit could not inspect pending Spotify recovery records. " + ex.Message)];
        }
        string? canonicalTarget;
        try { canonicalTarget = target is null ? null : MacBundleJournal.CanonicalTarget(target); }
        catch (Exception ex) when (Recoverable(ex))
        {
            return [new(target, directory, false, true,
                "Spotify's recovery destination cannot be trusted. All app copies and records were retained. " + ex.Message)];
        }
        foreach (var path in journals)
        {
            try
            {
                var journal = MacBundleJournal.Read(path);
                if (journal is null)
                {
                    if (target is null)
                        results.Add(new(null, path, false, true,
                            "An unrecognized Spotify recovery record was retained. No application files were changed."));
                    continue;
                }
                if (canonicalTarget is not null && journal.OriginalBundle != canonicalTarget) continue;
                using var lease = MacBundleLock.Acquire(journal.OriginalBundle);
                // The process that held this lock may have completed while we were reading.
                if (!File.Exists(path)) continue;
                if (MacBundleJournal.Read(path) != journal)
                    results.Add(Preserved(journal, "The recovery record changed while it was being opened."));
                else
                    results.Add(RecoverLocked(journal, signer));
            }
            catch (Exception ex) when (Recoverable(ex))
            {
                results.Add(new(canonicalTarget, path, false, true,
                    "Spotify recovery was deferred; all available application copies and the recovery record were retained. " + ex.Message));
            }
        }
        return results;
    }

    // The caller must hold the target's MacBundleLock. Constructors use this before checking
    // for a complete source, so a missing Spotify.app can be recovered after an interrupted rename.
    internal static void RecoverTargetLocked(string target, MacBundleSigner signer)
    {
        foreach (var path in Directory.GetFiles(Path.GetDirectoryName(target)!, MacBundleJournal.SearchPattern))
        {
            var journal = MacBundleJournal.Read(path);
            if (journal?.OriginalBundle != target) continue;
            var result = RecoverLocked(journal, signer);
            if (result.NeedsAttention)
                throw new IOException(result.Message + " Recovery record: " + result.JournalPath);
        }
    }

    internal static MacBundleRecoveryResult RecoverLocked(MacBundleJournal journal, MacBundleSigner signer)
    {
        try
        {
            if (MacBundleJournal.Read(journal.JournalPath) != journal)
                return Preserved(journal, "The recovery record no longer matches this transaction.");

            // Any unexpected contents stop automatic cleanup as well as publication. Hashes
            // alone do not authorize moving an incomplete app or an app with a bad signature.
            foreach (var (path, fingerprint) in Copies(journal))
                if (Occupied(path) && !Matches(path, fingerprint))
                    return Preserved(journal, "An application copy changed outside this transaction: " + path);

            var targetExists = Occupied(journal.OriginalBundle);
            var isSource = targetExists && Matches(journal.OriginalBundle, journal.SourceFingerprint);
            var isWorking = targetExists && Matches(journal.OriginalBundle, journal.WorkingFingerprint);
            if (targetExists && !isSource && !isWorking)
                return Preserved(journal, "Spotify changed outside this transaction. The external app was left untouched.");
            foreach (var path in Copies(journal).Select(copy => copy.Path).Append(journal.OriginalBundle))
                if (Occupied(path) && IsRunning(path))
                    return Preserved(journal, "A Spotify application copy is running. Quit it and reopen SpotiKit to retry recovery.");

            var recovered = false;
            if (!targetExists)
            {
                // A committed publication was fsynced before this flag. Its later absence is
                // an external removal, rather than evidence that we should resurrect the app.
                if (journal.Committed || !Occupied(journal.RecoveryBundle))
                    return Preserved(journal, "Spotify is missing, but there is no matching uncommitted original to restore automatically.");
                RequireExact(journal.RecoveryBundle, journal.SourceFingerprint, signer);
                Directory.Move(journal.RecoveryBundle, journal.OriginalBundle);
                MacBundleJournal.SyncDirectory(journal.Parent);
                RequireExact(journal.OriginalBundle, journal.SourceFingerprint, signer);
                recovered = true;
            }
            else if (!journal.Committed && isWorking && !isSource)
            {
                // Publication occurred, but its final verification/commit record did not.
                if (!Occupied(journal.RecoveryBundle) || Occupied(journal.FailedBundle))
                    return Preserved(journal, "The interrupted publication cannot be rolled back without replacing another application copy.");
                RequireExact(journal.RecoveryBundle, journal.SourceFingerprint, signer);
                RequireExact(journal.OriginalBundle, journal.WorkingFingerprint, signer);
                Directory.Move(journal.OriginalBundle, journal.FailedBundle);
                MacBundleJournal.SyncDirectory(journal.Parent);
                Directory.Move(journal.RecoveryBundle, journal.OriginalBundle);
                MacBundleJournal.SyncDirectory(journal.Parent);
                RequireExact(journal.OriginalBundle, journal.SourceFingerprint, signer);
                recovered = true;
            }
            else
            {
                RequireExact(journal.OriginalBundle,
                    journal.Committed && isWorking ? journal.WorkingFingerprint : journal.SourceFingerprint, signer);
            }

            if (journal.Committed && isWorking && Occupied(journal.RecoveryBundle))
            {
                try { RequireExact(journal.RecoveryBundle, journal.SourceFingerprint, signer); }
                catch (IOException)
                {
                    // Repair can legitimately start from a bundle whose old signature is
                    // already invalid. The newly published app is valid; keep that exact old
                    // copy for inspection, but retire its completed record so it cannot block
                    // the next repair/uninstall. Changed copies/targets still remain active.
                    if (!Matches(journal.RecoveryBundle, journal.SourceFingerprint)) throw;
                    RequireExact(journal.OriginalBundle, journal.WorkingFingerprint, signer);
                    journal.Retire();
                    return new(journal.OriginalBundle, journal.JournalPath, recovered, false,
                        "Spotify's new app was verified. Its previous app could not pass signature verification and was retained at " +
                        journal.RecoveryBundle + ". Recovery record: " + journal.RetainedPath,
                        journal.RecoveryBundle, journal.RetainedPath);
                }
            }

            foreach (var (path, fingerprint) in Copies(journal))
                if (Occupied(path))
                {
                    RequireExact(path, fingerprint, signer);
                    if (IsRunning(path)) return Preserved(journal, "An application copy reopened before recovery cleanup.", recovered);
                    Directory.Delete(path, recursive: true);
                    MacBundleJournal.SyncDirectory(journal.Parent);
                }
            journal.Delete();
            return new(journal.OriginalBundle, journal.JournalPath, recovered, false,
                recovered ? "Recovered the previous verified Spotify app after an interrupted replacement."
                    : "Verified Spotify and removed the matching remnants of a completed or canceled replacement.");
        }
        catch (Exception ex) when (Recoverable(ex))
        {
            return Preserved(journal, "Automatic recovery could not be completed safely. " + ex.Message);
        }
    }

    private static IEnumerable<(string Path, string Fingerprint)> Copies(MacBundleJournal journal)
    {
        yield return (journal.RecoveryBundle, journal.SourceFingerprint);
        yield return (journal.WorkingBundle, journal.WorkingFingerprint);
        yield return (journal.FailedBundle, journal.WorkingFingerprint);
    }

    internal static bool Occupied(string path) => Directory.Exists(path) || File.Exists(path) || new FileInfo(path).LinkTarget is not null;

    private static bool Matches(string bundle, string fingerprint) => MacBundleFiles.IsComplete(bundle) &&
        MacBundleFiles.Fingerprint(bundle) == fingerprint;

    internal static void RequireExact(string bundle, string fingerprint, MacBundleSigner signer)
    {
        if (!Matches(bundle, fingerprint)) throw new IOException("An application copy no longer matches its recovery record: " + bundle);
        signer.Verify(bundle);
        if (!Matches(bundle, fingerprint)) throw new IOException("An application copy changed during verification: " + bundle);
    }

    private static bool IsRunning(string bundle) =>
        MacBundleFiles.RunningProcessIds(Path.Combine(bundle, "Contents", "MacOS", "Spotify")).Length > 0;

    private static MacBundleRecoveryResult Preserved(MacBundleJournal journal, string reason, bool recovered = false) =>
        new(journal.OriginalBundle, journal.JournalPath, recovered, true,
            reason + " Available recovery copies and the journal were retained. Inspect " + journal.JournalPath +
            " before trying another installation.", Occupied(journal.RecoveryBundle) ? journal.RecoveryBundle : null);

    private static bool Recoverable(Exception ex) => ex is IOException or UnauthorizedAccessException or JsonException or
        ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception;
}

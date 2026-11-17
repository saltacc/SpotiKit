using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public sealed class MacBundleRecoveryTests
{
    [MacOSFact]
    public void A_child_rename_interruption_recovers_a_missing_source_from_the_durable_record()
    {
        using var fixture = new PersistedReplacement();
        fixture.MoveOriginalInChild();
        Assert.False(Directory.Exists(fixture.Owner.Bundle));

        // The new recovery invocation has no in-memory transaction. It discovers the persisted
        // record from the configured parent even though Contents/Resources no longer exists.
        var result = Assert.Single(MacBundleRecovery.RecoverPending(fixture.Paths));
        Assert.True(result.Recovered);
        Assert.False(result.NeedsAttention, result.Message);
        Assert.Equal(fixture.Journal.SourceFingerprint, MacBundleFiles.Fingerprint(fixture.Owner.Bundle));
        new MacBundleSigner().Verify(fixture.Owner.Bundle);
        Assert.False(Directory.Exists(fixture.Journal.WorkingBundle));
        Assert.False(File.Exists(fixture.Journal.JournalPath));
        Assert.Empty(MacBundleRecovery.RecoverPending(fixture.Paths));
    }

    [MacOSFact]
    public void A_transaction_constructor_recovers_before_requiring_a_complete_source()
    {
        using var fixture = new PersistedReplacement();
        fixture.MoveOriginalInChild();
        using var transaction = new MacBundleTransaction(fixture.Owner.Client, () => false);
        Assert.Equal(fixture.Journal.SourceFingerprint, MacBundleFiles.Fingerprint(fixture.Owner.Bundle));
        Assert.True(MacBundleFiles.IsComplete(transaction.WorkingBundle));
        Assert.False(File.Exists(fixture.Journal.JournalPath));
    }

    [MacOSFact]
    public void An_interruption_after_publication_but_before_commit_rolls_back_the_exact_old_app()
    {
        using var fixture = new PersistedReplacement();
        fixture.MoveOriginalInChild();
        fixture.PublishInChild();
        Assert.Equal(fixture.Journal.WorkingFingerprint, MacBundleFiles.Fingerprint(fixture.Owner.Bundle));

        var result = Assert.Single(MacBundleRecovery.RecoverPending(fixture.Paths));
        Assert.True(result.Recovered);
        Assert.False(result.NeedsAttention, result.Message);
        Assert.Equal(fixture.Journal.SourceFingerprint, MacBundleFiles.Fingerprint(fixture.Owner.Bundle));
        Assert.False(Directory.Exists(fixture.Journal.FailedBundle));
        Assert.False(File.Exists(fixture.Journal.JournalPath));
    }

    [MacOSFact]
    public void An_interruption_after_the_durable_commit_keeps_the_verified_new_app()
    {
        using var fixture = new PersistedReplacement();
        fixture.MoveOriginalInChild();
        fixture.PublishInChild();
        fixture.MarkCommitted();

        var result = Assert.Single(MacBundleRecovery.RecoverPending(fixture.Paths));
        Assert.False(result.Recovered);
        Assert.False(result.NeedsAttention, result.Message);
        Assert.Equal(fixture.Journal.WorkingFingerprint, MacBundleFiles.Fingerprint(fixture.Owner.Bundle));
        Assert.False(Directory.Exists(fixture.Journal.RecoveryBundle));
        Assert.False(File.Exists(fixture.Journal.JournalPath));
        Assert.Empty(MacBundleRecovery.RecoverPending(fixture.Paths));
    }

    [MacOSFact]
    public void An_interrupted_rollback_recovers_while_preserving_the_journal_until_verified()
    {
        using var fixture = new PersistedReplacement();
        fixture.MoveOriginalInChild();
        fixture.PublishInChild();
        MoveInChild(fixture.Owner.Bundle, fixture.Journal.FailedBundle);

        var result = Assert.Single(MacBundleRecovery.RecoverPending(fixture.Paths));
        Assert.True(result.Recovered);
        Assert.False(result.NeedsAttention, result.Message);
        Assert.Equal(fixture.Journal.SourceFingerprint, MacBundleFiles.Fingerprint(fixture.Owner.Bundle));
        Assert.False(Directory.Exists(fixture.Journal.FailedBundle));
    }

    [MacOSFact]
    public void An_intact_original_allows_cleanup_of_only_the_verified_owned_stage()
    {
        using var fixture = new PersistedReplacement();
        var unrelated = Path.Combine(fixture.Owner.Root, ".spotikit-stage-unrelated.app");
        Directory.CreateDirectory(unrelated);
        File.WriteAllText(Path.Combine(unrelated, "keep"), "unrelated");

        var result = Assert.Single(MacBundleRecovery.RecoverPending(fixture.Paths));
        Assert.False(result.NeedsAttention, result.Message);
        Assert.Equal(fixture.Journal.SourceFingerprint, MacBundleFiles.Fingerprint(fixture.Owner.Bundle));
        Assert.True(File.Exists(Path.Combine(unrelated, "keep")));
        Assert.False(Directory.Exists(fixture.Journal.WorkingBundle));
    }

    [MacOSFact]
    public void An_external_destination_update_preserves_both_it_and_the_original_recovery()
    {
        using var fixture = new PersistedReplacement();
        fixture.MoveOriginalInChild();
        fixture.PublishInChild();
        RewriteAndSign(fixture.Owner.Bundle, "externally updated Spotify");
        var external = MacBundleFiles.Fingerprint(fixture.Owner.Bundle);

        var result = Assert.Single(MacBundleRecovery.RecoverPending(fixture.Paths));
        Assert.True(result.NeedsAttention);
        Assert.False(result.Recovered);
        Assert.Equal(external, MacBundleFiles.Fingerprint(fixture.Owner.Bundle));
        Assert.Equal(fixture.Journal.SourceFingerprint, MacBundleFiles.Fingerprint(fixture.Journal.RecoveryBundle));
        Assert.True(File.Exists(fixture.Journal.JournalPath));
        Assert.True(Assert.Single(MacBundleRecovery.RecoverPending(fixture.Paths)).NeedsAttention);
        Assert.Equal(external, MacBundleFiles.Fingerprint(fixture.Owner.Bundle));
    }

    [MacOSFact]
    public void A_changed_hidden_recovery_is_never_promoted_or_deleted()
    {
        using var fixture = new PersistedReplacement();
        fixture.MoveOriginalInChild();
        RewriteAndSign(fixture.Journal.RecoveryBundle, "external recovery edit");
        var external = MacBundleFiles.Fingerprint(fixture.Journal.RecoveryBundle);

        var result = Assert.Single(MacBundleRecovery.RecoverPending(fixture.Paths));
        Assert.True(result.NeedsAttention);
        Assert.False(Directory.Exists(fixture.Owner.Bundle));
        Assert.Equal(external, MacBundleFiles.Fingerprint(fixture.Journal.RecoveryBundle));
        Assert.True(File.Exists(fixture.Journal.JournalPath));
    }

    [MacOSFact]
    public void A_matching_original_with_an_invalid_signature_is_retained_for_manual_recovery()
    {
        using var fixture = new PersistedReplacement(invalidateOriginalSignature: true);
        fixture.MoveOriginalInChild();

        var result = Assert.Single(MacBundleRecovery.RecoverPending(fixture.Paths));
        Assert.True(result.NeedsAttention);
        Assert.False(Directory.Exists(fixture.Owner.Bundle));
        Assert.Equal(fixture.Journal.SourceFingerprint, MacBundleFiles.Fingerprint(fixture.Journal.RecoveryBundle));
        Assert.True(File.Exists(fixture.Journal.JournalPath));
    }

    [MacOSFact]
    public void A_later_external_deletion_of_a_committed_app_is_not_undone()
    {
        using var fixture = new PersistedReplacement();
        fixture.MoveOriginalInChild();
        fixture.PublishInChild();
        fixture.MarkCommitted();
        var removed = Path.Combine(fixture.Owner.Root, "Externally removed.app");
        Directory.Move(fixture.Owner.Bundle, removed);

        var result = Assert.Single(MacBundleRecovery.RecoverPending(fixture.Paths));
        Assert.True(result.NeedsAttention);
        Assert.False(Directory.Exists(fixture.Owner.Bundle));
        Assert.True(Directory.Exists(fixture.Journal.RecoveryBundle));
        Assert.Equal(fixture.Journal.WorkingFingerprint, MacBundleFiles.Fingerprint(removed));
    }

    [MacOSFact]
    public void A_record_cannot_redirect_recovery_to_an_app_in_another_parent()
    {
        using var fixture = new PersistedReplacement();
        fixture.MoveOriginalInChild();
        var forged = fixture.Journal with { OriginalBundle = Path.Combine(fixture.Owner.Root, "Elsewhere", "Spotify.app") };
        File.WriteAllText(fixture.Journal.JournalPath,
            JsonSerializer.Serialize(forged, MacBundleJournalJsonContext.Default.MacBundleJournal));

        var result = Assert.Single(MacBundleRecovery.RecoverInDirectory(fixture.Owner.Root));
        Assert.True(result.NeedsAttention);
        Assert.False(Directory.Exists(forged.OriginalBundle));
        Assert.Equal(fixture.Journal.SourceFingerprint, MacBundleFiles.Fingerprint(fixture.Journal.RecoveryBundle));
        Assert.True(File.Exists(fixture.Journal.JournalPath));
    }

    [MacOSFact]
    public void Symbolic_link_destinations_and_journals_are_retained_without_following_them()
    {
        using var fixture = new PersistedReplacement();
        fixture.MoveOriginalInChild();
        var external = Path.Combine(fixture.Owner.Root, "External.app");
        MacBundleFiles.Copy(fixture.Journal.RecoveryBundle, external);
        Directory.CreateSymbolicLink(fixture.Owner.Bundle, external);
        var externalFingerprint = MacBundleFiles.Fingerprint(external);

        var results = MacBundleRecovery.RecoverPending(fixture.Paths);
        Assert.Contains(results, result => result.NeedsAttention);
        Assert.Equal(externalFingerprint, MacBundleFiles.Fingerprint(external));
        Assert.NotNull(new DirectoryInfo(fixture.Owner.Bundle).LinkTarget);
        Assert.True(Directory.Exists(fixture.Journal.RecoveryBundle));

        Directory.Delete(fixture.Owner.Bundle);
        var actualRecord = fixture.Journal.JournalPath + ".external";
        File.Move(fixture.Journal.JournalPath, actualRecord);
        File.CreateSymbolicLink(fixture.Journal.JournalPath, actualRecord);
        var recordBytes = File.ReadAllBytes(actualRecord);
        Assert.True(Assert.Single(MacBundleRecovery.RecoverInDirectory(fixture.Owner.Root)).NeedsAttention);
        Assert.Equal(recordBytes, File.ReadAllBytes(actualRecord));
        Assert.NotNull(new FileInfo(fixture.Journal.JournalPath).LinkTarget);
    }

    [MacOSFact]
    public void A_live_transaction_excludes_startup_recovery_until_its_lock_is_released()
    {
        using var fixture = new PersistedReplacement();
        fixture.MoveOriginalInChild();
        using (MacBundleLock.Acquire(fixture.Owner.Bundle))
        {
            var result = Assert.Single(MacBundleRecovery.RecoverPending(fixture.Paths));
            Assert.True(result.NeedsAttention);
            Assert.False(Directory.Exists(fixture.Owner.Bundle));
            Assert.True(File.Exists(fixture.Journal.JournalPath));
        }
        Assert.True(Assert.Single(MacBundleRecovery.RecoverPending(fixture.Paths)).Recovered);
    }

    [MacOSFact]
    public void A_spawned_child_does_not_inherit_the_transaction_lock()
    {
        using var owner = new MacBundleTests.OwnedBundle();
        var lease = MacBundleLock.Acquire(owner.Bundle);
        using var child = Process.Start(new ProcessStartInfo("/bin/sleep")
        {
            ArgumentList = { "30" },
            UseShellExecute = false,
        })!;
        try
        {
            Assert.Throws<IOException>(() => MacBundleLock.Acquire(owner.Bundle));
            lease.Dispose();
            Assert.False(child.HasExited);
            using var nextLease = MacBundleLock.Acquire(owner.Bundle);
        }
        finally
        {
            lease.Dispose();
            if (!child.HasExited) child.Kill();
            child.WaitForExit();
        }
    }

    [MacOSFact]
    public void Commit_releases_its_lease_before_disposal_for_the_callers_receipt_guarded_rollback()
    {
        using var owner = new MacBundleTests.OwnedBundle();
        using var published = new MacBundleTransaction(owner.Client, () => false);
        published.Commit();

        // The publishing object is deliberately still alive, as it is when InstallerService
        // catches a later StateStore.Save failure inside its outer try/finally.
        using var rollback = new MacBundleTransaction(owner.Client, () => false,
            expectedFingerprint: published.PublishedFingerprint);
        Assert.True(MacBundleFiles.IsComplete(rollback.WorkingBundle));
        Assert.Throws<InvalidOperationException>(() => published.Commit());
        Assert.Throws<InvalidOperationException>(() => published.ReplaceWorkingBundle(owner.Bundle));
    }

    [MacOSFact]
    public void A_data_only_sandbox_does_not_start_global_recovery()
    {
        using var fixture = new PersistedReplacement();
        fixture.MoveOriginalInChild();
        var sandbox = fixture.Paths with { SpotifyDirOverride = null, IsSandboxed = true };
        Assert.Empty(MacBundleRecovery.RecoverPending(sandbox));
        Assert.True(File.Exists(fixture.Journal.JournalPath));
        Assert.False(Directory.Exists(fixture.Owner.Bundle));
    }

    [MacOSFact]
    public void Selected_target_recovery_leaves_another_development_apps_journal_untouched()
    {
        using var fixture = new PersistedReplacement();
        fixture.MoveOriginalInChild();
        var anotherTarget = Path.Combine(fixture.Owner.Root, "Spotify.app");

        Assert.Empty(MacBundleRecovery.RecoverInDirectory(fixture.Owner.Root, anotherTarget));
        Assert.False(Directory.Exists(fixture.Owner.Bundle));
        Assert.False(Directory.Exists(anotherTarget));
        Assert.Equal(fixture.Journal.SourceFingerprint, MacBundleFiles.Fingerprint(fixture.Journal.RecoveryBundle));
        Assert.True(File.Exists(fixture.Journal.JournalPath));
    }

    [MacOSFact]
    public void A_successful_repair_keeps_its_signed_publication_even_if_the_old_signature_was_invalid()
    {
        using var owner = new MacBundleTests.OwnedBundle();
        var pristine = Path.Combine(owner.Root, "Verified pristine.app");
        MacBundleFiles.Copy(owner.Bundle, pristine);
        var original = MacBundleFiles.Fingerprint(pristine);
        Sandbox.ReplaceEntry(owner.Archive, "index.html", "<html><body>old invalid signature</body></html>");
        var invalidOriginal = MacBundleFiles.Fingerprint(owner.Bundle);
        string retained;
        using (var transaction = new MacBundleTransaction(owner.Client, () => false))
        {
            transaction.Commit();
            Assert.NotNull(transaction.PublishedFingerprint);
            Assert.Equal(transaction.PublishedFingerprint, MacBundleFiles.Fingerprint(owner.Bundle));
            new MacBundleSigner().Verify(owner.Bundle);
            Assert.NotNull(transaction.RetainedRecoveryBundle);
            retained = transaction.RetainedRecoveryBundle!;
            Assert.Equal(invalidOriginal, MacBundleFiles.Fingerprint(retained));
            Assert.NotNull(transaction.RetainedRecoveryRecord);
            Assert.True(File.Exists(transaction.RetainedRecoveryRecord));
            Assert.Contains(retained, transaction.RetentionMessage!);
            Assert.Empty(Directory.GetFiles(owner.Root, MacBundleJournal.SearchPattern));
        }

        // The normal full-restore transaction used by uninstall can now run without manual
        // hidden-file intervention. It preserves the exact pristine signature as usual.
        using var restore = new MacBundleTransaction(owner.Client, () => false);
        restore.ReplaceWorkingBundle(pristine);
        restore.Commit(sign: false);
        Assert.Equal(original, MacBundleFiles.Fingerprint(owner.Bundle));
        Assert.Equal(invalidOriginal, MacBundleFiles.Fingerprint(retained));
        Assert.Null(restore.RetentionMessage);
        Assert.Empty(Directory.GetFiles(owner.Root, MacBundleJournal.SearchPattern));
    }

    [MacOSFact]
    public void Commit_flushes_a_valid_recovery_record_before_the_first_rename()
    {
        using var owner = new MacBundleTests.OwnedBundle();
        var checkedRecord = false;
        using var transaction = new MacBundleTransaction(owner.Client, () => false, null, (source, destination) =>
        {
            if (MacBundleJournal.CanonicalTarget(source) == MacBundleJournal.CanonicalTarget(owner.Bundle))
            {
                var record = MacBundleJournal.Read(Assert.Single(Directory.GetFiles(owner.Root, MacBundleJournal.SearchPattern)));
                Assert.NotNull(record);
                Assert.Equal(MacBundleFiles.Fingerprint(source), record!.SourceFingerprint);
                Assert.Equal(MacBundleFiles.Fingerprint(record.WorkingBundle), record.WorkingFingerprint);
                Assert.Equal(destination, record.RecoveryBundle);
                Assert.False(record.Committed);
                checkedRecord = true;
            }
            Directory.Move(source, destination);
        });
        transaction.Commit();
        Assert.True(checkedRecord);
        Assert.Empty(Directory.GetFiles(owner.Root, MacBundleJournal.SearchPattern));
    }

    private static void MoveInChild(string source, string destination)
    {
        MacBundleFiles.Run("/bin/mv", source, destination).EnsureSuccess("Move owned interruption fixture");
        MacBundleJournal.SyncDirectory(Path.GetDirectoryName(source)!);
    }

    private static void RewriteAndSign(string bundle, string marker)
    {
        var archive = Path.Combine(bundle, "Contents", "Resources", "Apps", "xpui.spa");
        Sandbox.ReplaceEntry(archive, "index.html", "<html><body>" + marker + "</body></html>");
        new MacBundleSigner().SignAndVerify(bundle);
    }

    private sealed class PersistedReplacement : IDisposable
    {
        internal PersistedReplacement(bool invalidateOriginalSignature = false)
        {
            Owner = new MacBundleTests.OwnedBundle();
            if (invalidateOriginalSignature)
                Sandbox.ReplaceEntry(Owner.Archive, "index.html", "<html><body>legacy invalid signature</body></html>");
            var target = MacBundleJournal.CanonicalTarget(Owner.Bundle);
            var id = Guid.NewGuid().ToString("N");
            var preliminary = new MacBundleJournal(1, id, target, MacBundleFiles.Fingerprint(target), new string('0', 64));
            MacBundleFiles.Copy(target, preliminary.WorkingBundle);
            RewriteAndSign(preliminary.WorkingBundle, "prepared replacement");
            Journal = preliminary with { WorkingFingerprint = MacBundleFiles.Fingerprint(preliminary.WorkingBundle) };
            Journal.Write();
            Paths = new SpotiKitPaths(Path.Combine(Owner.Root, "data"), Path.Combine(Owner.Root, "settings.json"),
                Path.Combine(Owner.Bundle, "Contents", "Resources"), Path.Combine(Owner.Root, "local")) { IsSandboxed = true };
        }

        internal MacBundleTests.OwnedBundle Owner { get; }
        internal MacBundleJournal Journal { get; private set; }
        internal SpotiKitPaths Paths { get; }
        internal void MoveOriginalInChild() => MoveInChild(Journal.OriginalBundle, Journal.RecoveryBundle);
        internal void PublishInChild() => MoveInChild(Journal.WorkingBundle, Journal.OriginalBundle);
        internal void MarkCommitted()
        {
            Journal = Journal with { Committed = true };
            Journal.Write();
        }
        public void Dispose() => Owner.Dispose();
    }
}

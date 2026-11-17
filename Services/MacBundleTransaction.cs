using System;
using System.Diagnostics;
using System.IO;
using SpotiKit.Models;

namespace SpotiKit.Services;

public sealed class MacBundleTransaction : IDisposable
{
    private readonly SpotifyInstallation _originalClient;
    private readonly string _sourceFingerprint;
    private readonly Func<bool> _isRunning;
    private readonly MacBundleSigner _signer;
    private readonly Action<string, string> _move;
    private readonly MacBundleLock _lease;
    private readonly string _recovery;
    private readonly string _failed;
    private readonly string _transactionId;
    private MacBundleJournal? _journal;
    private bool _committed;
    private bool _finished;
    private bool _disposed;

    public MacBundleTransaction(SpotifyInstallation client, Func<bool>? isRunning = null, MacBundleSigner? signer = null,
        string? expectedFingerprint = null)
        : this(client, isRunning, signer, Directory.Move, expectedFingerprint) { }

    internal MacBundleTransaction(SpotifyInstallation client, Func<bool>? isRunning, MacBundleSigner? signer,
        Action<string, string> move, string? expectedFingerprint = null)
    {
        MacBundleFiles.RequireMacOS();
        if (client.InstallPath is not { } resources || MacApplicationBundle.FromResources(resources) is not { } bundle)
            throw new InvalidOperationException("This operation needs the complete Spotify Mac app, including its frameworks.");
        // Keep the public/callback path spelling stable; lock and journal identities resolve
        // aliases such as /var versus /private/var independently.
        OriginalBundle = MacBundleFiles.RequireBundle(bundle, mustExist: false);
        var canonicalOriginal = MacBundleJournal.CanonicalTarget(OriginalBundle);
        _originalClient = client;
        _isRunning = () => IsRunning(OriginalBundle) || (isRunning?.Invoke() ?? false);
        _signer = signer ?? new MacBundleSigner();
        _move = move;
        _transactionId = Guid.NewGuid().ToString("N");
        var name = Path.GetFileNameWithoutExtension(OriginalBundle) + "-" + _transactionId;
        var parent = Path.GetDirectoryName(canonicalOriginal)!;
        WorkingBundle = Path.Combine(parent, ".spotikit-stage-" + name + ".app");
        _recovery = Path.Combine(parent, ".spotikit-recovery-" + name + ".app");
        _failed = Path.Combine(parent, ".spotikit-failed-" + name + ".app");
        try { MacInstallPreflight.RequireWritableParent(OriginalBundle); }
        catch (IOException error) { throw new InvalidOperationException(error.Message, error); }
        _lease = MacBundleLock.Acquire(OriginalBundle);
        try
        {
            // The source can be missing after a process died between the two rename calls.
            // Reconcile persisted work under the same cross-process lock before requiring it.
            MacBundleRecovery.RecoverTargetLocked(canonicalOriginal, _signer);
            if (!MacBundleFiles.IsComplete(OriginalBundle))
                throw new InvalidOperationException("This operation needs the complete Spotify Mac app, including its frameworks.");
            if (string.IsNullOrWhiteSpace(client.Version) || MacApplicationBundle.ReadVersion(resources) != client.Version)
                throw new InvalidOperationException("Spotify's bundle version could not be matched. Recheck compatibility before changing it.");
            if (client.ExecutablePath is not null && MacBundleFiles.CanonicalPath(client.ExecutablePath) !=
                Path.Combine(canonicalOriginal, "Contents", "MacOS", "Spotify"))
                throw new InvalidOperationException("Spotify's executable does not belong to the selected application bundle.");
            if (client.IsRunning || _isRunning())
                throw new InvalidOperationException("Spotify is running. Close this app before changing its bundle.");
            _sourceFingerprint = MacBundleFiles.Fingerprint(OriginalBundle);
            if (expectedFingerprint is not null && expectedFingerprint != _sourceFingerprint)
                throw new IOException("Spotify changed before this operation could start. The external change was left untouched.");
            MacBundleFiles.Copy(OriginalBundle, WorkingBundle);
            if (MacBundleFiles.Fingerprint(WorkingBundle) != _sourceFingerprint ||
                MacBundleFiles.Fingerprint(OriginalBundle) != _sourceFingerprint)
                throw new IOException("Spotify changed while its working copy was being prepared. Recheck the installed version and retry.");
        }
        catch
        {
            MacBundleFiles.TryDelete(WorkingBundle);
            _lease.Dispose();
            throw;
        }
    }

    public string OriginalBundle { get; }
    public string WorkingBundle { get; }
    public string? PublishedFingerprint { get; private set; }
    public string? RetainedRecoveryBundle { get; private set; }
    public string? RetainedRecoveryRecord { get; private set; }
    public string? RetentionMessage { get; private set; }
    public SpotifyInstallation WorkingClient => _originalClient with
    {
        InstallPath = Path.Combine(WorkingBundle, "Contents", "Resources"),
        ExecutablePath = Path.Combine(WorkingBundle, "Contents", "MacOS", "Spotify"),
        XpuiPath = Path.Combine(WorkingBundle, "Contents", "Resources", "Apps", "xpui.spa"),
        IsRunning = false,
    };

    public void ReplaceWorkingBundle(string sourceBundle)
    {
        ThrowIfFinished();
        sourceBundle = MacBundleFiles.RequireBundle(sourceBundle);
        if (!MacBundleFiles.IsComplete(sourceBundle))
            throw new InvalidOperationException("The recovery copy is not a complete Spotify app.");
        if (sourceBundle == WorkingBundle || sourceBundle.StartsWith(WorkingBundle + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new IOException("The recovery copy must be separate from the working app.");
        var resources = Path.Combine(sourceBundle, "Contents", "Resources");
        if (MacApplicationBundle.ReadVersion(resources) != _originalClient.Version)
            throw new InvalidOperationException("The recovery copy is from a different Spotify version.");
        MacBundleFiles.TryDelete(WorkingBundle);
        if (Directory.Exists(WorkingBundle)) throw new IOException("The previous working app could not be removed.");
        MacBundleFiles.Copy(sourceBundle, WorkingBundle);
    }

    public void Commit(bool sign = true)
    {
        ThrowIfFinished();
        try { CommitCore(sign); }
        finally
        {
            // Higher-level state persistence can fail after publication. Its exact-receipt
            // rollback uses a new transaction before this instance leaves its using scope.
            // Publication/recovery metadata is now settled, so release the cross-process
            // lease here while retaining this instance's receipt and recovery paths.
            _finished = true;
            _lease.Dispose();
        }
    }

    private void CommitCore(bool sign)
    {
        if (_isRunning()) throw new InvalidOperationException("Spotify reopened while its working copy was prepared. Close it and retry.");
        if (sign) _signer.SignAndVerify(WorkingBundle);
        else _signer.Verify(WorkingBundle);
        var expectedPublishedFingerprint = MacBundleFiles.Fingerprint(WorkingBundle);
        if (_isRunning()) throw new InvalidOperationException("Spotify reopened while its working copy was prepared. Close it and retry.");
        if (MacBundleFiles.Fingerprint(OriginalBundle) != _sourceFingerprint)
            throw new IOException("Spotify changed while this operation was prepared. The updated app was left untouched; recheck compatibility and retry.");
        _journal = new MacBundleJournal(1, _transactionId, MacBundleJournal.CanonicalTarget(OriginalBundle),
            _sourceFingerprint, expectedPublishedFingerprint);
        _journal.Write();
        var movedOriginal = false;
        var published = false;
        try
        {
            _move(OriginalBundle, _recovery);
            movedOriginal = true;
            MacBundleJournal.SyncDirectory(Path.GetDirectoryName(OriginalBundle)!);
            if (MacBundleFiles.Fingerprint(_recovery) != _sourceFingerprint)
                throw new IOException("Spotify changed during application replacement.");
            _move(WorkingBundle, OriginalBundle);
            published = true;
            MacBundleJournal.SyncDirectory(Path.GetDirectoryName(OriginalBundle)!);
            _signer.Verify(OriginalBundle);
            if (MacBundleFiles.Fingerprint(OriginalBundle) != expectedPublishedFingerprint)
                throw new IOException("Spotify changed after the working app was published. The external change was left untouched.");
            _journal = _journal with { Committed = true };
            _journal.Write();
            PublishedFingerprint = expectedPublishedFingerprint;
            _committed = true;
        }
        catch (Exception failure)
        {
            if (!movedOriginal)
            {
                // The original is still in place. A persisted prepared record is harmless;
                // recovery will verify all remaining copies before removing any of them.
                throw;
            }
            try
            {
                MacBundleRecovery.RequireExact(_recovery, _sourceFingerprint, _signer);
                if (MacBundleRecovery.Occupied(OriginalBundle))
                {
                    if (!published || MacBundleFiles.Fingerprint(OriginalBundle) != expectedPublishedFingerprint)
                        throw new IOException("Spotify changed at the destination. The external change was left untouched.");
                    _move(OriginalBundle, _failed);
                    MacBundleJournal.SyncDirectory(Path.GetDirectoryName(OriginalBundle)!);
                }
                _move(_recovery, OriginalBundle);
                MacBundleJournal.SyncDirectory(Path.GetDirectoryName(OriginalBundle)!);
                MacBundleRecovery.RequireExact(OriginalBundle, _sourceFingerprint, _signer);
                // If writing the committed flag failed after its atomic replacement, reset
                // it before cleanup so the on-disk record agrees with this verified rollback.
                _journal = _journal with { Committed = false };
                _journal.Write();
                var cleanup = MacBundleRecovery.RecoverLocked(_journal, _signer);
                if (cleanup.NeedsAttention)
                    throw new IOException(cleanup.Message);
                _journal = null;
            }
            catch (Exception rollback)
            {
                if (!Directory.Exists(_recovery) && Directory.Exists(OriginalBundle))
                {
                    try
                    {
                        if (MacBundleFiles.Fingerprint(OriginalBundle) == _sourceFingerprint)
                            MacBundleFiles.Copy(OriginalBundle, _recovery);
                    }
                    catch (Exception copyError) when (copyError is IOException or UnauthorizedAccessException) { }
                }
                RetainedRecoveryBundle = Directory.Exists(_recovery) ? _recovery : OriginalBundle;
                throw new IOException("Spotify replacement failed and automatic recovery could not be verified. " +
                    "The recovery app is retained at " + RetainedRecoveryBundle + ". " + rollback.Message, failure);
            }
            throw new IOException("Spotify replacement failed. The previous app was restored and its signature verified. " + failure.Message, failure);
        }
        finally
        {
            if (_committed)
            {
                var cleanup = MacBundleRecovery.RecoverLocked(_journal!, _signer);
                if (cleanup.NeedsAttention)
                {
                    RetainedRecoveryBundle = Directory.Exists(_recovery) ? _recovery : OriginalBundle;
                    RetainedRecoveryRecord = _journal!.JournalPath;
                    RetentionMessage = cleanup.Message;
                }
                else
                {
                    RetainedRecoveryBundle = cleanup.RecoveryBundle;
                    RetainedRecoveryRecord = cleanup.RetainedRecord;
                    if (cleanup.RecoveryBundle is not null) RetentionMessage = cleanup.Message;
                    _journal = null;
                }
            }
        }
    }

    private static bool IsRunning(string bundle)
    {
        var executable = Path.Combine(bundle, "Contents", "MacOS", "Spotify");
        return MacBundleFiles.RunningProcessIds(executable).Length > 0;
    }

    private void ThrowIfFinished()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_finished) throw new InvalidOperationException("The Spotify bundle transaction has already finished.");
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        // A persisted transaction belongs to restart recovery, including its exact copies.
        // Do not erase evidence needed to recover an interrupted or externally changed app.
        if (_journal is null)
        {
            MacBundleFiles.TryDelete(WorkingBundle);
            if (RetainedRecoveryBundle is null) MacBundleFiles.TryDelete(_failed);
        }
        _lease.Dispose();
    }
}

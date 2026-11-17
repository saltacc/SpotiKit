using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace SpotiKit.Services;

// Written before either application rename. Recovery derives every sibling path from this ID;
// a record cannot redirect cleanup or restoration to arbitrary paths supplied in JSON.
internal sealed record MacBundleJournal(
    int FormatVersion,
    string TransactionId,
    string OriginalBundle,
    string SourceFingerprint,
    string WorkingFingerprint,
    bool Committed = false)
{
    internal const string SearchPattern = ".spotikit-transaction-*.json";
    internal string Parent => Path.GetDirectoryName(OriginalBundle)!;
    internal string JournalPath => Path.Combine(Parent, ".spotikit-transaction-" + TransactionId + ".json");
    internal string RetainedPath => Path.Combine(Parent, ".spotikit-retained-transaction-" + TransactionId + ".json");
    private string BundleName => Path.GetFileNameWithoutExtension(OriginalBundle) + "-" + TransactionId + ".app";
    internal string WorkingBundle => Path.Combine(Parent, ".spotikit-stage-" + BundleName);
    internal string RecoveryBundle => Path.Combine(Parent, ".spotikit-recovery-" + BundleName);
    internal string FailedBundle => Path.Combine(Parent, ".spotikit-failed-" + BundleName);

    internal static string CanonicalTarget(string bundle)
    {
        bundle = MacBundleFiles.RequireBundle(bundle, mustExist: false);
        return Path.Combine(MacBundleFiles.CanonicalPath(Path.GetDirectoryName(bundle)!), Path.GetFileName(bundle));
    }

    internal void Write()
    {
        if (!ValidAt(JournalPath)) throw new InvalidDataException("SpotiKit's recovery record is invalid.");
        if (new FileInfo(JournalPath).LinkTarget is not null)
            throw new IOException("SpotiKit's recovery record is a symbolic link. The app was left untouched.");
        var temporary = JournalPath + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            var options = new FileStreamOptions
            {
                Mode = FileMode.CreateNew,
                Access = FileAccess.Write,
                Share = FileShare.None,
                Options = FileOptions.WriteThrough,
            };
            if (OperatingSystem.IsMacOS())
                options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            using (var stream = new FileStream(temporary, options))
            {
                JsonSerializer.Serialize(stream, this, MacBundleJournalJsonContext.Default.MacBundleJournal);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporary, JournalPath, overwrite: true);
            SyncDirectory(Parent);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    internal void Delete()
    {
        // Re-read the record before deleting it; never remove a substituted journal.
        if (Read(JournalPath) != this)
            throw new IOException("SpotiKit's recovery record changed. It has been retained for inspection.");
        File.Delete(JournalPath);
        SyncDirectory(Parent);
    }

    internal void Retire()
    {
        if (!Committed || Read(JournalPath) != this)
            throw new IOException("Only a matching committed recovery record can be retained as a completed transaction.");
        File.Move(JournalPath, RetainedPath, overwrite: false);
        SyncDirectory(Parent);
    }

    internal static MacBundleJournal? Read(string path)
    {
        if (new FileInfo(path).LinkTarget is not null) return null;
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > 16_384) return null;
        var journal = JsonSerializer.Deserialize(stream, MacBundleJournalJsonContext.Default.MacBundleJournal);
        return journal?.ValidAt(path) == true ? journal : null;
    }

    private bool ValidAt(string path) => FormatVersion == 1 &&
        Guid.TryParseExact(TransactionId, "N", out _) &&
        IsFingerprint(SourceFingerprint) && IsFingerprint(WorkingFingerprint) &&
        Path.IsPathFullyQualified(OriginalBundle) &&
        OriginalBundle == CanonicalTarget(OriginalBundle) &&
        Path.Combine(MacBundleFiles.CanonicalPath(Path.GetDirectoryName(Path.GetFullPath(path))!), Path.GetFileName(path)) == JournalPath;

    private static bool IsFingerprint(string value) => value is { Length: 64 } &&
        value.All(character => character is >= '0' and <= '9' or >= 'A' and <= 'F');

    internal static void SyncDirectory(string directory)
    {
        // O_CLOEXEC. A directory fsync makes the journal/rename durable before the next step.
        var descriptor = Open(directory, 0x1000000);
        if (descriptor < 0) throw new IOException("SpotiKit could not open the application folder to save recovery information.");
        try
        {
            if (Fsync(descriptor) != 0)
                throw new IOException("SpotiKit could not flush the application folder's recovery information.");
        }
        finally { Close(descriptor); }
    }

    [DllImport("/usr/lib/libSystem.B.dylib", EntryPoint = "open", SetLastError = true)]
    private static extern int Open([MarshalAs(UnmanagedType.LPUTF8Str)] string path, int flags);

    [DllImport("/usr/lib/libSystem.B.dylib", EntryPoint = "fsync", SetLastError = true)]
    private static extern int Fsync(int descriptor);

    [DllImport("/usr/lib/libSystem.B.dylib", EntryPoint = "close")]
    private static extern int Close(int descriptor);
}

[JsonSourceGenerationOptions(WriteIndented = true)]
[JsonSerializable(typeof(MacBundleJournal))]
internal partial class MacBundleJournalJsonContext : JsonSerializerContext;

using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace SpotiKit.Services;

// A persistent lock file is intentional: unlinking it can let two processes lock different inodes.
internal sealed class MacBundleLock : IDisposable
{
    private readonly FileStream _stream;

    private MacBundleLock(FileStream stream) => _stream = stream;

    internal static MacBundleLock Acquire(string bundle)
    {
        MacBundleFiles.RequireMacOS();
        var canonical = MacBundleJournal.CanonicalTarget(bundle);
        var id = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
        var path = Path.Combine(Path.GetDirectoryName(canonical)!, ".spotikit-lock-" + id + ".lock");
        if (new FileInfo(path).LinkTarget is not null)
            throw new IOException("SpotiKit's application lock is a symbolic link. The app was left untouched.");
        var options = new FileStreamOptions
        {
            Mode = FileMode.OpenOrCreate,
            Access = FileAccess.ReadWrite,
            // No FileShare.Inheritable: the runtime opens this descriptor close-on-exec.
            Share = FileShare.ReadWrite,
        };
        if (OperatingSystem.IsMacOS())
            options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        var stream = new FileStream(path, options);
        try
        {
            var descriptor = stream.SafeFileHandle.DangerousGetHandle().ToInt32();
            if (Flock(descriptor, 2 | 4) != 0) // LOCK_EX | LOCK_NB
                throw new IOException("Another SpotiKit process is changing this Spotify app. Close the other operation and retry.");
            return new MacBundleLock(stream);
        }
        catch
        {
            stream.Dispose();
            throw;
        }
    }

    public void Dispose() => _stream.Dispose();

    [DllImport("/usr/lib/libSystem.B.dylib", EntryPoint = "flock", SetLastError = true)]
    private static extern int Flock(int descriptor, int operation);
}

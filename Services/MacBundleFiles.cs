using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using SpotiKit.Models;

namespace SpotiKit.Services;

public static class MacBundleFiles
{
    [DllImport("/usr/lib/libproc.dylib", EntryPoint = "proc_pidpath", CallingConvention = CallingConvention.Cdecl)]
    private static extern int ProcPidPath(int pid, byte[] buffer, uint size);

    [DllImport("/usr/lib/libSystem.B.dylib", EntryPoint = "realpath", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr RealPath([MarshalAs(UnmanagedType.LPUTF8Str)] string path, IntPtr resolved);

    [DllImport("/usr/lib/libSystem.B.dylib", EntryPoint = "free", CallingConvention = CallingConvention.Cdecl)]
    private static extern void Free(IntPtr pointer);

    public static string CanonicalPath(string path)
    {
        RequireMacOS();
        var full = Path.GetFullPath(path);
        var resolved = RealPath(full, IntPtr.Zero);
        if (resolved == IntPtr.Zero) return full.Normalize(NormalizationForm.FormC);
        try { return (Marshal.PtrToStringUTF8(resolved) ?? full).Normalize(NormalizationForm.FormC); }
        finally { Free(resolved); }
    }

    public static string? ProcessExecutablePath(int pid)
    {
        RequireMacOS();
        var buffer = new byte[4096];
        var length = ProcPidPath(pid, buffer, (uint)buffer.Length);
        if (length <= 0) return null;
        var end = Array.IndexOf(buffer, (byte)0);
        return Encoding.UTF8.GetString(buffer, 0, end >= 0 ? end : Math.Min(length, buffer.Length));
    }

    public static int[] RunningProcessIds(string executable)
    {
        RequireMacOS();
        var expected = CanonicalPath(executable);
        var ids = new List<int>();
        foreach (var process in Process.GetProcesses())
            using (process)
            {
                try
                {
                    var path = ProcessExecutablePath(process.Id);
                    if (path is not null && path.Normalize(NormalizationForm.FormC) == expected)
                        ids.Add(process.Id);
                }
                catch (InvalidOperationException) { }
            }
        return ids.ToArray();
    }

    public static bool IsComplete(SpotifyInstallation client) =>
        client.InstallPath is { } resources && MacApplicationBundle.FromResources(resources) is { } bundle && IsComplete(bundle);

    public static bool IsComplete(string bundle)
    {
        if (!Directory.Exists(bundle) || new DirectoryInfo(bundle).LinkTarget is not null) return false;
        var critical = new[] { "Contents", "Contents/MacOS", "Contents/Resources", "Contents/Resources/Apps",
            "Contents/Info.plist", "Contents/MacOS/Spotify", "Contents/Resources/Apps/xpui.spa", "Contents/_CodeSignature",
            "Contents/_CodeSignature/CodeResources" };
        foreach (var relative in critical)
        {
            var path = Path.Combine(bundle, relative);
            if (new FileInfo(path).LinkTarget is not null) return false;
        }
        return File.Exists(Path.Combine(bundle, "Contents", "Info.plist")) &&
            File.Exists(Path.Combine(bundle, "Contents", "MacOS", "Spotify")) &&
            File.Exists(Path.Combine(bundle, "Contents", "Resources", "Apps", "xpui.spa")) &&
            (File.Exists(Path.Combine(bundle, "Contents", "Frameworks", "Chromium Embedded Framework.framework", "Chromium Embedded Framework")) ||
             File.Exists(Path.Combine(bundle, "Contents", "Frameworks", "Chromium Embedded Framework.framework", "Versions", "A", "Chromium Embedded Framework")));
    }

    public static void Copy(string source, string destination)
    {
        RequireMacOS();
        source = RequireBundle(source);
        destination = RequireBundle(destination, mustExist: false);
        if (destination.Equals(source, StringComparison.Ordinal) || destination.StartsWith(source + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new IOException("A Spotify bundle cannot be copied into itself.");
        if (Directory.Exists(destination) || File.Exists(destination))
            throw new IOException("The destination for the Spotify bundle copy already exists.");
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        try
        {
            Run("/usr/bin/ditto", source, destination).EnsureSuccess("Spotify's complete bundle could not be copied");
        }
        catch
        {
            TryDelete(destination);
            throw;
        }
    }

    public static long Size(string bundle) => Entries(bundle).Where(entry => entry.Kind == 'F')
        .Sum(entry => new FileInfo(entry.FullPath).Length);

    // Contents and permissions, including symlink targets, detect changes while a copy is staged.
    public static string Fingerprint(string bundle)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var entry in Entries(bundle).OrderBy(entry => entry.RelativePath, StringComparer.Ordinal))
        {
            var identity = entry.Kind == 'F' ? FileHash.Sha256(entry.FullPath) : entry.Target ?? "";
            var mode = OperatingSystem.IsMacOS() && entry.Kind != 'L'
                ? ((int)File.GetUnixFileMode(entry.FullPath)).ToString(System.Globalization.CultureInfo.InvariantCulture) : "";
            hash.AppendData(Encoding.UTF8.GetBytes(entry.Kind + "\0" + entry.RelativePath + "\0" + mode + "\0" + identity + "\n"));
        }
        return Convert.ToHexString(hash.GetHashAndReset());
    }

    private static IEnumerable<BundleEntry> Entries(string bundle)
    {
        bundle = RequireBundle(bundle);
        var pending = new Stack<string>();
        pending.Push(bundle);
        while (pending.TryPop(out var directory))
            foreach (var path in Directory.EnumerateFileSystemEntries(directory))
            {
                var attributes = File.GetAttributes(path);
                var relative = Path.GetRelativePath(bundle, path).Replace(Path.DirectorySeparatorChar, '/');
                var isDirectory = (attributes & FileAttributes.Directory) != 0;
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                {
                    FileSystemInfo info = isDirectory ? new DirectoryInfo(path) : new FileInfo(path);
                    yield return new(relative, path, 'L', info.LinkTarget);
                }
                else if (isDirectory)
                {
                    yield return new(relative, path, 'D', null);
                    pending.Push(path);
                }
                else yield return new(relative, path, 'F', null);
            }
    }

    internal static string RequireBundle(string path, bool mustExist = true)
    {
        path = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
        if (!path.EndsWith(".app", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Choose a complete .app bundle.", nameof(path));
        var info = new DirectoryInfo(path);
        if (info.LinkTarget is not null)
            throw new IOException("Choose the actual Spotify app, rather than a symbolic link to it.");
        if (mustExist && !info.Exists)
            throw new DirectoryNotFoundException("The Spotify application bundle was not found.");
        return path;
    }

    internal static void RequireMacOS()
    {
        if (!OperatingSystem.IsMacOS())
            throw new PlatformNotSupportedException("Spotify bundle operations require macOS.");
    }

    internal static NativeResult Run(string executable, params string[] arguments)
    {
        var start = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new IOException("A macOS application tool could not start.");
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(60_000))
        {
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            throw new TimeoutException("A macOS application tool did not finish within one minute.");
        }
        return new(process.ExitCode, output.GetAwaiter().GetResult(), error.GetAwaiter().GetResult());
    }

    internal static void TryDelete(string path)
    {
        try { if (Directory.Exists(path)) Directory.Delete(path, recursive: true); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    private sealed record BundleEntry(string RelativePath, string FullPath, char Kind, string? Target);
    internal sealed record NativeResult(int ExitCode, string Output, string Error)
    {
        public void EnsureSuccess(string operation)
        {
            if (ExitCode != 0) throw new IOException(operation + ": " + Error.Trim());
        }
    }
}

using System;
using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using SpotiKit.Models;

namespace SpotiKit.Services;

internal static class SpotifyBuildDetector
{
    private static readonly ConcurrentDictionary<string, (long Length, long Modified, string Hash)> Hashes = new();

    public static SpotifyBuildIdentity Read(string resources, string? executable, string? archive, bool fresh = false)
    {
        var bundle = MacApplicationBundle.FromResources(resources);
        var platform = bundle is not null ? "macos" : executable?.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) == true
            ? "windows" : "linux";
        var architecture = bundle is not null && executable is not null ? MachArchitecture(executable) : "unknown";
        if (architecture.Contains(','))
        {
            var slices = architecture.Split(',');
            // open -a chooses the native OS slice even if SpotiKit runs under Rosetta.
            var host = RuntimeInformation.OSArchitecture.ToString().ToLowerInvariant();
            architecture = slices.Contains(host, StringComparer.Ordinal) ? host : slices[0];
        }
        string? snapshot = null;
        if (bundle is not null)
        {
            var root = Path.Combine(bundle, "Contents", "Frameworks", "Chromium Embedded Framework.framework", "Resources");
            if (!Directory.Exists(root))
                root = Path.Combine(bundle, "Contents", "Frameworks", "Chromium Embedded Framework.framework", "Versions", "A", "Resources");
            if (Directory.Exists(root))
            {
                var candidates = Directory.GetFiles(root, "v8_context_snapshot*.bin").Order(StringComparer.Ordinal).ToArray();
                var file = candidates.FirstOrDefault(p => Path.GetFileName(p).Contains(architecture, StringComparison.Ordinal) ||
                    architecture == "x64" && Path.GetFileName(p).Contains("x86_64", StringComparison.Ordinal))
                    ?? (candidates.Length == 1 ? candidates[0] : null);
                if (file is not null) snapshot = CachedHash(file, FileHash.Sha256, fresh);
            }
        }
        var fingerprint = archive is not null ? CachedHash(archive, XpuiPatcher.ResourceFingerprint, fresh) : null;
        return new(platform, architecture, fingerprint, snapshot);
    }

    private static string? CachedHash(string path, Func<string, string> hash, bool fresh)
    {
        try
        {
            var info = new FileInfo(path);
            if (!fresh && Hashes.TryGetValue(path, out var saved) && saved.Length == info.Length && saved.Modified == info.LastWriteTimeUtc.Ticks)
                return saved.Hash;
            var value = hash(path);
            Hashes[path] = (info.Length, info.LastWriteTimeUtc.Ticks, value);
            return value;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException) { return null; }
    }

    internal static string MachArchitecture(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            Span<byte> bytes = stackalloc byte[4096];
            var count = stream.Read(bytes);
            if (count < 8) return "unknown";
            var magic = BinaryPrimitives.ReadUInt32BigEndian(bytes);
            static string Cpu(uint cpu) => cpu switch { 0x0100000c => "arm64", 0x01000007 => "x64", 12 => "arm", 7 => "x86", _ => "unknown" };
            if (magic is 0xcffaedfe or 0xcefaedfe) return Cpu(BinaryPrimitives.ReadUInt32LittleEndian(bytes[4..]));
            if (magic is 0xfeedfacf or 0xfeedface) return Cpu(BinaryPrimitives.ReadUInt32BigEndian(bytes[4..]));
            if (magic is 0xcafebabe or 0xcafebabf)
            {
                var n = BinaryPrimitives.ReadUInt32BigEndian(bytes[4..]);
                var size = magic == 0xcafebabf ? 32 : 20;
                if (n > 32 || 8 + n * size > count) return "unknown";
                var architectures = new string[n];
                for (var i = 0; i < n; i++) architectures[i] = Cpu(BinaryPrimitives.ReadUInt32BigEndian(bytes.Slice(8 + i * size)));
                return string.Join(",", architectures.Distinct().Order(StringComparer.Ordinal));
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        return "unknown";
    }
}

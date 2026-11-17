using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using SpotiKit.Models;

namespace SpotiKit.Services;

public enum DevToolsState
{
    NotFound,

    Unrecognized,
    Disabled,
    Enabled,
}

public sealed record DevToolsStatus(DevToolsState State, bool EnabledBySpotiKit, string Message);

public sealed partial class DevToolsService(SpotiKitPaths paths, SpotifyService spotify, StateStore state, ActivityLog log)
{
    private const string Operation = "DevTools";
    private const byte Developer = (byte)'2';
    private const byte Off = (byte)'0';

    private static readonly Encoding Bytes = Encoding.Latin1;

    [GeneratedRegex("<app-developer>([0-9])</app-developer>")]
    private static partial Regex XmlFlag();

    [GeneratedRegex(@"app-developer\x09\x01([0-9])x\x01")]
    private static partial Regex BinaryFlag();

    public string BnkPath => paths.SpotifyOfflineBnkPath;

    private string BackupDir => Path.Combine(paths.DataRoot, "DevTools");

    public DevToolsStatus GetStatus()
    {
        var record = state.Load().DevTools;
        if (!File.Exists(BnkPath))
            return new(DevToolsState.NotFound, record is not null,
                "Start Spotify and sign in once, then close it.");

        if (Locate(File.ReadAllBytes(BnkPath)) is not { } flags)
            return new(DevToolsState.Unrecognized, record is not null,
                "Not available for this Spotify version.");

        return flags.IsEnabled || record is not null
            ? new(DevToolsState.Enabled, record is not null, "Developer tools are on.")
            : new(DevToolsState.Disabled, record is not null, "Developer tools are off.");
    }

    public string Enable()
    {
        RequireClosed();
        var original = File.Exists(BnkPath)
            ? File.ReadAllBytes(BnkPath)
            : throw new FileNotFoundException("Start Spotify and sign in once, then close it.");
        var flags = Locate(original)
                    ?? throw new InvalidDataException("Not available for this Spotify version.");

        if (flags.IsEnabled)
            return "Developer tools are already on.";

        var backup = Backup(original);
        var patched = (byte[])original.Clone();
        patched[flags.XmlOffset] = Developer;
        patched[flags.BinaryOffset] = Developer;
        WriteSafely(patched, check => check.IsEnabled);

        state.Update(s => s with
        {
            DevTools = new DevToolsRecord(DateTimeOffset.Now, backup, (char)original[flags.XmlOffset],
                (char)original[flags.BinaryOffset], FileHash.Sha256(patched)),
        });
        log.Success(Operation, "Developer tools on. They show up the next time Spotify starts.");
        return "On. Start Spotify, then press Ctrl+Shift+I.";
    }

    public string Disable()
    {
        var record = state.Load().DevTools;
        if (record is null)
        {
            if (GetStatus().State != DevToolsState.Enabled)
                return "Developer tools are off.";

            RequireClosed();
            var content = File.ReadAllBytes(BnkPath);
            var found = Locate(content)!;
            var backup = Backup(content);
            var off = (byte[])content.Clone();
            off[found.BinaryOffset] = Off;
            WriteSafely(off, check => !check.IsEnabled);
            log.Success(Operation, "Developer tools off.");
            return "Off.";
        }

        RequireClosed();
        if (!File.Exists(BnkPath))
        {
            state.Update(s => s with { DevTools = null });
            log.Info(Operation, "offline.bnk no longer exists; nothing to undo.");
            return "offline.bnk no longer exists, so there was nothing to undo.";
        }

        var current = File.ReadAllBytes(BnkPath);
        if (FileHash.Sha256(current) == record.PatchedSha256 && File.Exists(record.BackupFile))
        {
            WriteSafely(File.ReadAllBytes(record.BackupFile), check => IsOriginal(check, record));
            log.Success(Operation, "Developer tools off.");
        }
        else
        {
            var flags = Locate(current)
                        ?? throw new InvalidDataException("offline.bnk changed so much that SpotiKit can't find the developer flag to undo it.");
            var restored = (byte[])current.Clone();
            restored[flags.XmlOffset] = (byte)record.OriginalXmlValue;
            restored[flags.BinaryOffset] = (byte)record.OriginalBinaryValue;
            WriteSafely(restored, check => IsOriginal(check, record));
            log.Success(Operation, "Developer tools off.");
        }

        state.Update(s => s with { DevTools = null });
        return "Off.";
    }

    public string? KeepOn()
    {
        if (state.Load().DevTools is not { } record || spotify.IsRunning() || !File.Exists(BnkPath))
            return null;
        var current = File.ReadAllBytes(BnkPath);
        if (Locate(current) is not { } flags || flags.IsEnabled)
            return null;

        var patched = (byte[])current.Clone();
        patched[flags.XmlOffset] = Developer;
        patched[flags.BinaryOffset] = Developer;
        WriteSafely(patched, check => check.IsEnabled);
        state.Update(s => s with { DevTools = record with { PatchedSha256 = FileHash.Sha256(patched) } });
        log.Info(Operation, "Spotify had turned the developer tools off. They're on again.");
        return "On again.";
    }

    private string Backup(byte[] content)
    {
        Directory.CreateDirectory(BackupDir);
        var backup = Path.Combine(BackupDir, $"offline.bnk.{DateTime.Now:yyyyMMdd-HHmmss}.bak");
        File.WriteAllBytes(backup, content);
        if (FileHash.Sha256(backup) != FileHash.Sha256(content))
            throw new IOException("The backup of offline.bnk did not match the original, so nothing was changed.");
        return backup;
    }

    private void RequireClosed()
    {
        if (spotify.IsRunning())
            throw new InvalidOperationException("Close Spotify first.");
    }

    private void WriteSafely(byte[] content, Func<Flags, bool> isValid)
    {
        var working = BnkPath + ".spotikit-tmp";
        File.WriteAllBytes(working, content);
        try
        {
            if (Locate(File.ReadAllBytes(working)) is not { } check || !isValid(check))
                throw new InvalidDataException("The changed copy of offline.bnk did not check out, so the original was left untouched.");
            File.Move(working, BnkPath, overwrite: true);
        }
        finally
        {
            if (File.Exists(working))
                File.Delete(working);
        }
    }

    private static bool IsOriginal(Flags flags, DevToolsRecord record) =>
        flags.XmlValue == record.OriginalXmlValue && flags.BinaryValue == record.OriginalBinaryValue;

    private sealed record Flags(int XmlOffset, char XmlValue, int BinaryOffset, char BinaryValue)
    {
        public bool IsEnabled => XmlValue == (char)Developer && BinaryValue == (char)Developer;
    }

    private static Flags? Locate(byte[] content)
    {
        var text = Bytes.GetString(content);
        var xml = XmlFlag().Matches(text);
        var binary = BinaryFlag().Matches(text);
        if (xml.Count != 1 || binary.Count != 1)
            return null;

        var x = xml[0].Groups[1];
        var b = binary[0].Groups[1];
        return new Flags(x.Index, x.Value[0], b.Index, b.Value[0]);
    }
}

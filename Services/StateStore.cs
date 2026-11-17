using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using SpotiKit.Models;

namespace SpotiKit.Services;

public sealed class StateStore(SpotiKitPaths paths)
{
    private static readonly object Gate = new();

    public SpotiKitState Load()
    {
        try
        {
            return Read();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return SpotiKitState.Empty;
        }
    }

    public void Save(SpotiKitState state)
    {
        lock (Gate)
        {
            Directory.CreateDirectory(paths.DataRoot);
            var temp = paths.StateFile + ".tmp";
            using (var stream = File.Create(temp))
                JsonSerializer.Serialize(stream, state, StateJsonContext.Default.SpotiKitState);
            File.Move(temp, paths.StateFile, overwrite: true);
        }
    }

    public void Update(Func<SpotiKitState, SpotiKitState> change)
    {
        lock (Gate)
            Save(change(Read()));
    }

    private SpotiKitState Read()
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                if (!File.Exists(paths.StateFile))
                    return SpotiKitState.Empty;
                using var stream = new FileStream(paths.StateFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                return JsonSerializer.Deserialize(stream, StateJsonContext.Default.SpotiKitState) ?? SpotiKitState.Empty;
            }
            catch (IOException) when (attempt < 10)
            {
                Thread.Sleep(50);
            }
            catch (JsonException)
            {
                File.Copy(paths.StateFile, paths.StateFile + ".broken", overwrite: true);
                return SpotiKitState.Empty;
            }
        }
    }
}

[JsonSourceGenerationOptions(WriteIndented = true, UseStringEnumConverter = true)]
[JsonSerializable(typeof(SpotiKitState))]
internal partial class StateJsonContext : JsonSerializerContext;

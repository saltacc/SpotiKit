using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using SpotiKit.Models;

namespace SpotiKit.Services;

public sealed class SettingsService(SpotiKitPaths paths)
{
    private string SettingsPath => paths.SettingsFile;

    public AppSettings Load()
    {
        try
        {
            if (File.Exists(SettingsPath))
            {
                var json = File.ReadAllText(SettingsPath);
                var settings = JsonSerializer.Deserialize(json, SettingsJsonContext.Default.AppSettings) ?? new AppSettings();
                var migrated = Migrate(settings);
                if (migrated || HasUnknownKeys(json))
                    Save(settings);
                return settings;
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
        }

        return new AppSettings { Version = AppSettings.CurrentVersion };
    }

    private static bool Migrate(AppSettings settings)
    {
        if (settings.Version >= AppSettings.CurrentVersion)
            return false;
        settings.UpdateMode = settings.Version >= 2 && settings.HoldUpdatesWhileInstalled == false
            ? SpotifyUpdateMode.All
            : SpotifyUpdateMode.Supported;
        settings.HoldUpdatesWhileInstalled = null;
        settings.Version = AppSettings.CurrentVersion;
        return true;
    }

    private static bool HasUnknownKeys(string json)
    {
        var known = SettingsJsonContext.Default.AppSettings.Properties.Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
        using var document = JsonDocument.Parse(json);
        return document.RootElement.ValueKind == JsonValueKind.Object &&
               document.RootElement.EnumerateObject().Any(p => !known.Contains(p.Name));
    }

    public void Save(AppSettings settings)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
            using var stream = File.Create(SettingsPath);
            JsonSerializer.Serialize(stream, settings, SettingsJsonContext.Default.AppSettings);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
        }
    }
}

[JsonSourceGenerationOptions(WriteIndented = true, UseStringEnumConverter = true)]
[JsonSerializable(typeof(AppSettings))]
internal partial class SettingsJsonContext : JsonSerializerContext;

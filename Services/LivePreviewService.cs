using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using SpotiKit.Models;

namespace SpotiKit.Services;

public sealed class LivePreviewService(SpotiKitPaths paths, AddonCatalog catalog, SpotifyService spotify, ActivityLog log, KitRunner kit) : IDisposable
{
    private static readonly HashSet<string> SourceTypes = new(StringComparer.OrdinalIgnoreCase) { ".ts", ".tsx", ".jsx", ".js", ".mjs" };
    private readonly Dictionary<string, DateTime> _justBuilt = new(StringComparer.OrdinalIgnoreCase);

    public const int Port = SpotifyPage.Port;
    private const string Operation = "Live preview";

    private static readonly HashSet<string> TextTypes = new(StringComparer.OrdinalIgnoreCase) { ".css", ".js", ".mjs", ".json", ".svg", ".txt" };

    private readonly Dictionary<string, CancellationTokenSource> _waiting = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _sent = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, HashSet<string>> _changed = new(StringComparer.OrdinalIgnoreCase);
    private readonly SemaphoreSlim _pushing = new(1, 1);
    private FileSystemWatcher? _watcher;

    public event Action<string>? Status;

    public bool IsRunning => _watcher is not null;

    public Task<bool> SpotifyListensAsync() => SpotifyPage.ListensAsync();

    public async Task StartAsync(SpotifyInstallation client, CancellationToken cancellationToken = default)
    {
        await SpotifyPage.OpenAsync(spotify, client, _ => Status?.Invoke("Restarting Spotify for live preview…"), cancellationToken);

        _sent.Clear();
        _watcher = new FileSystemWatcher(paths.AddonsRoot)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.Size,
        };
        _watcher.Changed += (_, e) => Schedule(e.FullPath);
        _watcher.Created += (_, e) => Schedule(e.FullPath);
        _watcher.Renamed += (_, e) => Schedule(e.FullPath);
        _watcher.EnableRaisingEvents = true;
        log.Info(Operation, "On. Saved changes show up in Spotify.");
        Status?.Invoke("On. Save a file in your project and it shows up in Spotify.");
    }

    public async Task StopAsync()
    {
        _watcher?.Dispose();
        _watcher = null;
        foreach (var wait in _waiting.Values)
            wait.Cancel();
        _waiting.Clear();
        try
        {
            if (_sent.Count > 0)
                await EvaluateAsync("SpotiKit._internal.dev.clear()");
        }
        catch (Exception ex) when (ex is HttpRequestException or WebSocketException or TaskCanceledException or InvalidOperationException)
        {
        }
        _sent.Clear();
        log.Info(Operation, "Off. Spotify shows the applied projects again.");
        Status?.Invoke("Off.");
    }

    private void Schedule(string changedPath)
    {
        var extension = Path.GetExtension(changedPath);
        if (!TextTypes.Contains(extension) && !SourceTypes.Contains(extension))
            return;
        if (changedPath.Split(Path.DirectorySeparatorChar).Contains("node_modules"))
            return;
        lock (_justBuilt)
            if (_justBuilt.TryGetValue(Path.GetFullPath(changedPath), out var at) && DateTime.UtcNow - at < TimeSpan.FromSeconds(2))
                return;
        var source = catalog.Sources().FirstOrDefault(s => s.IsFolder
            ? changedPath.StartsWith(s.FullPath + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            : string.Equals(changedPath, s.FullPath, StringComparison.OrdinalIgnoreCase));
        if (source is null)
            return;

        var key = source.Kind + ":" + source.Id;
        lock (_waiting)
        {
            var relative = source.IsFolder ? Path.GetRelativePath(source.FullPath, changedPath).Replace('\\', '/') : source.Id + ".js";
            (_changed.TryGetValue(key, out var set) ? set : _changed[key] = new(StringComparer.OrdinalIgnoreCase)).Add(relative);
            if (_waiting.TryGetValue(key, out var previous))
                previous.Cancel();
            var wait = new CancellationTokenSource();
            _waiting[key] = wait;
            _ = Task.Delay(250, wait.Token).ContinueWith(t =>
            {
                if (!t.IsCanceled)
                    _ = PushAsync(source, key);
            }, TaskScheduler.Default);
        }
    }

    private async Task PushAsync(AddonSource source, string key)
    {
        string[] changed;
        lock (_waiting)
        {
            changed = _changed.TryGetValue(key, out var set) ? set.ToArray() : [];
            _changed.Remove(key);
            _waiting.Remove(key);
        }

        await _pushing.WaitAsync();
        try
        {
            var files = new JsonObject();
            string name = source.Folder;
            string? main = null;
            if (source.IsFolder && await BuildIfNeededAsync(source, changed) is { } builtMain)
                changed = changed.Append(builtMain).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            else if (source.IsFolder && _buildFailed)
                return;
            if (source.IsFolder)
            {
                var all = !_sent.Contains(key);
                foreach (var (relative, path) in AddonCatalog.FilesOf(source.FullPath))
                    if (TextTypes.Contains(Path.GetExtension(path)) && (all || changed.Contains(relative, StringComparer.OrdinalIgnoreCase)))
                        files[relative] = await ReadTextAsync(path);
                var manifestPath = Path.Combine(source.FullPath, AddonCatalog.ManifestFile);
                if (File.Exists(manifestPath))
                {
                    try
                    {
                        using var json = JsonDocument.Parse(await ReadTextAsync(manifestPath));
                        name = AddonCatalog.ReadName(json.RootElement) is { Length: > 0 } n ? n : name;
                        main = json.RootElement.TryGetProperty("main", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;
                    }
                    catch (JsonException)
                    {
                        Status?.Invoke($"{source.Folder}: spotikit.json isn't valid JSON yet.");
                        return;
                    }
                }
            }
            else
                files[source.Id + ".js"] = await ReadTextAsync(source.FullPath);

            var update = new JsonObject
            {
                ["kind"] = source.Kind,
                ["id"] = source.Id,
                ["name"] = name,
                ["folder"] = source.IsFolder,
                ["path"] = source.Kind == "extension"
                    ? source.IsFolder ? $"{source.Id}/{main ?? "extension.js"}" : source.Id + ".js"
                    : null,
                ["files"] = files,
                ["changed"] = new JsonArray(changed.Select(c => (JsonNode?)c).ToArray()),
            };
            var result = await EvaluateAsync($"SpotiKit._internal.dev.push({update.ToJsonString()})");
            _sent.Add(key);
            var what = string.Join(", ", changed.Take(3));
            Status?.Invoke(result switch
            {
                "css" => $"{name}: {what} updated in Spotify.",
                "reload" => $"{name}: {what} changed, Spotify reloaded.",
                "restarted" => $"{name}: {what} restarted in Spotify.",
                _ => $"{name}: {what} shown in Spotify.",
            });
        }
        catch (Exception ex) when (ex is HttpRequestException or WebSocketException or TaskCanceledException or IOException
                                       or InvalidOperationException or JsonException)
        {
            Status?.Invoke($"Couldn't reach Spotify: {ex.Message}");
        }
        finally
        {
            _pushing.Release();
        }
    }

    private bool _buildFailed;

    private async Task<string?> BuildIfNeededAsync(AddonSource source, string[] changed)
    {
        _buildFailed = false;
        string? sourceFile = null, main = null;
        try
        {
            using var json = JsonDocument.Parse(await ReadTextAsync(Path.Combine(source.FullPath, AddonCatalog.ManifestFile)));
            if (json.RootElement.ValueKind == JsonValueKind.Object)
            {
                sourceFile = json.RootElement.TryGetProperty("source", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : null;
                main = json.RootElement.TryGetProperty("main", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;
            }
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            return null;
        }
        if (sourceFile is null || main is null)
            return null;
        var mainPath = Path.GetFullPath(Path.Combine(source.FullPath, main));
        var sourceChanged = changed.Any(c => SourceTypes.Contains(Path.GetExtension(c)) && !string.Equals(c, main, StringComparison.OrdinalIgnoreCase));
        if (!sourceChanged && File.Exists(mainPath))
            return null;
        try
        {
            Status?.Invoke($"{source.Folder}: building…");
            await kit.BuildAsync(source.FullPath);
            lock (_justBuilt)
                _justBuilt[mainPath] = DateTime.UtcNow;
            return main;
        }
        catch (Exception ex) when (ex is InvalidOperationException or TimeoutException or IOException or System.ComponentModel.Win32Exception)
        {
            _buildFailed = true;
            Status?.Invoke($"{source.Folder}: {ex.Message}");
            return null;
        }
    }

    private static async Task<string> ReadTextAsync(string path)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var reader = new StreamReader(stream, Encoding.UTF8);
                return await reader.ReadToEndAsync();
            }
            catch (IOException) when (attempt < 8)
            {
                await Task.Delay(60);
            }
        }
    }

    private static Task<string?> EvaluateAsync(string expression) => SpotifyPage.EvaluateAsync(expression);

    public void Dispose()
    {
        _watcher?.Dispose();
    }
}

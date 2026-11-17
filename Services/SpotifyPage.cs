using System;
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

public static class SpotifyPage
{
    public const int Port = 9229;

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(3) };

    public static async Task<bool> ListensAsync()
    {
        try
        {
            return await SocketUrlAsync() is not null;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            return false;
        }
    }

    public static async Task OpenAsync(SpotifyService spotify, SpotifyInstallation client, Action<string>? status,
        CancellationToken cancellationToken = default)
    {
        if (await ListensAsync())
            return;
        status?.Invoke("Restarting Spotify…");
        if (spotify.IsRunning() && !await spotify.CloseAsync(TimeSpan.FromSeconds(5), cancellationToken))
            throw new InvalidOperationException($"Spotify didn't close. {SpotifyService.QuitHint}");
        spotify.Launch(client, $"--remote-debugging-port={Port}");
        var deadline = DateTime.UtcNow.AddSeconds(40);
        while (!await ListensAsync())
        {
            if (DateTime.UtcNow > deadline)
                throw new TimeoutException("Spotify didn't open. Start it again and retry.");
            await Task.Delay(500, cancellationToken);
        }
    }

    public static async Task<string?> EvaluateAsync(string expression)
    {
        var url = await SocketUrlAsync() ?? throw new InvalidOperationException("Spotify isn't open with the DevTools port.");
        using var socket = new ClientWebSocket();
        socket.Options.KeepAliveInterval = TimeSpan.Zero;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await socket.ConnectAsync(new Uri(url), timeout.Token);
        var request = new JsonObject
        {
            ["id"] = 1,
            ["method"] = "Runtime.evaluate",
            ["params"] = new JsonObject { ["expression"] = expression, ["awaitPromise"] = true, ["returnByValue"] = true },
        };
        await socket.SendAsync(Encoding.UTF8.GetBytes(request.ToJsonString()), WebSocketMessageType.Text, true, timeout.Token);

        var buffer = new byte[64 * 1024];
        while (true)
        {
            using var message = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, timeout.Token);
                message.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);

            var reply = JsonNode.Parse(message.ToArray());
            if ((int?)reply?["id"] != 1)
                continue;
            if (reply?["result"]?["exceptionDetails"] is { } error)
                throw new InvalidOperationException((string?)error["exception"]?["description"] ?? (string?)error["text"] ?? "Spotify reported an error.");
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
            return reply?["result"]?["result"]?["value"]?.ToString();
        }
    }

    private static async Task<string?> SocketUrlAsync()
    {
        var list = JsonNode.Parse(await Http.GetStringAsync($"http://127.0.0.1:{Port}/json/list"))?.AsArray();
        return list?.FirstOrDefault(t => (string?)t?["type"] == "page" && ((string?)t?["url"])?.Contains("xpui") == true)?["webSocketDebuggerUrl"]
            ?.GetValue<string>();
    }
}

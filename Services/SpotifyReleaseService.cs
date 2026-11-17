using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using SpotiKit.Models;

namespace SpotiKit.Services;

public sealed partial class SpotifyReleaseService(HttpClient? http = null)
{
    private const long HeaderBytes = 4 * 1024 * 1024;

    private readonly HttpClient _http = http ?? SpotiKitRepository.Http;

    [GeneratedRegex(@"^\d+\.\d+\.\d+\.\d+")]
    private static partial Regex Numbers();

    public static string SetupUrl => RuntimeInformation.OSArchitecture == Architecture.Arm64
        ? "https://download.scdn.co/SpotifyFullSetupARM64.exe"
        : "https://download.scdn.co/SpotifyFullSetupX64.exe";

    public async Task<LatestSpotifyRecord> LatestAsync(LatestSpotifyRecord? known, CancellationToken cancellationToken = default)
    {
        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException("Spotify release checks through the Windows installer are not available on this platform.");
        using (var head = await _http.SendAsync(new HttpRequestMessage(HttpMethod.Head, SetupUrl), cancellationToken))
        {
            head.EnsureSuccessStatusCode();
            var etag = head.Headers.ETag?.Tag;
            if (known is not null && etag is not null && etag == known.ETag)
                return known with { CheckedAt = DateTimeOffset.Now };
        }

        var request = new HttpRequestMessage(HttpMethod.Get, SetupUrl);
        request.Headers.Range = new RangeHeaderValue(0, HeaderBytes - 1);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        var temp = Path.Combine(Path.GetTempPath(), $"spotikit-spotify-{Guid.NewGuid():N}.exe");
        try
        {
            await using (var file = File.Create(temp))
            await using (var body = await response.Content.ReadAsStreamAsync(cancellationToken))
            {
                var buffer = new byte[81920];
                long total = 0;
                int read;
                while (total < HeaderBytes && (read = await body.ReadAsync(buffer, cancellationToken)) > 0)
                {
                    await file.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                    total += read;
                }
            }

            var version = ReadVersion(temp) ?? throw new InvalidDataException("Spotify's installer didn't say its version.");
            return new LatestSpotifyRecord(version, response.Headers.ETag?.Tag, DateTimeOffset.Now);
        }
        finally
        {
            try
            {
                File.Delete(temp);
            }
            catch (IOException)
            {
            }
        }
    }

    public static string? ReadVersion(string installer)
    {
        var info = FileVersionInfo.GetVersionInfo(installer);
        var match = Numbers().Match(info.ProductVersion ?? "");
        if (!match.Success)
            match = Numbers().Match(info.FileVersion ?? "");
        return match.Success && match.Value != "0.0.0.0" ? match.Value : null;
    }
}

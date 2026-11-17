using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace SpotiKit.Services;

public sealed record AppRelease(
    string Version,
    DateTimeOffset Published,
    string? Notes,
    string PageUrl,
    string DownloadUrl,
    long Size,
    string ChecksumUrl);

public sealed record AppUpdateCheck(AppRelease? Latest, bool IsNewer, DateTimeOffset CheckedAt);

public sealed class AppUpdateService
{
    public const string AssetName = "SpotiKit.exe";
    public const string ChecksumAssetName = AssetName + ".sha256";

    private readonly HttpClient _http;
    private readonly Func<CancellationToken, Task<HttpResponseMessage>> _latest;

    public AppUpdateService(string currentVersion, string? exePath, bool isSingleFile, HttpClient? http = null)
    {
        CurrentVersion = currentVersion;
        ExePath = exePath;
        IsSingleFile = isSingleFile;
        _http = http ?? SpotiKitRepository.Http;
        _latest = ct =>
        {
            var request = new HttpRequestMessage(HttpMethod.Get, SpotiKitRepository.LatestReleaseApi);
            request.Headers.Accept.ParseAdd("application/vnd.github+json");
            return _http.SendAsync(request, ct);
        };
    }

    public static AppUpdateService ForThisApp() =>
#pragma warning disable IL3000
        new(AppInfo.Version, Environment.ProcessPath, string.IsNullOrEmpty(typeof(AppUpdateService).Assembly.Location));
#pragma warning restore IL3000

    public string CurrentVersion { get; }
    public string? ExePath { get; }
    public bool IsSingleFile { get; }

    public string? CannotUpdateReason =>
        !IsSingleFile ? "This is a development build. Get the new version from GitHub."
        : ExePath is null ? "The location of SpotiKit.exe is unknown."
        : null;

    public async Task<AppUpdateCheck> CheckAsync(CancellationToken cancellationToken = default)
    {
        using var response = await _latest(cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound)
            return new AppUpdateCheck(null, false, DateTimeOffset.Now);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException(response.StatusCode == HttpStatusCode.Forbidden
                ? "GitHub limits how often it can be asked. Try again in an hour."
                : $"GitHub answered {(int)response.StatusCode} {response.ReasonPhrase}.");

        var release = ParseRelease(await response.Content.ReadAsStringAsync(cancellationToken));
        var newer = release is not null && IsNewer(release.Version, CurrentVersion);
        return new AppUpdateCheck(release, newer, DateTimeOffset.Now);
    }

    public static bool IsNewer(string candidate, string current) =>
        SemanticVersion.TryParse(candidate, out var a) && SemanticVersion.TryParse(current, out var b) && a > b;

    internal static AppRelease? ParseRelease(string json)
    {
        var release = JsonSerializer.Deserialize(json, GitHubJsonContext.Default.GitHubRelease);
        if (release is null || release.Draft || release.Prerelease || string.IsNullOrWhiteSpace(release.TagName))
            return null;

        var version = release.TagName.TrimStart('v', 'V');
        if (!SemanticVersion.TryParse(version, out _))
            return null;

        var exe = release.Assets?.FirstOrDefault(a => string.Equals(a.Name, AssetName, StringComparison.OrdinalIgnoreCase));
        var sum = release.Assets?.FirstOrDefault(a => string.Equals(a.Name, ChecksumAssetName, StringComparison.OrdinalIgnoreCase));
        if (exe?.BrowserDownloadUrl is null || sum?.BrowserDownloadUrl is null)
            return null;

        return new AppRelease(version, release.PublishedAt ?? DateTimeOffset.MinValue, release.Body?.Trim(),
            release.HtmlUrl ?? SpotiKitRepository.ReleasesPage, exe.BrowserDownloadUrl, exe.Size, sum.BrowserDownloadUrl);
    }

    public async Task<string> DownloadAsync(AppRelease release, IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        if (CannotUpdateReason is { } reason)
            throw new InvalidOperationException(reason);

        var expected = ParseChecksum(await _http.GetStringAsync(release.ChecksumUrl, cancellationToken));
        var target = ExePath + ".download";

        try
        {
            using (var response = await _http.GetAsync(release.DownloadUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken))
            {
                response.EnsureSuccessStatusCode();
                var total = response.Content.Headers.ContentLength ?? release.Size;
                await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
                await using var file = File.Create(target);
                var buffer = new byte[81920];
                long done = 0;
                int read;
                while ((read = await source.ReadAsync(buffer, cancellationToken)) > 0)
                {
                    await file.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                    done += read;
                    if (total > 0)
                        progress?.Report(Math.Min(1, done / (double)total));
                }
            }

            string actual;
            await using (var check = File.OpenRead(target))
                actual = Convert.ToHexString(await SHA256.HashDataAsync(check, cancellationToken));
            if (!string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("The download was damaged. Try again.");
            return target;
        }
        catch
        {
            TryDelete(target);
            throw;
        }
    }

    public void Replace(string downloaded)
    {
        if (CannotUpdateReason is { } reason)
            throw new InvalidOperationException(reason);

        var current = ExePath!;
        var old = current + ".old";
        TryDelete(old);
        // Windows lets a running exe be renamed, not overwritten.
        File.Move(current, old);
        try
        {
            File.Move(downloaded, current);
        }
        catch
        {
            File.Move(old, current);
            throw;
        }
        if (OperatingSystem.IsWindows())
            WindowsIntegration.RefreshItem(current);
    }

    public void StartNewVersion() => Process.Start(new ProcessStartInfo(ExePath!) { UseShellExecute = false });

    public static async Task CleanUpAsync(string? exePath)
    {
        if (exePath is null)
            return;
        foreach (var leftover in new[] { exePath + ".old", exePath + ".download" })
        {
            for (var attempt = 0; attempt < 20 && File.Exists(leftover); attempt++)
            {
                if (TryDelete(leftover))
                    break;
                await Task.Delay(500);
            }
        }
    }

    internal static string ParseChecksum(string text)
    {
        var hash = text.Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
        if (hash.Length != 64 || !hash.All(Uri.IsHexDigit))
            throw new InvalidDataException("This release is incomplete. Try again later.");
        return hash;
    }

    private static bool TryDelete(string path)
    {
        try
        {
            File.Delete(path);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }
}

internal sealed record GitHubAsset(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("size")] long Size,
    [property: JsonPropertyName("browser_download_url")] string? BrowserDownloadUrl);

internal sealed record GitHubRelease(
    [property: JsonPropertyName("tag_name")] string? TagName,
    [property: JsonPropertyName("body")] string? Body,
    [property: JsonPropertyName("html_url")] string? HtmlUrl,
    [property: JsonPropertyName("published_at")] DateTimeOffset? PublishedAt,
    [property: JsonPropertyName("draft")] bool Draft,
    [property: JsonPropertyName("prerelease")] bool Prerelease,
    [property: JsonPropertyName("assets")] GitHubAsset[]? Assets);

[JsonSerializable(typeof(GitHubRelease))]
internal partial class GitHubJsonContext : JsonSerializerContext;

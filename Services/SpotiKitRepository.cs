using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;

namespace SpotiKit.Services;

public static class SpotiKitRepository
{
    public const string Owner = "NMWplays";
    public const string Name = "SpotiKit";
    public const string Branch = "main";

    public static string VersionListUrl => RawFile("compatibility/spotify-versions.json");

    public static string LatestReleaseApi => $"https://api.github.com/repos/{Owner}/{Name}/releases/latest";

    public static string ReleasesPage => $"https://github.com/{Owner}/{Name}/releases";

    public static string RawFile(string path) => $"https://raw.githubusercontent.com/{Owner}/{Name}/{Branch}/{path}";

    public static HttpClient Http { get; } = CreateClient();

    private static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("SpotiKit", AppInfo.Version));
        return client;
    }
}

public static class AppInfo
{
    public static string Version { get; } = Read();

    private static string Read()
    {
        var version = typeof(AppInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
                      ?? "0.0.0";
        var plus = version.IndexOf('+');
        return plus < 0 ? version : version[..plus];
    }
}

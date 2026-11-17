using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

internal sealed class FakeGitHub : HttpMessageHandler
{
    public Dictionary<string, Func<HttpResponseMessage>> Routes { get; } = new(StringComparer.Ordinal);

    public void Text(string url, string body, HttpStatusCode status = HttpStatusCode.OK) =>
        Routes[url] = () => new HttpResponseMessage(status) { Content = new StringContent(body) };

    public void Bytes(string url, byte[] body) =>
        Routes[url] = () => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(body) };

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
        Task.FromResult(Routes.TryGetValue(request.RequestUri!.ToString(), out var answer)
            ? answer()
            : new HttpResponseMessage(HttpStatusCode.NotFound));
}

public class AppUpdateServiceTests
{
    private const string ExeUrl = "https://github.com/nmwplays/SpotiKit/releases/download/v0.3.0/SpotiKit.exe";
    private const string SumUrl = "https://github.com/nmwplays/SpotiKit/releases/download/v0.3.0/SpotiKit.exe.sha256";

    private static string ReleaseJson(string tag = "v0.3.0", bool prerelease = false, bool withChecksum = true) => $$"""
        {
          "tag_name": "{{tag}}", "draft": false, "prerelease": {{(prerelease ? "true" : "false")}},
          "html_url": "https://github.com/nmwplays/SpotiKit/releases/tag/{{tag}}",
          "published_at": "2026-11-02T10:00:00Z", "body": "Faster themes.",
          "assets": [
            { "name": "SpotiKit.exe", "size": 5, "browser_download_url": "{{ExeUrl}}" }
            {{(withChecksum ? $", {{ \"name\": \"SpotiKit.exe.sha256\", \"size\": 90, \"browser_download_url\": \"{SumUrl}\" }}" : "")}}
          ]
        }
        """;

    [Fact]
    public void A_release_needs_both_assets_and_a_stable_version()
    {
        var release = AppUpdateService.ParseRelease(ReleaseJson())!;
        Assert.Equal("0.3.0", release.Version);
        Assert.Equal(ExeUrl, release.DownloadUrl);
        Assert.Equal(SumUrl, release.ChecksumUrl);
        Assert.Equal("Faster themes.", release.Notes);

        Assert.Null(AppUpdateService.ParseRelease(ReleaseJson(prerelease: true)));
        Assert.Null(AppUpdateService.ParseRelease(ReleaseJson(withChecksum: false)));
        Assert.Null(AppUpdateService.ParseRelease(ReleaseJson(tag: "latest")));
    }

    [Fact]
    public async Task Check_reports_newer_releases_and_no_release_at_all()
    {
        var github = new FakeGitHub();
        var service = new AppUpdateService("0.2.0", null, true, new HttpClient(github));

        var none = await service.CheckAsync();
        Assert.Null(none.Latest);
        Assert.False(none.IsNewer);

        github.Text(SpotiKitRepository.LatestReleaseApi, ReleaseJson());
        var check = await service.CheckAsync();
        Assert.True(check.IsNewer);

        var same = await new AppUpdateService("0.3.0", null, true, new HttpClient(github)).CheckAsync();
        Assert.False(same.IsNewer);
    }

    [WindowsFact]
    public async Task An_update_replaces_the_program_only_when_the_checksum_matches()
    {
        using var box = new Sandbox(index: null);
        var exe = Path.Combine(box.Root, "SpotiKit.exe");
        File.WriteAllText(exe, "old program");
        var newProgram = Encoding.UTF8.GetBytes("new program");

        var github = new FakeGitHub();
        github.Bytes(ExeUrl, newProgram);
        github.Text(SumUrl, "0000000000000000000000000000000000000000000000000000000000000000  SpotiKit.exe");
        var service = new AppUpdateService("0.2.0", exe, true, new HttpClient(github));
        var release = AppUpdateService.ParseRelease(ReleaseJson())!;

        await Assert.ThrowsAsync<InvalidDataException>(() => service.DownloadAsync(release));
        Assert.False(File.Exists(exe + ".download"));
        Assert.Equal("old program", File.ReadAllText(exe));

        github.Text(SumUrl, Convert.ToHexString(SHA256.HashData(newProgram)).ToLowerInvariant() + "  SpotiKit.exe\n");
        var progress = new List<double>();
        var downloaded = await service.DownloadAsync(release, new SyncProgress(progress));
        Assert.Equal(1, progress.Last());

        service.Replace(downloaded);
        Assert.Equal("new program", File.ReadAllText(exe));
        Assert.Equal("old program", File.ReadAllText(exe + ".old"));

        await AppUpdateService.CleanUpAsync(exe);
        Assert.False(File.Exists(exe + ".old"));
    }

    [Fact]
    public async Task A_development_build_never_replaces_itself()
    {
        var service = new AppUpdateService("0.2.0", "C:\\nowhere\\SpotiKit.exe", isSingleFile: false, new HttpClient(new FakeGitHub()));
        Assert.NotNull(service.CannotUpdateReason);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.DownloadAsync(AppUpdateService.ParseRelease(ReleaseJson())!));
    }

    [Theory]
    [InlineData("ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789")]
    [InlineData("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789  SpotiKit.exe\n")]
    public void Checksum_files_with_or_without_a_file_name_are_read(string text) =>
        Assert.Equal(64, AppUpdateService.ParseChecksum(text).Length);

    private sealed class SyncProgress(List<double> values) : IProgress<double>
    {
        public void Report(double value) => values.Add(value);
    }
}

public class SpotifyVersionListTests
{
    private const string List = """
        { "schemaVersion": 1, "versions": [
          { "version": "1.3.5.3058", "status": "approved", "date": "2099-01-01", "minApp": "0.1.0" },
          { "version": "1.3.6.100", "status": "approved", "minApp": "9.0.0" },
          { "version": "1.3.4.1", "status": "broken", "notes": "Changed its UI files." }
        ] }
        """;

    [Fact]
    public void Parses_statuses_and_the_app_version_a_spotify_version_needs()
    {
        var versions = SpotifyVersionListService.Parse(List);
        var list = new SpotifyVersionList(versions, SpotifyVersionListSource.GitHub, DateTimeOffset.UtcNow);

        Assert.True(list.IsApproved("1.3.5.3058"));
        Assert.False(list.IsApproved("1.3.4.1"));
        Assert.False(list.IsApproved("1.3.7.0"));
        Assert.False(list.Find("1.3.5.3058")!.NeedsNewerApp("0.1.0"));
        Assert.True(list.Find("1.3.6.100")!.NeedsNewerApp("0.1.0"));
        Assert.Equal(new DateOnly(2099, 1, 1), list.Find("1.3.5.3058")!.Date);
    }

    [Theory]
    [InlineData("""{ "schemaVersion": 2, "versions": [] }""")]
    [InlineData("""{ "schemaVersion": 1, "versions": [ { "version": "latest", "status": "approved" } ] }""")]
    [InlineData("""{ "schemaVersion": 1, "versions": [ { "version": "1.2.3.4", "status": "maybe" } ] }""")]
    [InlineData("""{ "schemaVersion": 1, "versions": [ { "version": "1.2.3.4", "status": "approved" }, { "version": "1.2.3.4", "status": "broken" } ] }""")]
    [InlineData("not json")]
    public void Malformed_lists_are_rejected_as_a_whole(string json) =>
        Assert.Throws<InvalidDataException>(() => SpotifyVersionListService.Parse(json));

    [Fact]
    public async Task A_download_is_saved_and_used_when_github_is_unreachable_later()
    {
        using var box = new Sandbox(index: null);

        var offline = new SpotifyVersionListService(box.Paths, _ => throw new HttpRequestException("offline"));
        var bundled = await offline.RefreshAsync();
        Assert.Equal(SpotifyVersionListSource.Bundled, bundled.Source);
        Assert.NotNull(bundled.Problem);
        Assert.True(bundled.IsApproved("1.3.5.3058"));

        var online = new SpotifyVersionListService(box.Paths, _ => Task.FromResult(List));
        var fresh = await online.RefreshAsync();
        Assert.Equal(SpotifyVersionListSource.GitHub, fresh.Source);
        Assert.Null(fresh.Problem);

        var later = await offline.RefreshAsync();
        Assert.Equal(SpotifyVersionListSource.Saved, later.Source);
        Assert.Equal(3, later.Versions.Count);
    }

    [Fact]
    public void A_saved_list_older_than_the_one_in_the_app_is_ignored()
    {
        using var box = new Sandbox(index: null);
        var service = new SpotifyVersionListService(box.Paths);
        Directory.CreateDirectory(Path.GetDirectoryName(service.SavedPath)!);
        File.WriteAllText(service.SavedPath, """{ "schemaVersion": 1, "versions": [ { "version": "1.3.5.3058", "status": "approved", "date": "2026-10-01" } ] }""");

        var list = service.LoadLocal();

        Assert.Equal(SpotifyVersionListSource.Bundled, list.Source);
        Assert.True(list.IsApproved("1.3.6.1921"));
    }

    [Fact]
    public async Task A_broken_download_keeps_the_last_good_list()
    {
        using var box = new Sandbox(index: null);
        await new SpotifyVersionListService(box.Paths, _ => Task.FromResult(List)).RefreshAsync();

        var result = await new SpotifyVersionListService(box.Paths, _ => Task.FromResult("{ broken")).RefreshAsync();

        Assert.Equal(SpotifyVersionListSource.Saved, result.Source);
        Assert.Equal(3, result.Versions.Count);
        Assert.NotNull(result.Problem);
    }

    [Fact]
    public void The_list_in_the_repository_is_valid_and_approves_the_mapped_versions()
    {
        var repository = new DirectoryInfo(AppContext.BaseDirectory);
        while (repository is not null && !File.Exists(Path.Combine(repository.FullName, "SpotiKit.csproj")))
            repository = repository.Parent;
        Assert.NotNull(repository);
        var path = Path.Combine(repository!.FullName, "compatibility", "spotify-versions.json");
        var versions = SpotifyVersionListService.Parse(File.ReadAllText(path));
        foreach (var v in versions.Where(v => v.Status == SpotifyVersionStatus.Approved && !v.NeedsNewerApp(AppInfo.Version)))
            Assert.NotEmpty(ClassMapCatalog.Bundled.For(v.Version));
    }
}

public class AddonTemplateTests
{
    [Fact]
    public void New_add_ons_are_picked_up_by_the_catalog_without_their_readme()
    {
        using var box = new Sandbox(index: null);
        var templates = new AddonTemplates(box.Paths);

        var theme = templates.Create(AddonKind.Theme, "Ocean Glass", "1.3.6.1921");
        var extension = templates.Create(AddonKind.Extension, "Track Toast");
        var app = templates.Create(AddonKind.CustomApp, "Lyrics Board");
        var snippet = templates.Create(AddonKind.Snippet, "Round Corners", "1.3.8.620");

        Assert.Equal("ocean-glass", theme.Id);
        Assert.Equal(Path.Combine(box.Paths.ExtensionsDir, "Track Toast"), extension.Path);
        Assert.Equal(Path.Combine(box.Paths.ThemesDir, "Ocean Glass"), theme.Path);

        var set = new AddonCatalog(box.Paths).Load();
        Assert.Empty(set.Skipped);
        Assert.Contains(set.Themes, t => t.Id == "ocean-glass" && t.Name == "Ocean Glass");
        Assert.Contains("track-toast/extension.js", set.Extensions);
        Assert.Contains(set.Apps, a => a.Id == "lyrics-board" && a.Name == "Lyrics Board");
        Assert.Contains(set.Snippets, s => s.Id == "round-corners" && s.Name == "Round Corners");
        Assert.Contains(set.Files, f => f.Entry == "spotikit/snippets/round-corners/snippet.css");
        Assert.False(File.Exists(Path.Combine(snippet.Path, "spotikit.d.ts")));
        Assert.DoesNotContain(set.Files, f => f.Entry.EndsWith("README.md", StringComparison.Ordinal));
        foreach (var created in new[] { theme, extension, app })
        {
            Assert.Contains("declare const SpotiKit", File.ReadAllText(Path.Combine(created.Path, "spotikit.d.ts")));
            Assert.True(File.Exists(Path.Combine(created.Path, "jsconfig.json")));
        }
        Assert.DoesNotContain(set.Files, f => f.Entry.EndsWith("jsconfig.json", StringComparison.Ordinal) || f.Entry.EndsWith(".d.ts", StringComparison.Ordinal));

        foreach (var file in Directory.EnumerateFiles(box.Paths.AddonsRoot, "*", SearchOption.AllDirectories))
            Assert.DoesNotContain("{{", File.ReadAllText(file));
        Assert.Contains(".lyrics-board {", File.ReadAllText(Path.Combine(app.Path, "style.css")));

        using var manifest = System.Text.Json.JsonDocument.Parse(File.ReadAllText(Path.Combine(theme.Path, "spotikit.json")));
        Assert.Equal("1.3.6", manifest.RootElement.GetProperty("spotify").GetString());
    }

    [Fact]
    public void Names_are_cleaned_and_nothing_is_overwritten()
    {
        using var box = new Sandbox(index: null);
        var templates = new AddonTemplates(box.Paths);

        var odd = templates.Create(AddonKind.Theme, "My \"Cool\" <Theme> `x`");
        Assert.Equal("My Cool Theme x", odd.Name);
        Assert.Equal("my-cool-theme-x", odd.Id);
        System.Text.Json.JsonDocument.Parse(File.ReadAllText(Path.Combine(odd.Path, "spotikit.json"))).Dispose();

        Assert.Equal("x-80s", AddonTemplates.IdFor("80s"));
        Assert.Throws<IOException>(() => templates.Create(AddonKind.Theme, "my cool theme x"));
        Assert.Throws<ArgumentException>(() => templates.Create(AddonKind.Extension, "!!!"));
    }

    [Fact]
    public void TypeScript_projects_point_main_at_the_build_and_keep_tooling_out_of_Spotify()
    {
        using var box = new Sandbox(index: null);
        var templates = new AddonTemplates(box.Paths);

        var app = templates.Create(AddonKind.CustomApp, "Typed Board", "1.3.8.620", typescript: true);
        using (var manifest = System.Text.Json.JsonDocument.Parse(File.ReadAllText(Path.Combine(app.Path, "spotikit.json"))))
        {
            Assert.Equal("src/index.tsx", manifest.RootElement.GetProperty("source").GetString());
            Assert.Equal("dist/index.js", manifest.RootElement.GetProperty("main").GetString());
        }
        Assert.True(File.Exists(Path.Combine(app.Path, "src", "index.tsx")));
        Assert.True(File.Exists(Path.Combine(app.Path, "tsconfig.json")));
        Assert.False(File.Exists(Path.Combine(app.Path, "index.js")));
        Assert.False(File.Exists(Path.Combine(app.Path, "jsconfig.json")));
        Assert.Contains("\"typescript\"", File.ReadAllText(Path.Combine(app.Path, "package.json")));
        Assert.Throws<ArgumentException>(() => templates.Create(AddonKind.Snippet, "Typed Snip", typescript: true));

        Directory.CreateDirectory(Path.Combine(app.Path, "dist"));
        File.WriteAllText(Path.Combine(app.Path, "dist", "index.js"), "export default function App() { return null; }");
        Directory.CreateDirectory(Path.Combine(app.Path, "node_modules", "esbuild"));
        File.WriteAllText(Path.Combine(app.Path, "node_modules", "esbuild", "index.js"), "module.exports = 1;");
        File.WriteAllText(Path.Combine(app.Path, "package-lock.json"), "{}");

        var set = new AddonCatalog(box.Paths).Load();
        Assert.Contains(set.Files, f => f.Entry == "spotikit/apps/typed-board/dist/index.js");
        Assert.DoesNotContain(set.Files, f => f.Entry.Contains("node_modules", StringComparison.Ordinal) ||
                                              f.Entry.EndsWith("package.json", StringComparison.Ordinal) ||
                                              f.Entry.EndsWith("package-lock.json", StringComparison.Ordinal) ||
                                              f.Entry.EndsWith("tsconfig.json", StringComparison.Ordinal) ||
                                              f.Entry.EndsWith(".tsx", StringComparison.Ordinal));
        Assert.DoesNotContain(ProjectChecker.Check(app.Path, "app"), i => i.IsError);
    }

    [Fact]
    public void The_checker_finds_what_breaks_in_Spotify_or_the_Marketplace()
    {
        using var box = new Sandbox(index: null);
        var dir = Path.Combine(box.Paths.SnippetsDir, "Broken");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "spotikit.json"),
            """{ "type": "snippet", "name": "Broken", "spotify": "soon", "style": ["a.css", "gone.css"], "main": "x.js" }""");
        File.WriteAllText(Path.Combine(dir, "a.css"), ".main-view { color: red }\n.Ix6_BK8pqqB_TtYr8HgO { color: blue }\n");
        File.WriteAllText(Path.Combine(dir, "fine.js"), "this._isDraggingSelection = gl.framebufferTexture2D;\n");

        var issues = ProjectChecker.Check(dir, "snippet");
        Assert.Contains(issues, i => i.IsError && i.Message.Contains("\"spotify\""));
        Assert.Contains(issues, i => i.IsError && i.Message.Contains("gone.css"));
        Assert.Contains(issues, i => i.IsError && i.Message.Contains("can't have \"main\""));
        Assert.Contains(issues, i => !i.IsError && i.File == "a.css" && i.Line == 2 && i.Message.Contains("Ix6_BK8pqqB_TtYr8HgO"));
        Assert.DoesNotContain(issues, i => i.Message.Contains("main-view") || i.File == "fine.js");
        Assert.Contains(ProjectChecker.Check(dir, "theme"), i => i.Message.Contains("in the theme folder"));
    }
}

using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class AddonTests
{
    private static AddonCatalog CatalogWith(Sandbox box, params (string Path, string Content)[] files)
    {
        foreach (var (path, content) in files)
        {
            var full = Path.Combine(box.Paths.AddonsRoot, path);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllText(full, content);
        }
        return new AddonCatalog(box.Paths);
    }

    [Fact]
    public void Catalog_reads_extensions_apps_and_themes_and_skips_what_it_cannot_package()
    {
        using var box = new Sandbox();
        var set = CatalogWith(box,
            ("Extensions/hello.js", "SpotiKit.notify('hi')"),
            ("Extensions/notes.txt", "not an extension"),
            ("Extensions/bad;name.js", "x"),
            ("Extensions/toast/spotikit.json", "{\"type\":\"extension\",\"name\":\"Toast\",\"main\":\"toast.js\"}"),
            ("Extensions/toast/toast.js", "SpotiKit.notify('toast')"),
            ("Extensions/nomain/spotikit.json", "{\"type\":\"extension\",\"main\":\"gone.js\"}"),
            ("Custom Apps/stats/index.js", "export default function Stats() {}"),
            ("Custom Apps/stats/spotikit.json", "{\"type\":\"app\",\"name\":{\"en\":\"Stats\",\"de\":\"Statistik\"}}"),
            ("Custom Apps/stats/style.css", ".a{}"),
            ("Custom Apps/stats/run.exe", "MZ"),
            ("Custom Apps/empty/readme.txt", "no manifest"),
            ("Custom Apps/old/index.js", "export default function Old() {}"),
            ("Custom Apps/old/app.json", "{\"name\":\"Old\"}"),
            ("Custom Apps/older/index.js", "export default function Older() {}"),
            ("Custom Apps/older/spotikit.json", "{\"type\":\"app\",\"name\":\"Older\",\"spotify\":\"1.2.80 - 1.3.5\"}"),
            ("Custom Apps/odd/index.js", "export default function Odd() {}"),
            ("Custom Apps/odd/spotikit.json", "{\"type\":\"app\",\"name\":\"Odd\",\"spotify\":\">=1.3\"}"),
            ("Extensions/needy/spotikit.json",
                "{\"type\":\"extension\",\"name\":\"Needy\",\"version\":\"one\",\"dependencies\":{\"a/b\":\"^1.0\",\"c/d\":\"1.0 - 1.4\",\"e/f\":\"*\"}}"),
            ("Extensions/needy/extension.js", "export default function () {}"),
            ("Themes/neon/spotikit.json", "{\"type\":\"theme\",\"name\":\"Neon\",\"style\":\"neon.css\",\"schemes\":\"colors.json\",\"spotify\":\"1.3.5 - 1.3.6\"}"),
            ("Themes/neon/neon.css", "body{}"),
            ("Themes/neon/colors.json", "{}"),
            ("Themes/nocss/spotikit.json", "{\"type\":\"theme\",\"style\":[\"a.css\",\"b.css\"]}"),
            ("Themes/nocss/a.css", "body{}"),
            ("Themes/many/spotikit.json", "[{\"type\":\"theme\"},{\"type\":\"theme\"}]"),
            ("Themes/legacy/theme.json", "{\"name\":\"Legacy\"}"),
            ("Themes/wrong/spotikit.json", "{\"type\":\"extension\"}"),
            ("Themes/broken/theme.css", "body{}"),
            ("Themes/Liquify V2/spotikit.json", "{\"type\":\"theme\",\"style\":\"Glass Layer.css\"}"),
            ("Themes/Liquify V2/Glass Layer.css", "body{}"),
            ("Themes/liquify-v2/spotikit.json", "{\"type\":\"theme\",\"name\":\"Twin\"}")).Load("1.3.6.1921");

        Assert.Equal(["bad-name.js", "hello.js", "needy/extension.js", "toast/toast.js"], set.Extensions);
        Assert.Equal(["odd", "older", "stats"], set.Apps.Select(a => a.Id));
        Assert.Contains(new AddonInfo("stats", "Stats", "stats"), set.Apps);
        Assert.Equal(["liquify-v2", "liquify-v2-2", "neon"], set.Themes.Select(t => t.Id));
        Assert.Contains(new AddonInfo("neon", "Neon", "neon"), set.Themes);
        Assert.Contains(new AddonInfo("liquify-v2", "Liquify V2", "Liquify V2"), set.Themes);
        Assert.Contains(new AddonInfo("liquify-v2-2", "Twin", "liquify-v2"), set.Themes);
        Assert.Contains(set.Files, f => f.Entry == "spotikit/themes/liquify-v2/Glass Layer.css");
        Assert.Contains(set.Files, f => f.Entry == "spotikit/extensions/toast/toast.js");
        Assert.Contains(set.Files, f => f.Entry == "spotikit/apps/stats/style.css");
        Assert.Contains(set.Files, f => f.Entry == "spotikit/themes/neon/spotikit.json");
        Assert.DoesNotContain(set.Files, f => f.Entry.EndsWith(".exe"));
        Assert.Contains(set.Skipped, s => s.StartsWith("nomain: gone.js is missing"));
        Assert.Contains(set.Skipped, s => s.StartsWith("empty"));
        Assert.Contains(set.Skipped, s => s.StartsWith("wrong") && s.Contains("\"extension\""));
        Assert.Contains(set.Skipped, s => s.StartsWith("broken"));
        Assert.Contains(set.Skipped, s => s.StartsWith("old: needs a spotikit.json"));
        Assert.Contains(set.Skipped, s => s.StartsWith("legacy: needs a spotikit.json"));
        Assert.Equal(4, set.Warnings.Count);
        Assert.Contains(set.Warnings, w => w == "needy: \"one\" isn't a version number like 1.2.0.");
        Assert.Contains(set.Warnings, w => w == "needy: \"^1.0\" for a/b isn't a version range like 1.0 - 1.4.");
        Assert.Contains(set.Warnings, w => w.StartsWith("older: made for Spotify 1.2.80 to 1.3.5, this is 1.3.6.1921"));
        Assert.Contains(set.Warnings, w => w.StartsWith("odd: \">=1.3\" isn't a Spotify version range"));
        Assert.Contains(set.Skipped, s => s.StartsWith("nocss: b.css is missing"));
        Assert.Contains(set.Skipped, s => s.StartsWith("many") && s.Contains("own folder"));
    }

    [Fact]
    public void A_manifest_saved_with_a_byte_order_mark_is_read()
    {
        using var box = new Sandbox();
        var folder = Path.Combine(box.Paths.ThemesDir, "Notepad Theme");
        Directory.CreateDirectory(folder);
        File.WriteAllText(Path.Combine(folder, "spotikit.json"), "{\"type\":\"theme\",\"name\":\"Notepad\"}", new UTF8Encoding(true));

        var set = new AddonCatalog(box.Paths).Load();

        Assert.Empty(set.Skipped);
        Assert.Contains(new AddonInfo("notepad-theme", "Notepad", "Notepad Theme"), set.Themes);
    }

    [Theory]
    [InlineData("1.3.6.1921", "1.3.5 - 1.3.6", true)]
    [InlineData("1.3.5.3058", "1.3.5 - 1.3.6", true)]
    [InlineData("1.3.7.10", "1.3.5 - 1.3.6", false)]
    [InlineData("1.3.4.100", "1.3.5 - 1.3.6", false)]
    [InlineData("1.3.6.1921", "1.3.6", true)]
    [InlineData("1.3.6.1921", "1.3", true)]
    [InlineData("1.4.0.1", "1.3", false)]
    [InlineData("1.3.6.1921", "1.3.6.1921", true)]
    [InlineData("1.3.6.2000", "1.3.6.1921", false)]
    [InlineData("1.3.6.1921", " 1.3.5-1.3.6 ", true)]
    public void Spotify_ranges_include_both_ends(string version, string range, bool expected) =>
        Assert.Equal(expected, VersionRange.Contains(version, range));

    [Theory]
    [InlineData(">=1.3")]
    [InlineData("1.3.6 - 1.3.5")]
    [InlineData("1.3 || 1.4")]
    [InlineData("latest")]
    [InlineData("")]
    public void Unreadable_ranges_are_reported(string range) => Assert.False(VersionRange.IsValid(range));

    [Fact]
    public void Custom_apps_from_the_old_Apps_folder_are_moved_once()
    {
        using var box = new Sandbox();
        var old = Path.Combine(box.Paths.AddonsRoot, "Apps", "stats");
        Directory.CreateDirectory(old);
        File.WriteAllText(Path.Combine(old, "index.js"), "export default function Stats() {}");

        box.Paths.MoveLegacyFolders();

        Assert.False(Directory.Exists(Path.Combine(box.Paths.AddonsRoot, "Apps")));
        Assert.True(File.Exists(Path.Combine(box.Paths.AppsDir, "stats", "index.js")));
        Assert.EndsWith("Custom Apps", box.Paths.AppsDir);
    }

    [Fact]
    public void Without_add_ons_nothing_is_packaged()
    {
        using var box = new Sandbox();
        var plain = new AddonCatalog(box.Paths).Load();
        Assert.Empty(plain.Themes);
        Assert.Empty(plain.Files);
    }

    [Fact]
    public void Inject_packages_add_ons_and_Remove_takes_every_one_out()
    {
        using var box = new Sandbox();
        var originalIndex = Sandbox.ReadEntryBytes(box.XpuiPath, "index.html");
        var set = CatalogWith(box,
            ("Extensions/hello.js", "console.log('hello')"),
            ("Custom Apps/stats/index.js", "export default function Stats() {}"), ("Custom Apps/stats/spotikit.json", "{\"type\":\"app\"}")).Load();

        XpuiPatcher.Inject(box.XpuiPath, "/* loader */", "1.0.0", addons: set);

        var html = Encoding.UTF8.GetString(Sandbox.ReadEntryBytes(box.XpuiPath, "index.html"));
        Assert.True(html.IndexOf("/spotikit/config.js", System.StringComparison.Ordinal) < html.IndexOf("/spotikit/loader.js", System.StringComparison.Ordinal));
        var config = XpuiPatcher.ReadConfigScript(box.XpuiPath)!;
        Assert.Contains("\"extensions\":[{\"id\":\"hello\",\"name\":\"hello\",\"path\":\"hello.js\"}]", config);
        Assert.Contains("\"apps\":[{\"id\":\"stats\",\"name\":\"stats\"}]", config);
        Assert.Contains("\"themes\":[]", config);
        Assert.Equal("console.log('hello')", Encoding.UTF8.GetString(Sandbox.ReadEntryBytes(box.XpuiPath, "spotikit/extensions/hello.js")));

        XpuiPatcher.Inject(box.XpuiPath, "/* loader */", "1.0.1", addons: AddonSet.Empty);
        using (var zip = ZipFile.OpenRead(box.XpuiPath))
            Assert.DoesNotContain(zip.Entries, e => e.FullName.StartsWith("spotikit/extensions/") || e.FullName.StartsWith("spotikit/apps/") ||
                                                    e.FullName.StartsWith("spotikit/themes/"));

        XpuiPatcher.Inject(box.XpuiPath, "/* loader */", "1.0.2", addons: set);
        XpuiPatcher.Remove(box.XpuiPath);
        Assert.Equal(originalIndex, Sandbox.ReadEntryBytes(box.XpuiPath, "index.html"));
        using (var zip = ZipFile.OpenRead(box.XpuiPath))
            Assert.DoesNotContain(zip.Entries, e => e.FullName.StartsWith("spotikit/"));
    }

    [Fact]
    public void Bundled_framework_is_the_loader_followed_by_every_api_part_in_order()
    {
        var script = FrameworkPackage.Bundled.LoaderScript;
        string[] parts = ["SpotiKit runtime", "SpotiKit icons", "SpotiKit core", "SpotiKit URI", "SpotiKit utilities",
            "SpotiKit Components", "SpotiKit menus", "SpotiKit Topbar and Playbar", "SpotiKit Dialog and Panels", "SpotiKit apps", "SpotiKit themes", "SpotiKit marketplace */", "SpotiKit marketplace UI",
            "SpotiKit window"];
        Assert.Equal(0, script.IndexOf("/* SpotiKit loader", System.StringComparison.Ordinal));
        var at = 0;
        foreach (var part in parts)
        {
            var next = script.IndexOf("/* " + part, System.StringComparison.Ordinal);
            Assert.True(next > at, $"{part} is missing or out of order");
            at = next;
        }
        Assert.DoesNotContain("{{VERSION}}", script);
        Assert.DoesNotContain("window.Spicetify", script);
    }
}

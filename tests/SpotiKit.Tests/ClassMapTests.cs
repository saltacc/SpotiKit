using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class ClassMapTests
{
    private const string Generated = "Qq2L06KPRRKMD91JnleG";
    private const string Css =
        ".Qq2L06KPRRKMD91JnleG{width:100%;height:100%}" +
        ".Qq2L06KPRRKMD91JnleG:focus-visible:after{content:\"\"}" +
        "@container main (width>0){.Qq2L06KPRRKMD91JnleG{--content-spacing:16px}}" +
        ".Qq2L06KPRRKMD91JnleGx{color:red}";

    private static readonly ClassMapping MainView = new(Generated, "main-view");

    private const string RealVersion = "1.3.5.3058";
    private const string RealMainView = "R1kU6b2KxZc8FWfbYf3m";

    private static Sandbox WithCss(string css = Css)
    {
        var box = new Sandbox(index: null);
        Sandbox.CreateSpa(box.XpuiPath, Sandbox.SampleIndex, false, ("xpui-snapshot.css", css), ("other.css", ".abc{}"));
        return box;
    }

    private static string Text(string spa, string entry) => Encoding.UTF8.GetString(Sandbox.ReadEntryBytes(spa, entry));

    [Fact]
    public void Inject_renames_the_class_in_every_selector_and_Remove_restores_the_stylesheet_exactly()
    {
        using var box = WithCss();
        var original = Sandbox.ReadEntryBytes(box.XpuiPath, "xpui-snapshot.css");

        var result = XpuiPatcher.Inject(box.XpuiPath, "/* loader */", "1.0.0", [MainView], "1.3.4.258");

        var applied = Assert.Single(result.Applied);
        Assert.Equal(3, applied.Total);
        Assert.Empty(result.Skipped);
        var css = Text(box.XpuiPath, "xpui-snapshot.css");
        Assert.Equal(3, CountOf(css, ".main-view{") + CountOf(css, ".main-view:"));
        Assert.DoesNotContain(".Qq2L06KPRRKMD91JnleG{", css);
        Assert.Contains(".Qq2L06KPRRKMD91JnleGx{color:red}", css);

        Assert.Contains("\"Qq2L06KPRRKMD91JnleG\":\"main-view\"", Text(box.XpuiPath, XpuiPatcher.ClassMapScriptEntry));
        var html = Text(box.XpuiPath, "index.html");
        Assert.True(html.IndexOf("/spotikit/class-map.js", StringComparison.Ordinal) < html.IndexOf("/spotikit/loader.js", StringComparison.Ordinal));
        Assert.True(XpuiPatcher.Inspect(box.XpuiPath).HasClassMap);
        Assert.Equal("1.3.4.258", XpuiPatcher.ReadClassMap(box.XpuiPath)!.SpotifyVersion);

        XpuiPatcher.Remove(box.XpuiPath);

        Assert.Equal(original, Sandbox.ReadEntryBytes(box.XpuiPath, "xpui-snapshot.css"));
        var cleaned = XpuiPatcher.Inspect(box.XpuiPath);
        Assert.False(cleaned.HasClassMap);
        Assert.False(cleaned.HasSpotiKit);
        Assert.Equal(5, cleaned.EntryCount);
    }

    [Fact]
    public void Reinstalling_applies_the_map_once()
    {
        using var box = WithCss();
        XpuiPatcher.Inject(box.XpuiPath, "a", "1.0.0", [MainView], "1.3.4.258");
        var again = XpuiPatcher.Inject(box.XpuiPath, "b", "1.1.0", [MainView], "1.3.4.258");

        Assert.Equal(3, Assert.Single(again.Applied).Total);
        XpuiPatcher.Remove(box.XpuiPath);
        Assert.Equal(Css, Text(box.XpuiPath, "xpui-snapshot.css"));
    }

    [Fact]
    public void A_class_that_is_not_in_the_styles_is_skipped_and_nothing_else_changes()
    {
        using var box = WithCss(".abc{}");
        var result = XpuiPatcher.Inject(box.XpuiPath, "x", "1.0.0", [MainView], "1.3.4.258");

        Assert.Empty(result.Applied);
        Assert.Contains("not found", Assert.Single(result.Skipped).Reason);
        Assert.False(XpuiPatcher.Inspect(box.XpuiPath).HasClassMap);
        Assert.DoesNotContain("class-map.js", Text(box.XpuiPath, "index.html"));
    }

    [Fact]
    public void A_stable_name_that_already_exists_is_skipped()
    {
        using var box = WithCss(Css + ".main-view{}");
        var result = XpuiPatcher.Inject(box.XpuiPath, "x", "1.0.0", [MainView], "1.3.4.258");

        Assert.Empty(result.Applied);
        Assert.Contains("already exists", Assert.Single(result.Skipped).Reason);
    }

    [Fact]
    public void Remove_refuses_when_the_stylesheet_no_longer_adds_up()
    {
        using var box = WithCss();
        XpuiPatcher.Inject(box.XpuiPath, "x", "1.0.0", [MainView], "1.3.4.258");
        Sandbox.ReplaceEntry(box.XpuiPath, "xpui-snapshot.css",
            Text(box.XpuiPath, "xpui-snapshot.css").Replace(".main-view{width:100%;height:100%}", ""));
        var before = FileHash.Sha256(box.XpuiPath);

        Assert.Throws<InvalidDataException>(() => XpuiPatcher.Remove(box.XpuiPath));
        Assert.Equal(before, FileHash.Sha256(box.XpuiPath));
    }

    [Fact]
    public void The_bundled_map_is_version_bound_and_valid()
    {
        var catalog = ClassMapCatalog.Bundled;
        Assert.Contains(catalog.For(RealVersion), m => m.Generated == RealMainView && m.Stable == "main-view-panel");
        Assert.Empty(catalog.For("1.3.4.258"));
        Assert.Empty(catalog.For("1.2.3.4"));
        Assert.Empty(catalog.For(null));
        Assert.Throws<InvalidDataException>(() => ClassMapCatalog.Parse(
            """{"schemaVersion":1,"spotify":{"1.0":[{"generated":"Abcdef","stable":"Main View"}]}}"""));
    }

    [Fact]
    public void Many_classes_in_several_stylesheets_are_renamed_together_and_restored()
    {
        const string first = ".aaaaaaaaaaaaaaaaaaaa .bbbbbbbbbbbbbbbbbbbb{x:1}.aaaaaaaaaaaaaaaaaaaa:hover{x:2}.e-10860-text{x:3}";
        const string second = ".bbbbbbbbbbbbbbbbbbbb>.keep{x:4}";
        using var box = new Sandbox(index: null);
        Sandbox.CreateSpa(box.XpuiPath, Sandbox.SampleIndex, false, ("a.css", first), ("b.css", second));
        ClassMapping[] map = [new("aaaaaaaaaaaaaaaaaaaa", "card"), new("bbbbbbbbbbbbbbbbbbbb", "card__title"), new("e-10860-text", "e-text")];

        var result = XpuiPatcher.Inject(box.XpuiPath, "x", "1.0.0", map, "1.3.4.258");

        Assert.Equal(["card", "card__title", "e-text"], result.Applied.Select(a => a.Stable));
        Assert.Equal(2, result.Applied[1].Files.Count);
        Assert.Equal(".card .card__title{x:1}.card:hover{x:2}.e-text{x:3}", Text(box.XpuiPath, "a.css"));
        Assert.Equal(".card__title>.keep{x:4}", Text(box.XpuiPath, "b.css"));

        XpuiPatcher.Remove(box.XpuiPath);
        Assert.Equal(first, Text(box.XpuiPath, "a.css"));
        Assert.Equal(second, Text(box.XpuiPath, "b.css"));
    }

    [Fact]
    public void A_runtime_only_class_goes_to_the_loader_without_touching_any_stylesheet()
    {
        using var box = WithCss();
        var original = Sandbox.ReadEntryBytes(box.XpuiPath, "xpui-snapshot.css");
        ClassMapping[] map = [new("e-10860-button-tertiary--medium", "e-button-tertiary--medium", RuntimeOnly: true)];

        var result = XpuiPatcher.Inject(box.XpuiPath, "x", "1.0.0", map, "1.3.4.258");

        Assert.Empty(Assert.Single(result.Applied).Files);
        Assert.Equal(original, Sandbox.ReadEntryBytes(box.XpuiPath, "xpui-snapshot.css"));
        Assert.Contains("\"e-10860-button-tertiary--medium\":\"e-button-tertiary--medium\"", Text(box.XpuiPath, XpuiPatcher.ClassMapScriptEntry));
        XpuiPatcher.Remove(box.XpuiPath);
        Assert.False(XpuiPatcher.Inspect(box.XpuiPath).HasClassMap);
    }

    [Fact]
    public void The_catalog_rejects_a_name_used_twice()
    {
        Assert.Throws<InvalidDataException>(() => ClassMapCatalog.Parse(
            """{"schemaVersion":1,"spotify":{"1.0":[{"generated":"Abcdef","stable":"card"},{"generated":"Ghijkl","stable":"card"}]}}"""));
        Assert.Throws<InvalidDataException>(() => ClassMapCatalog.Parse(
            """{"schemaVersion":1,"spotify":{"1.0":[{"generated":"Abcdef","stable":"card"},{"generated":"Abcdef","stable":"tile"}]}}"""));
        Assert.Single(ClassMapCatalog.Parse(
            """{"schemaVersion":1,"spotify":{"1.0":[{"generated":"Abcdef","stable":"card__title--active"}]}}""").For("1.0"));
    }

    [WindowsFact]
    public void Real_client_copy_gets_the_mapping_and_returns_to_its_original_content()
    {
        var (real, version) = RealClientForBundledMap();
        if (real is null)
            return;
        var mappings = ClassMapCatalog.Bundled.For(version!);

        using var box = new Sandbox(index: null);
        File.Copy(real, box.XpuiPath);
        if (XpuiPatcher.Inspect(box.XpuiPath).HasSpotiKit)
            XpuiPatcher.Remove(box.XpuiPath);
        var baseline = Path.Combine(box.Root, "baseline.spa");
        File.Copy(box.XpuiPath, baseline);

        var result = XpuiPatcher.Inject(box.XpuiPath, FrameworkPackage.Bundled.LoaderScript, FrameworkPackage.Bundled.Version, mappings, version!);

        Assert.Equal(mappings.Count, result.Applied.Count);
        var runtimeOnly = mappings.Where(m => m.RuntimeOnly).Select(m => m.Generated).ToHashSet();
        Assert.All(result.Applied, a => Assert.True(a.Total > 0 || runtimeOnly.Contains(a.Generated)));
        var css = Text(box.XpuiPath, "xpui-snapshot.css");
        Assert.Contains(".main-view-panel{timeline-scope:", css);
        Assert.DoesNotContain("." + RealMainView, css);

        XpuiPatcher.Remove(box.XpuiPath);
        Assert.Empty(XpuiPatcher.DifferingEntries(baseline, box.XpuiPath));
    }

    private static (string? Path, string? Version) RealClientForBundledMap()
    {
        var spotifyDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Spotify");
        var installed = Path.Combine(spotifyDir, "Apps", "xpui.spa");
        var exe = Path.Combine(spotifyDir, "Spotify.exe");
        if (File.Exists(installed) && File.Exists(exe))
        {
            var info = FileVersionInfo.GetVersionInfo(exe);
            var version = $"{info.FileMajorPart}.{info.FileMinorPart}.{info.FileBuildPart}.{info.FilePrivatePart}";
            if (ClassMapCatalog.Bundled.For(version).Count > 0)
                return (installed, version);
        }

        var backups = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SpotiKit", "Backups");
        if (!Directory.Exists(backups))
            return (null, null);
        foreach (var dir in Directory.GetDirectories(backups).Order(StringComparer.Ordinal))
        {
            var name = Path.GetFileName(dir);
            var version = name[(name.LastIndexOf('-') + 1)..];
            var spa = Path.Combine(dir, "files", "Apps", "xpui.spa");
            if (File.Exists(spa) && ClassMapCatalog.Bundled.For(version).Count > 0)
                return (spa, version);
        }
        return (null, null);
    }

    private static int CountOf(string text, string value) =>
        Enumerable.Range(0, Math.Max(0, text.Length - value.Length + 1)).Count(i => string.CompareOrdinal(text, i, value, 0, value.Length) == 0);
}

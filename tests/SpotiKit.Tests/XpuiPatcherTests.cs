using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class XpuiPatcherTests
{
    [Fact]
    public void Inspect_reports_a_stock_archive_as_patchable()
    {
        using var box = new Sandbox();
        var result = XpuiPatcher.Inspect(box.XpuiPath);

        Assert.True(result.IsReadable);
        Assert.True(result.HasIndex);
        Assert.True(result.HasBodyAnchor);
        Assert.False(result.HasSpotiKit);
        Assert.Empty(result.ForeignMods);
        Assert.True(result.IsPatchable);
        Assert.Equal(3, result.EntryCount);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Inject_then_Remove_restores_index_html_byte_for_byte(bool withBom)
    {
        using var box = new Sandbox(withBom: withBom);
        var originalIndex = Sandbox.ReadEntryBytes(box.XpuiPath, "index.html");

        XpuiPatcher.Inject(box.XpuiPath, "/* loader */", "1.2.3");
        var patched = XpuiPatcher.Inspect(box.XpuiPath);
        Assert.True(patched.HasSpotiKit);
        Assert.True(patched.HasLoaderFile);
        Assert.Equal("1.2.3", patched.SpotiKitVersion);
        Assert.Equal("/* loader */", XpuiPatcher.ReadLoader(box.XpuiPath));

        var html = Encoding.UTF8.GetString(Sandbox.ReadEntryBytes(box.XpuiPath, "index.html"));
        Assert.Contains(XpuiPatcher.BuildMarker("1.2.3") + "</body>", html);

        XpuiPatcher.Remove(box.XpuiPath);
        Assert.Equal(originalIndex, Sandbox.ReadEntryBytes(box.XpuiPath, "index.html"));
        var cleaned = XpuiPatcher.Inspect(box.XpuiPath);
        Assert.False(cleaned.HasSpotiKit);
        Assert.False(cleaned.HasLoaderFile);
        Assert.Equal(3, cleaned.EntryCount);
    }

    [Fact]
    public void Injecting_twice_keeps_a_single_marker_with_the_new_version()
    {
        using var box = new Sandbox();
        XpuiPatcher.Inject(box.XpuiPath, "a", "1.0.0");
        XpuiPatcher.Inject(box.XpuiPath, "b", "1.1.0");

        var html = Encoding.UTF8.GetString(Sandbox.ReadEntryBytes(box.XpuiPath, "index.html"));
        Assert.Equal(1, CountOf(html, "spotikit:begin"));
        Assert.Equal("1.1.0", XpuiPatcher.Inspect(box.XpuiPath).SpotiKitVersion);
        Assert.Equal("b", XpuiPatcher.ReadLoader(box.XpuiPath));
    }

    [Fact]
    public void Failed_inject_leaves_the_original_file_untouched()
    {
        using var box = new Sandbox(index: "<html><head></head><p>no body close</p></html>");
        var before = FileHash.Sha256(box.XpuiPath);

        Assert.Throws<InvalidDataException>(() => XpuiPatcher.Inject(box.XpuiPath, "x", "1.0.0"));

        Assert.Equal(before, FileHash.Sha256(box.XpuiPath));
        Assert.False(File.Exists(box.XpuiPath + ".spotikit-tmp"));
    }

    [Fact]
    public void Detects_spicetify_traces()
    {
        using var box = new Sandbox(index: null);
        Sandbox.CreateSpa(box.XpuiPath, Sandbox.SampleIndex, false, ("helper/spicetifyWrapper.js", "//"));

        var result = XpuiPatcher.Inspect(box.XpuiPath);
        Assert.Contains("Spicetify", result.ForeignMods);
        Assert.False(result.IsPatchable);
    }

    [Fact]
    public void Inspect_does_not_throw_on_a_damaged_file()
    {
        using var box = new Sandbox(index: null);
        File.WriteAllText(box.XpuiPath, "definitely not a zip");

        var result = XpuiPatcher.Inspect(box.XpuiPath);
        Assert.False(result.IsReadable);
        Assert.NotNull(result.Error);
    }

    [Fact]
    public void Round_trip_on_a_copy_of_the_real_client_restores_index_html()
    {
        var real = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Spotify", "Apps", "xpui.spa");
        if (!File.Exists(real))
            return;

        using var box = new Sandbox(index: null);
        File.Copy(real, box.XpuiPath);
        if (XpuiPatcher.Inspect(box.XpuiPath).HasSpotiKit)
            XpuiPatcher.Remove(box.XpuiPath);
        var originalIndex = Sandbox.ReadEntryBytes(box.XpuiPath, "index.html");
        int originalCount;
        using (var zip = ZipFile.OpenRead(box.XpuiPath))
            originalCount = zip.Entries.Count;

        Assert.True(XpuiPatcher.Inspect(box.XpuiPath).IsPatchable);

        XpuiPatcher.Inject(box.XpuiPath, FrameworkPackage.Bundled.LoaderScript, FrameworkPackage.Bundled.Version);
        Assert.True(XpuiPatcher.Inspect(box.XpuiPath).HasSpotiKit);

        XpuiPatcher.Remove(box.XpuiPath);
        Assert.Equal(originalIndex, Sandbox.ReadEntryBytes(box.XpuiPath, "index.html"));
        Assert.Equal(originalCount, XpuiPatcher.Inspect(box.XpuiPath).EntryCount);
    }

    private static int CountOf(string text, string value)
    {
        var count = 0;
        for (var i = text.IndexOf(value, StringComparison.Ordinal); i >= 0; i = text.IndexOf(value, i + 1, StringComparison.Ordinal))
            count++;
        return count;
    }
}

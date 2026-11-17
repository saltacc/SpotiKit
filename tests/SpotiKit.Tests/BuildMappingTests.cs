using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using SpotiKit.Models;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class BuildMappingTests
{
    private static readonly string Fingerprint = new('A', 64);
    private static SpotifyInstallation Client(string platform, string architecture = "arm64", string? fingerprint = null) =>
        new(SpotifyEdition.Desktop, "1.3.9.2055", "/fixture", false)
        { Build = new(platform, architecture, fingerprint ?? Fingerprint) };

    private static ClassMapCatalog Catalog() => ClassMapCatalog.Parse(JsonSerializer.Serialize(new
    {
        schemaVersion = 2,
        spotify = new Dictionary<string, object> { ["1.3.9.2055"] = new[] { new { generated = "WindowsHash", stable = "main-view-panel" } } },
        profiles = new[] { new { id = "mac-arm64", spotifyVersion = "1.3.9.2055", platform = "macos", architecture = "arm64",
            resourceFingerprint = Fingerprint, snapshotSha256 = (string?)null,
            mappings = new[] { new { generated = "MacHash", stable = "main-view-panel" } } } },
    }));

    [Fact]
    public void The_same_version_selects_the_target_platform_instead_of_the_host()
    {
        var catalog = Catalog();
        Assert.Equal("MacHash", Assert.Single(catalog.Select(Client("macos")).Mappings).Generated);
        Assert.Equal("WindowsHash", Assert.Single(catalog.Select(Client("windows", "x64")).Mappings).Generated);
        Assert.False(catalog.Select(Client("linux")).IsSupported);
        Assert.False(catalog.Select(Client("macos", "x64")).IsSupported);
        var reissued = catalog.Select(Client("macos", fingerprint: new string('B', 64)));
        Assert.True(reissued.IsSupported);
        Assert.True(reissued.IsFallback);
    }

    [Fact]
    public void Legacy_maps_never_become_an_implicit_Mac_profile()
    {
        var catalog = new ClassMapCatalog(new Dictionary<string, IReadOnlyList<ClassMapping>>
            { ["1.3.9.2055"] = [new("SomeHash", "main-view-panel")] });
        Assert.Empty(catalog.Select(Client("macos")).Mappings);
        Assert.NotEmpty(catalog.Select(Client("windows")).Mappings);
    }

    private static ClassMapProfile Profile(string version, string platform = "macos", string architecture = "arm64") =>
        new(platform + "-" + architecture + "-" + version, version, platform, architecture, Fingerprint, null,
            [new("GeneratedHash", "main-view-panel"), new("MissingHash", "player-controls")]);

    private static ClassMapCatalog WithProfiles(params ClassMapProfile[] profiles) =>
        new(new Dictionary<string, IReadOnlyList<ClassMapping>>()) { Profiles = profiles };

    [Theory]
    [InlineData("1.3.6.1921", "1.3.5.9000", "1.3.9.2055", "1.3.5.9000")]
    [InlineData("1.3.6.1921", "1.3.6.1800", "1.3.6.2000", "1.3.6.2000")]
    [InlineData("1.3.6.1921", "1.3.5.1921", "1.3.7.1921", "1.3.5.1921")]
    [InlineData("1.3.11.1", "1.3.9.2055", "1.3.10.1000", "1.3.10.1000")]
    [InlineData("1.3.6", "1.3.6.100", "1.3.6.0", "1.3.6.0")]
    public void Mac_fallback_uses_numeric_version_distance_and_prefers_older_for_a_tie(
        string target, string first, string second, string expected)
    {
        var selected = WithProfiles(Profile(first), Profile(second)).Select(Client("macos") with { Version = target });
        Assert.True(selected.IsFallback);
        Assert.Equal(expected, selected.Profile!.SpotifyVersion);
        Assert.Contains(target, selected.Description);
        Assert.Contains(expected, selected.Description);
    }

    [Fact]
    public void An_exact_build_wins_over_fallback_candidates_and_never_crosses_platform_or_architecture()
    {
        var exact = Profile("1.3.6.1921");
        var catalog = WithProfiles(Profile("1.3.6.1920", "windows"), Profile("1.3.6.1920", architecture: "x64"),
            Profile("1.3.9.2055"), exact);
        var target = Client("macos") with { Version = "1.3.6.1921" };
        var selected = catalog.Select(target);
        Assert.Equal(exact.Id, selected.Profile!.Id);
        Assert.False(selected.IsFallback);

        var fallback = WithProfiles(catalog.Profiles[0], catalog.Profiles[1], catalog.Profiles[2]).Select(target);
        Assert.True(fallback.IsFallback);
        Assert.Equal("1.3.9.2055", fallback.Profile!.SpotifyVersion);
        Assert.Equal("macos", fallback.Profile.Platform);
        Assert.Equal("arm64", fallback.Profile.Architecture);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("unknown")]
    [InlineData("1")]
    public void An_unknown_version_does_not_guess_a_fallback(string? version)
    {
        var selected = WithProfiles(Profile("1.3.9.2055")).Select(Client("macos") with { Version = version });
        Assert.False(selected.IsSupported);
        Assert.False(selected.IsFallback);
    }

    [Fact]
    public void Fallback_records_source_version_without_changing_target_identity_and_remains_reversible()
    {
        using var box = new Sandbox(index: null);
        Sandbox.CreateSpa(box.XpuiPath, Sandbox.SampleIndex, false, ("xpui.css", ".GeneratedHash{color:red}"));
        var fingerprint = XpuiPatcher.ResourceFingerprint(box.XpuiPath);
        var target = Client("macos", fingerprint: fingerprint) with { Version = "1.3.6.1921" };
        var selected = WithProfiles(Profile("1.3.9.2055")).Select(target);
        var result = XpuiPatcher.Inject(box.XpuiPath, "loader", "1.0", selected.Mappings, target.Version, selection: selected);
        Assert.Single(result.Applied);
        Assert.Single(result.Skipped);
        var stored = XpuiPatcher.ReadClassMap(box.XpuiPath)!;
        Assert.True(stored.IsFallback);
        Assert.Equal(target.Version, stored.SpotifyVersion);
        Assert.Equal("1.3.9.2055", stored.SourceSpotifyVersion);
        Assert.Equal(target.Build, stored.Build);
        Assert.Equal(fingerprint, XpuiPatcher.ResourceFingerprint(box.XpuiPath));
        XpuiPatcher.Remove(box.XpuiPath);
        Assert.Equal(fingerprint, XpuiPatcher.ResourceFingerprint(box.XpuiPath));
    }

    [Fact]
    public void A_fallback_with_zero_matching_classes_still_reports_its_source_without_changing_styles()
    {
        using var box = new Sandbox(index: null);
        const string css = ".UnrelatedHash{color:red}";
        Sandbox.CreateSpa(box.XpuiPath, Sandbox.SampleIndex, false, ("xpui.css", css));
        var fingerprint = XpuiPatcher.ResourceFingerprint(box.XpuiPath);
        var target = Client("macos", fingerprint: fingerprint) with { Version = "1.3.6.1921" };
        var selected = WithProfiles(Profile("1.3.9.2055")).Select(target);
        var result = XpuiPatcher.Inject(box.XpuiPath, "loader", "1.0", selected.Mappings, target.Version, selection: selected);
        Assert.Empty(result.Applied);
        Assert.Equal(2, result.Skipped.Count);
        Assert.True(XpuiPatcher.ReadClassMap(box.XpuiPath)!.IsFallback);
        Assert.Contains("window.__spotikitMappingIsFallback = true", Encoding.UTF8.GetString(
            Sandbox.ReadEntryBytes(box.XpuiPath, XpuiPatcher.ClassMapScriptEntry)));
        Assert.Equal(css, Encoding.UTF8.GetString(Sandbox.ReadEntryBytes(box.XpuiPath, "xpui.css")));
        XpuiPatcher.Remove(box.XpuiPath);
        Assert.Equal(fingerprint, XpuiPatcher.ResourceFingerprint(box.XpuiPath));
    }

    [Fact]
    public void A_reissued_build_is_detected_even_when_the_display_version_does_not_change()
    {
        var client = Client("macos");
        var record = new InstallRecord("0.9.0", ReleaseChannel.Stable, DateTimeOffset.UtcNow,
            client.Version!, null, "hash") { Build = client.Build };
        Assert.False(record.WasReplaced(client));
        Assert.True(record.WasReplaced(client with { Build = client.Build! with { ResourceFingerprint = new string('B', 64) } }));
        Assert.True(record.WasReplaced(client with { Version = "1.3.10.1" }));
    }

    [Fact]
    public void Resource_identity_survives_install_repair_removal_and_zip_recompression()
    {
        using var box = new Sandbox(index: null);
        Sandbox.CreateSpa(box.XpuiPath, Sandbox.SampleIndex, true, ("xpui.css", ".GeneratedHash{color:red}"));
        var fingerprint = XpuiPatcher.ResourceFingerprint(box.XpuiPath);
        var build = new SpotifyBuildIdentity("macos", "arm64", fingerprint);
        var profile = new ClassMapProfile("fixture", "1.2.3.4", "macos", "arm64", fingerprint, null,
            [new("GeneratedHash", "main-view-panel")]);
        var selection = new ClassMapSelection(profile, build, "test");
        XpuiPatcher.Inject(box.XpuiPath, "loader", "1.0", profile.Mappings, "1.2.3.4", selection: selection);
        Assert.Equal(fingerprint, XpuiPatcher.ResourceFingerprint(box.XpuiPath));
        Assert.Equal("fixture", XpuiPatcher.ReadClassMap(box.XpuiPath)!.ProfileId);
        XpuiPatcher.Inject(box.XpuiPath, "new loader", "1.1", profile.Mappings, "1.2.3.4", selection: selection);
        Assert.Equal(fingerprint, XpuiPatcher.ResourceFingerprint(box.XpuiPath));
        XpuiPatcher.Remove(box.XpuiPath);
        Assert.Equal(fingerprint, XpuiPatcher.ResourceFingerprint(box.XpuiPath));
        Sandbox.ReplaceEntry(box.XpuiPath, "xpui.css", ".GeneratedHash{color:blue}");
        Assert.NotEqual(fingerprint, XpuiPatcher.ResourceFingerprint(box.XpuiPath));
    }

    [Fact]
    public void New_patches_preserve_CSS_strings_assets_and_comments_and_remain_reversible()
    {
        using var box = new Sandbox(index: null);
        const string css = "/* .GeneratedHash */ .GeneratedHash{content:'.GeneratedHash';background:url(.GeneratedHash.svg)}";
        Sandbox.CreateSpa(box.XpuiPath, Sandbox.SampleIndex, false, ("xpui.css", css));
        var fingerprint = XpuiPatcher.ResourceFingerprint(box.XpuiPath);
        XpuiPatcher.Inject(box.XpuiPath, "loader", "1.0", [new("GeneratedHash", "main-view-panel")], "1.2.3.4");
        Assert.Equal(2, XpuiPatcher.ReadClassMap(box.XpuiPath)!.RewriteVersion);
        Assert.Equal("/* .GeneratedHash */ .main-view-panel{content:'.GeneratedHash';background:url(.GeneratedHash.svg)}",
            Encoding.UTF8.GetString(Sandbox.ReadEntryBytes(box.XpuiPath, "xpui.css")));
        Assert.Equal(fingerprint, XpuiPatcher.ResourceFingerprint(box.XpuiPath));
        XpuiPatcher.Remove(box.XpuiPath);
        Assert.Equal(css, Encoding.UTF8.GetString(Sandbox.ReadEntryBytes(box.XpuiPath, "xpui.css")));
    }

    [Fact]
    public void Legacy_patches_without_a_rewrite_version_are_undone_using_their_original_rules()
    {
        using var box = new Sandbox(index: null);
        const string original = "/* .GeneratedHash */ .GeneratedHash{content:'.GeneratedHash';background:url(.GeneratedHash.svg)}";
        Sandbox.CreateSpa(box.XpuiPath, Sandbox.SampleIndex, false, ("xpui.css", original));
        var fingerprint = XpuiPatcher.ResourceFingerprint(box.XpuiPath);
        Sandbox.ReplaceEntry(box.XpuiPath, "xpui.css", original.Replace(".GeneratedHash", ".main-view-panel"));
        Sandbox.ReplaceEntry(box.XpuiPath, XpuiPatcher.ClassMapManifestEntry, """
            {"spotifyVersion":"1.2.3.4","applied":[{"generated":"GeneratedHash","stable":"main-view-panel",
            "files":[{"entry":"xpui.css","count":4}]}],"skipped":[]}
            """);
        Assert.Null(XpuiPatcher.ReadClassMap(box.XpuiPath)!.RewriteVersion);
        Assert.Equal(fingerprint, XpuiPatcher.ResourceFingerprint(box.XpuiPath));
        XpuiPatcher.Remove(box.XpuiPath);
        Assert.Equal(original, Encoding.UTF8.GetString(Sandbox.ReadEntryBytes(box.XpuiPath, "xpui.css")));
    }

    [Theory]
    [InlineData(0x0100000c, "arm64")]
    [InlineData(0x01000007, "x64")]
    public void Architecture_comes_from_the_target_Mach_header(uint cpu, string expected)
    {
        using var box = new Sandbox();
        var file = Path.Combine(box.Root, "executable");
        var header = new byte[32];
        BinaryPrimitives.WriteUInt32LittleEndian(header, 0xfeedfacf);
        BinaryPrimitives.WriteUInt32LittleEndian(header.AsSpan(4), cpu);
        File.WriteAllBytes(file, header);
        Assert.Equal(expected, SpotifyBuildDetector.MachArchitecture(file));
    }

    [Fact]
    public void Backup_matching_rejects_different_architectures_and_builds()
    {
        using var box = new Sandbox();
        var client = new SpotifyService(box.Paths).Detect();
        var backup = new BackupService(box.Paths).Create(client, BackupKind.Manual);
        Assert.NotNull(BackupService.RestoreBlocker(backup, client with { Build = client.Build! with { Architecture = "different" } }));
        Assert.NotNull(BackupService.RestoreBlocker(backup, client with { Build = client.Build! with { ResourceFingerprint = Fingerprint } }));
    }
}

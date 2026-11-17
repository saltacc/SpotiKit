using System;
using System.IO;
using Xunit;

namespace SpotiKit.Tests;

public class MacSpotifyFixtureSourceTests
{
    [Fact]
    public void Missing_optional_sources_are_unavailable_instead_of_counting_as_executed_tests()
    {
        using var box = new Sandbox();
        var absent = Path.Combine(box.Root, "Absent.app");
        Assert.False(MacSpotifyFixtureSource.IsConfiguredOrAvailable(null, [absent]));
        Assert.Null(MacSpotifyFixtureSource.Resolve(null, [absent]));
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("DoesNotExist.app")]
    public void Invalid_explicit_sources_fail_instead_of_falling_back_to_an_installed_app(string configured)
    {
        using var box = new Sandbox();
        var validFallback = CreateCandidate(box);
        Assert.True(MacSpotifyFixtureSource.IsConfiguredOrAvailable(configured, [validFallback]));
        var error = Assert.Throws<InvalidOperationException>(() => MacSpotifyFixtureSource.Resolve(configured, [validFallback]));
        Assert.Contains(MacSpotifyFixtureSource.Variable, error.Message);
    }

    [Fact]
    public void An_incomplete_explicit_bundle_fails_before_an_integration_copy_is_created()
    {
        using var box = new Sandbox();
        var incomplete = Path.Combine(box.Root, "Incomplete.app");
        Directory.CreateDirectory(incomplete);
        Assert.True(MacSpotifyFixtureSource.IsConfiguredOrAvailable(incomplete, []));
        Assert.Throws<InvalidOperationException>(() => MacSpotifyFixtureSource.Resolve(incomplete, []));
    }

    [Fact]
    public void An_explicit_complete_bundle_is_selected_without_consulting_the_default_app()
    {
        using var box = new Sandbox();
        var candidate = CreateCandidate(box);
        Assert.True(MacSpotifyFixtureSource.IsConfiguredOrAvailable(candidate, []));
        Assert.Equal(candidate, MacSpotifyFixtureSource.Resolve(candidate, []));
        Assert.Equal(candidate, MacSpotifyFixtureSource.Resolve(null, [Path.Combine(box.Root, "Absent.app"), candidate]));
    }

    private static string CreateCandidate(Sandbox box)
    {
        var bundle = Path.Combine(box.Root, "Fixture.app");
        foreach (var relative in new[] { "Contents/Info.plist", "Contents/MacOS/Spotify", "Contents/Resources/Apps/xpui.spa",
                     "Contents/Frameworks/Chromium Embedded Framework.framework/Chromium Embedded Framework" })
        {
            var path = Path.Combine(bundle, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, "owned structural fixture");
        }
        return bundle;
    }
}

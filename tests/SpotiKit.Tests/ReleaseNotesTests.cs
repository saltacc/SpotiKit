using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class ReleaseNotesTests
{
    [Fact]
    public void Generated_notes_lose_their_markdown_and_the_changelog_link()
    {
        const string body = "## What's new\r\n\r\n* **Faster start**: the app opens in half the time\r\n" +
                            "- Fixed the [window buttons](https://example.com/pr/1) in `Liquify`\r\n\r\n\r\n" +
                            "**Full Changelog**: https://github.com/NMWplays/SpotiKit/commits/v0.9.1";

        Assert.Equal("What's new\n\n• Faster start: the app opens in half the time\n• Fixed the window buttons in Liquify",
            ReleaseNotes.ToPlainText(body));
    }

    [Fact]
    public void Only_a_changelog_link_leaves_nothing_to_show()
    {
        Assert.Null(ReleaseNotes.ToPlainText("**Full Changelog**: https://github.com/NMWplays/SpotiKit/commits/v0.9.1"));
        Assert.Null(ReleaseNotes.ToPlainText(null));
    }

    [Fact]
    public void Words_with_underscores_and_stars_in_the_middle_stay()
    {
        Assert.Equal("Uses spotify_versions.json and 2*3 rows", ReleaseNotes.ToPlainText("Uses spotify_versions.json and 2*3 rows"));
    }
}

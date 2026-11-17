using System.Collections.Generic;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class CssClassRenamerTests
{
    private const string Generated = "AbCdEf0123456789_hash";
    private static readonly IReadOnlyDictionary<string, string> Map = new Dictionary<string, string>
    {
        [Generated] = "main-view-panel",
        ["OtherHash"] = "player-controls",
    };

    [Fact]
    public void Classes_are_renamed_in_nested_selectors_supports_and_media_queries()
    {
        var original = "@supports selector(:is(." + Generated + ",.OtherHash)){@media (width>1.5px){." + Generated +
            "{color:red;&>.OtherHash:hover{color:blue}}}}";
        var counts = new Dictionary<string, int>();
        var result = CssClassRenamer.Rename(original, Map, counts);
        Assert.Equal("@supports selector(:is(.main-view-panel,.player-controls)){@media (width>1.5px){.main-view-panel" +
            "{color:red;&>.player-controls:hover{color:blue}}}}", result);
        Assert.Equal(2, counts[Generated]);
        Assert.Equal(2, counts["OtherHash"]);
    }

    [Fact]
    public void Comments_and_all_quoted_strings_are_preserved_exactly()
    {
        var original = "/* ." + Generated + " */ ." + Generated + "[data-value='." + Generated +
            "']{content:\"." + Generated + "\";--sample:'.OtherHash';} /* .OtherHash */";
        var counts = new Dictionary<string, int>();
        var result = CssClassRenamer.Rename(original, Map, counts);
        Assert.Equal(original.Replace("*/ ." + Generated + "[", "*/ .main-view-panel["), result);
        Assert.Single(counts);
        Assert.Equal(1, counts[Generated]);
    }

    [Fact]
    public void Escaped_quotes_and_line_continuations_do_not_end_strings()
    {
        var original = "." + Generated + "{content:'escaped \\' .OtherHash and \\\r\n." + Generated +
            "';--double:\"escaped \\\" .OtherHash\";} .OtherHash{}";
        var counts = new Dictionary<string, int>();
        var result = CssClassRenamer.Rename(original, Map, counts);
        Assert.StartsWith(".main-view-panel{", result);
        Assert.Contains("content:'escaped \\' .OtherHash and \\\r\n." + Generated + "'", result);
        Assert.EndsWith(" .player-controls{}", result);
        Assert.Equal(1, counts[Generated]);
        Assert.Equal(1, counts["OtherHash"]);
    }

    [Theory]
    [InlineData("url(assets/.OtherHash.svg)")]
    [InlineData("url('assets/.OtherHash.svg')")]
    [InlineData("url(\"assets/.OtherHash.svg\")")]
    [InlineData("URL(assets/.OtherHash.svg)")]
    [InlineData("uRl /* gap .OtherHash */ (assets/.OtherHash.svg)")]
    [InlineData("u\\72l(assets/.OtherHash.svg)")]
    [InlineData("\\75 rl(assets/.OtherHash.svg)")]
    [InlineData("url(data:image/svg+xml;utf8,<svg><g transform='x(.OtherHash)'></g></svg>)")]
    [InlineData("url(a(b(c(.OtherHash))).svg)")]
    [InlineData("url(assets/escaped\\).OtherHash.svg)")]
    public void Url_contents_are_never_rewritten(string url)
    {
        var original = "." + Generated + "{background:" + url + "} .OtherHash{}";
        var counts = new Dictionary<string, int>();
        var result = CssClassRenamer.Rename(original, Map, counts);
        Assert.Equal(".main-view-panel{background:" + url + "} .player-controls{}", result);
        Assert.Equal(1, counts["OtherHash"]);
        Assert.Equal(1, counts[Generated]);
    }

    [Fact]
    public void Function_names_that_only_contain_url_do_not_hide_selectors()
    {
        var original = "@supports selector(myurl(.OtherHash)){.url ." + Generated + "{}}";
        var counts = new Dictionary<string, int>();
        var result = CssClassRenamer.Rename(original, Map, counts);
        Assert.Equal("@supports selector(myurl(.player-controls)){.url .main-view-panel{}}", result);
        Assert.Equal(1, counts["OtherHash"]);
    }

    [Fact]
    public void A_mapping_cannot_match_a_longer_or_escaped_identifier_by_prefix()
    {
        var unchanged = "." + Generated + "x,." + Generated + "-suffix,." + Generated + "_suffix,." + Generated +
            "123,." + Generated + "é,." + Generated + @"\:suffix,." + Generated + @"\20 suffix";
        var counts = new Dictionary<string, int>();
        var result = CssClassRenamer.Rename(unchanged + ",." + Generated + "{}", Map, counts);
        Assert.Equal(unchanged + ",.main-view-panel{}", result);
        Assert.Equal(1, counts[Generated]);
    }

    [Fact]
    public void Escaped_dots_inside_identifiers_are_not_class_delimiters()
    {
        var original = @"#an-id\.OtherHash{color:red}.OtherHash{}";
        var counts = new Dictionary<string, int>();
        Assert.Equal(@"#an-id\.OtherHash{color:red}.player-controls{}", CssClassRenamer.Rename(original, Map, counts));
        Assert.Equal(1, counts["OtherHash"]);
    }

    [Fact]
    public void Counts_include_every_repeated_token_and_accumulate_with_existing_counts()
    {
        var counts = new Dictionary<string, int> { ["OtherHash"] = 3 };
        var result = CssClassRenamer.Rename(".OtherHash.OtherHash,.OtherHash:has(.OtherHash){}", Map, counts);
        Assert.Equal(".player-controls.player-controls,.player-controls:has(.player-controls){}", result);
        Assert.Equal(7, counts["OtherHash"]);
    }

    [Theory]
    [InlineData("/* .OtherHash")]
    [InlineData("'unterminated .OtherHash")]
    [InlineData("\"unterminated .OtherHash")]
    [InlineData("url(unterminated(.OtherHash)")]
    public void Unterminated_opaque_regions_do_not_expose_their_remaining_contents(string tail)
    {
        var counts = new Dictionary<string, int>();
        Assert.Equal(".player-controls{} " + tail, CssClassRenamer.Rename(".OtherHash{} " + tail, Map, counts));
        Assert.Equal(1, counts["OtherHash"]);
    }

    [Fact]
    public void Collect_and_rename_use_the_same_lexical_boundaries()
    {
        var original = "/* .comment */ ." + Generated + ":is(.OtherHash,.longerSuffix){content:'.literal';" +
            "background:url(.asset)}";
        var classes = CssClassRenamer.CollectClasses(original);
        Assert.Equal(3, classes.Count);
        Assert.Contains(Generated, classes);
        Assert.Contains("OtherHash", classes);
        Assert.Contains("longerSuffix", classes);
        Assert.DoesNotContain("comment", classes);
        Assert.DoesNotContain("literal", classes);
        Assert.DoesNotContain("asset", classes);
    }

    [Fact]
    public void Reversal_restores_the_exact_original_including_whitespace_and_opaque_regions()
    {
        var original = "\uFEFF/* preserve .OtherHash */\r\n@supports selector(." + Generated + ") {\r\n" +
            "  .OtherHash::before {content: \"\\\".OtherHash\"; background: url(assets/.OtherHash.png)}\r\n}\r\n";
        var forwardCounts = new Dictionary<string, int>();
        var patched = CssClassRenamer.Rename(original, Map, forwardCounts);
        var reverseCounts = new Dictionary<string, int>();
        var restored = CssClassRenamer.Rename(patched, new Dictionary<string, string>
        {
            ["main-view-panel"] = Generated, ["player-controls"] = "OtherHash",
        }, reverseCounts);
        Assert.Equal(original, restored);
        Assert.Equal(forwardCounts[Generated], reverseCounts["main-view-panel"]);
        Assert.Equal(forwardCounts["OtherHash"], reverseCounts["player-controls"]);
    }

    [Fact]
    public void A_string_without_a_mapped_token_is_returned_without_changes()
    {
        var original = "/* .OtherHash */ .untouched{background:url(.OtherHash)}";
        var counts = new Dictionary<string, int>();
        Assert.Same(original, CssClassRenamer.Rename(original, Map, counts));
        Assert.Empty(counts);
    }
}

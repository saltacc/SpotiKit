using System;
using System.Linq;
using System.Text.RegularExpressions;

namespace SpotiKit.Services;

public static partial class ReleaseNotes
{
    [GeneratedRegex(@"\[([^\]]+)\]\([^)]+\)")]
    private static partial Regex Link();

    [GeneratedRegex(@"(\*\*|__)(.+?)\1")]
    private static partial Regex Bold();

    [GeneratedRegex(@"(?<![\w*])[*_](?!\s)(.+?)(?<!\s)[*_](?![\w*])")]
    private static partial Regex Italic();

    [GeneratedRegex(@"^\s*[-*+]\s+")]
    private static partial Regex Bullet();

    [GeneratedRegex(@"^\s*#{1,6}\s*")]
    private static partial Regex Heading();

    public static string? ToPlainText(string? markdown)
    {
        if (string.IsNullOrWhiteSpace(markdown))
            return null;

        var lines = markdown.Replace("\r\n", "\n").Split('\n')
            .Where(line => !line.TrimStart().StartsWith("**Full Changelog**", StringComparison.OrdinalIgnoreCase))
            .Where(line => !line.TrimStart().StartsWith("<!--", StringComparison.Ordinal))
            .Select(line =>
            {
                var text = Bullet().IsMatch(line) ? "• " + Bullet().Replace(line, "") : Heading().Replace(line, "");
                text = Link().Replace(text, "$1");
                text = Bold().Replace(text, "$2");
                text = Italic().Replace(text, "$1");
                return text.Replace("`", "").TrimEnd();
            });

        var result = Regex.Replace(string.Join("\n", lines), @"\n{3,}", "\n\n").Trim();
        return result.Length == 0 ? null : result;
    }
}

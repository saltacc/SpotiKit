using System;
using System.Collections.Generic;
using System.Text;

namespace SpotiKit.Services;

internal static class CssClassRenamer
{
    public static string Rename(string text, IReadOnlyDictionary<string, string> mapping, Dictionary<string, int> counts)
    {
        ArgumentNullException.ThrowIfNull(text);
        ArgumentNullException.ThrowIfNull(mapping);
        ArgumentNullException.ThrowIfNull(counts);
        if (mapping.Count == 0) return text;
        StringBuilder? result = null;
        var copied = 0;
        foreach (var token in ClassTokens(text))
        {
            if (!mapping.TryGetValue(token.Name, out var replacement)) continue;
            counts[token.Name] = counts.GetValueOrDefault(token.Name) + 1;
            if (replacement == token.Name) continue;
            if (string.IsNullOrEmpty(replacement))
                throw new ArgumentException("A replacement class name must not be empty.", nameof(mapping));
            result ??= new StringBuilder(text.Length);
            result.Append(text, copied, token.Start - copied);
            result.Append(replacement);
            copied = token.Start + token.Length;
        }
        if (result is null) return text;
        result.Append(text, copied, text.Length - copied);
        return result.ToString();
    }

    public static IReadOnlySet<string> CollectClasses(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        var classes = new HashSet<string>(StringComparer.Ordinal);
        foreach (var token in ClassTokens(text)) classes.Add(token.Name);
        return classes;
    }

    private static IEnumerable<ClassToken> ClassTokens(string text)
    {
        var i = 0;
        while (i < text.Length)
        {
            if (IsComment(text, i)) { i = SkipComment(text, i); continue; }
            if (text[i] is '\'' or '"') { i = SkipString(text, i); continue; }
            if (text[i] == '.' && StartsIdentifier(text, i + 1))
            {
                var end = IdentifierEnd(text, i + 1);
                // Keep the raw spelling. Consuming escapes prevents a plain-name
                // mapping from rewriting only the prefix of an escaped identifier.
                yield return new(i + 1, end - i - 1, text.Substring(i + 1, end - i - 1));
                i = end;
                continue;
            }
            if (StartsIdentifier(text, i))
            {
                var end = IdentifierEnd(text, i);
                if (IsUrlName(text, i, end))
                {
                    var open = SkipTrivia(text, end);
                    if (open < text.Length && text[open] == '(')
                    {
                        i = SkipUrl(text, open);
                        continue;
                    }
                }
                i = end;
                continue;
            }
            if (ValidEscape(text, i)) { i = EscapeEnd(text, i); continue; }
            i++;
        }
    }

    private static bool StartsIdentifier(string text, int i)
    {
        if (i >= text.Length) return false;
        if (NameStart(text[i]) || ValidEscape(text, i)) return true;
        return text[i] == '-' && i + 1 < text.Length &&
            (NameStart(text[i + 1]) || text[i + 1] == '-' || ValidEscape(text, i + 1));
    }

    private static int IdentifierEnd(string text, int i)
    {
        while (i < text.Length)
        {
            if (NameCharacter(text[i])) i++;
            else if (ValidEscape(text, i)) i = EscapeEnd(text, i);
            else break;
        }
        return i;
    }

    private static bool NameStart(char value) => value is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or '_' || value >= '\u0080';
    private static bool NameCharacter(char value) => NameStart(value) || value is >= '0' and <= '9' or '-';
    private static bool WhiteSpace(char value) => value is ' ' or '\t' or '\r' or '\n' or '\f';
    private static bool Hex(char value) => value is >= '0' and <= '9' or >= 'a' and <= 'f' or >= 'A' and <= 'F';
    private static bool ValidEscape(string text, int i) => i >= 0 && i + 1 < text.Length && text[i] == '\\' && text[i + 1] is not ('\r' or '\n' or '\f');

    private static int EscapeEnd(string text, int i)
    {
        i++;
        if (i >= text.Length) return i;
        if (!Hex(text[i])) return i + 1;
        var digits = 0;
        while (i < text.Length && digits < 6 && Hex(text[i])) { i++; digits++; }
        if (i < text.Length && WhiteSpace(text[i]))
        {
            if (text[i] == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
            i++;
        }
        return i;
    }

    private static bool IsComment(string text, int i) => i + 1 < text.Length && text[i] == '/' && text[i + 1] == '*';

    private static int SkipComment(string text, int start)
    {
        var end = text.IndexOf("*/", start + 2, StringComparison.Ordinal);
        return end < 0 ? text.Length : end + 2;
    }

    private static int SkipString(string text, int start)
    {
        var quote = text[start];
        var i = start + 1;
        while (i < text.Length)
        {
            if (text[i] == '\\')
            {
                i++;
                if (i < text.Length && text[i] == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
                if (i < text.Length) i++;
            }
            else if (text[i++] == quote) return i;
        }
        return text.Length;
    }

    private static int SkipTrivia(string text, int i)
    {
        while (i < text.Length)
        {
            if (WhiteSpace(text[i])) i++;
            else if (IsComment(text, i)) i = SkipComment(text, i);
            else break;
        }
        return i;
    }

    private static int SkipUrl(string text, int open)
    {
        var depth = 1;
        var i = open + 1;
        while (i < text.Length)
        {
            if (IsComment(text, i)) { i = SkipComment(text, i); continue; }
            if (text[i] is '\'' or '"') { i = SkipString(text, i); continue; }
            if (text[i] == '\\') { i = EscapeEnd(text, i); continue; }
            if (text[i] == '(') depth++;
            else if (text[i] == ')' && --depth == 0) return i + 1;
            i++;
        }
        return text.Length;
    }

    private static bool IsUrlName(string text, int start, int end)
    {
        if (end - start == 3 && text.AsSpan(start, 3).Equals("url", StringComparison.OrdinalIgnoreCase)) return true;
        if (text.IndexOf('\\', start, end - start) < 0) return false;
        const string expected = "url";
        var letter = 0;
        var i = start;
        while (i < end && letter < expected.Length)
        {
            var value = (int)text[i++];
            if (value == '\\')
            {
                if (i >= end) return false;
                if (Hex(text[i]))
                {
                    value = 0;
                    var digits = 0;
                    while (i < end && digits++ < 6 && Hex(text[i]))
                    {
                        var character = char.ToLowerInvariant(text[i++]);
                        value = value * 16 + (character <= '9' ? character - '0' : character - 'a' + 10);
                    }
                    if (i < end && WhiteSpace(text[i]))
                    {
                        if (text[i] == '\r' && i + 1 < end && text[i + 1] == '\n') i++;
                        i++;
                    }
                }
                else value = text[i++];
            }
            if (value > 127 || char.ToLowerInvariant((char)value) != expected[letter++]) return false;
        }
        return i == end && letter == expected.Length;
    }

    private readonly record struct ClassToken(int Start, int Length, string Name);
}

using System;
using System.Linq;
using System.Text.RegularExpressions;

namespace SpotiKit.Services;

public static partial class VersionRange
{
    [GeneratedRegex(@"^\s*(\d+(?:\.\d+)*)\s*(?:-\s*(\d+(?:\.\d+)*)\s*)?$")]
    private static partial Regex Pattern();

    [GeneratedRegex(@"^\d+(\.\d+)*")]
    private static partial Regex Numbers();

    public static bool IsValid(string? range) => Contains("0", range) is not null;

    public static string Describe(string range)
    {
        var m = Pattern().Match(range);
        return m.Groups[2].Success && m.Groups[2].Value != m.Groups[1].Value
            ? $"{m.Groups[1].Value} to {m.Groups[2].Value}"
            : m.Groups[1].Value;
    }

    public static bool? Contains(string? version, string? range)
    {
        var m = Pattern().Match(range ?? "");
        if (!m.Success)
            return null;
        var from = Parts(m.Groups[1].Value);
        var to = m.Groups[2].Success ? Parts(m.Groups[2].Value) : from;
        if (Compare(from, to) > 0 && Compare(to, from) < 0)
            return null;
        var actual = Parts(Numbers().Match(version ?? "").Value);
        return Compare(actual, from) >= 0 && Compare(actual, to) <= 0;
    }

    public static int CompareVersions(string? a, string? b)
    {
        var x = Parts(Numbers().Match(a ?? "").Value);
        var y = Parts(Numbers().Match(b ?? "").Value);
        for (var i = 0; i < Math.Max(x.Length, y.Length); i++)
        {
            var c = (i < x.Length ? x[i] : 0).CompareTo(i < y.Length ? y[i] : 0);
            if (c != 0)
                return c;
        }
        return 0;
    }

    private static int[] Parts(string text) =>
        text.Length == 0 ? [] : text.Split('.').Select(p => int.TryParse(p, out var n) ? n : 0).ToArray();

    private static int Compare(int[] actual, int[] end)
    {
        for (var i = 0; i < end.Length; i++)
        {
            var a = i < actual.Length ? actual[i] : 0;
            if (a != end[i])
                return a.CompareTo(end[i]);
        }
        return 0;
    }
}

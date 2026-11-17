using System;
using System.Linq;

namespace SpotiKit.Services;

public readonly record struct SemanticVersion(int Major, int Minor, int Patch, string[] Prerelease)
    : IComparable<SemanticVersion>
{
    private string[] Pre => Prerelease ?? [];

    public bool IsPrerelease => Pre.Length > 0;

    public static bool TryParse(string? text, out SemanticVersion version)
    {
        version = default;
        if (string.IsNullOrWhiteSpace(text))
            return false;

        var value = text.Trim().TrimStart('v', 'V');
        var plus = value.IndexOf('+');
        if (plus >= 0)
            value = value[..plus];

        var dash = value.IndexOf('-');
        var core = dash >= 0 ? value[..dash] : value;
        var pre = dash >= 0 ? value[(dash + 1)..].Split('.', StringSplitOptions.RemoveEmptyEntries) : [];

        var parts = core.Split('.');
        if (parts.Length is < 1 or > 3 || !parts.All(p => int.TryParse(p, out _)))
            return false;

        var numbers = parts.Select(int.Parse).Concat(Enumerable.Repeat(0, 3)).Take(3).ToArray();
        version = new SemanticVersion(numbers[0], numbers[1], numbers[2], pre);
        return true;
    }

    public int CompareTo(SemanticVersion other)
    {
        var core = (Major, Minor, Patch).CompareTo((other.Major, other.Minor, other.Patch));
        if (core != 0)
            return core;

        if (!IsPrerelease || !other.IsPrerelease)
            return other.IsPrerelease.CompareTo(IsPrerelease);

        for (var i = 0; i < Math.Min(Pre.Length, other.Pre.Length); i++)
        {
            var a = Pre[i];
            var b = other.Pre[i];
            var aNumeric = int.TryParse(a, out var an);
            var bNumeric = int.TryParse(b, out var bn);
            var result = (aNumeric, bNumeric) switch
            {
                (true, true) => an.CompareTo(bn),
                (true, false) => -1,
                (false, true) => 1,
                _ => string.CompareOrdinal(a, b),
            };
            if (result != 0)
                return result;
        }

        return Pre.Length.CompareTo(other.Pre.Length);
    }

    public static bool operator >(SemanticVersion a, SemanticVersion b) => a.CompareTo(b) > 0;
    public static bool operator <(SemanticVersion a, SemanticVersion b) => a.CompareTo(b) < 0;

    public override string ToString() =>
        $"{Major}.{Minor}.{Patch}" + (IsPrerelease ? "-" + string.Join('.', Pre) : "");
}

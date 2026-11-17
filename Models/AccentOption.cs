using System.Collections.Generic;

namespace SpotiKit.Models;

public sealed record AccentOption(string Name, string Color)
{
    public const string CustomName = "Custom";

    public static AccentOption Default { get; } = new("Midnight", "#4C6FFF");

    public static IReadOnlyList<AccentOption> All { get; } =
    [
        Default,
        new("Sky", "#2E9BF0"),
        new("Teal", "#1FAE96"),
        new("Mint", "#34C47C"),
        new("Lime", "#8CC63F"),
        new("Gold", "#D9A520"),
        new("Amber", "#E8893C"),
        new("Coral", "#F2665A"),
        new("Rose", "#E8508A"),
        new("Orchid", "#C25BD9"),
        new("Violet", "#9A6BFF"),
    ];
}

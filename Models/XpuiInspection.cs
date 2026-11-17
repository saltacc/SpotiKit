using System.Collections.Generic;

namespace SpotiKit.Models;

public sealed record XpuiInspection(
    bool IsReadable,
    bool HasIndex,
    bool HasBodyAnchor,
    bool HasSpotiKit,
    string? SpotiKitVersion,
    bool HasLoaderFile,
    IReadOnlyList<string> ForeignMods,
    int EntryCount,
    string? Error = null)
{
    public bool HasClassMap { get; init; }

    public static XpuiInspection Unreadable(string error) =>
        new(false, false, false, false, null, false, [], 0, error);

    public bool IsPatchable => IsReadable && HasIndex && HasBodyAnchor && ForeignMods.Count == 0;
}

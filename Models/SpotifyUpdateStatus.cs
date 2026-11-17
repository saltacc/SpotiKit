namespace SpotiKit.Models;

public enum UpdateHoldState
{
    Allowed,

    UpdateStaged,

    HeldBySpotiKit,

    HeldByOtherTool,

    NotSupported,
}

public sealed record SpotifyUpdateStatus(
    UpdateHoldState State,
    string UpdatePath,
    string? StagedVersion,
    UpdateHoldRecord? Hold,
    bool UpdatedDespiteHold);

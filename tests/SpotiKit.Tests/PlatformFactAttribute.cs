using System;
using Xunit;

namespace SpotiKit.Tests;

public sealed class WindowsFactAttribute : FactAttribute
{
    public WindowsFactAttribute()
    {
        if (!OperatingSystem.IsWindows())
            Skip = "Requires Windows executable replacement or file-system ACLs.";
    }
}

public sealed class MacOSFactAttribute : FactAttribute
{
    public MacOSFactAttribute()
    {
        if (!OperatingSystem.IsMacOS())
            Skip = "Requires macOS bundle tools.";
    }
}

public sealed class MacSpotifyFactAttribute : FactAttribute
{
    public MacSpotifyFactAttribute()
    {
        if (!OperatingSystem.IsMacOS())
            Skip = "Requires macOS and an external Spotify .app fixture.";
        else if (!MacSpotifyFixtureSource.IsAvailable)
            Skip = $"No complete Spotify .app fixture was found. Set {MacSpotifyFixtureSource.Variable} to a local bundle to run this integration test.";
    }
}

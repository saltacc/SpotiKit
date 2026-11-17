using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using SpotiKit.Models;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

internal static class MacSpotifyFixtureSource
{
    public const string Variable = "SPOTIKIT_TEST_SPOTIFY_BUNDLE";

    private static IEnumerable<string> DefaultCandidates =>
    [
        "/Applications/Spotify.app",
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Applications", "Spotify.app"),
    ];

    // An explicitly configured path must execute the test and fail validation, even if it is invalid.
    public static bool IsAvailable => IsConfiguredOrAvailable(Environment.GetEnvironmentVariable(Variable), DefaultCandidates);

    internal static bool IsConfiguredOrAvailable(string? configured, IEnumerable<string> candidates) =>
        configured is not null || candidates.Any(IsCompleteCandidate);

    public static string Require() => Resolve(Environment.GetEnvironmentVariable(Variable), DefaultCandidates)
        ?? throw new InvalidOperationException($"No complete Spotify fixture is available. Set {Variable} to a local .app bundle.");

    internal static string? Resolve(string? configured, IEnumerable<string> candidates)
    {
        if (configured is null)
            return candidates.FirstOrDefault(IsCompleteCandidate);
        if (string.IsNullOrWhiteSpace(configured))
            throw new InvalidOperationException($"{Variable} is set but empty. Provide a complete local Spotify .app bundle or unset it to skip optional integration tests.");
        var path = Path.TrimEndingDirectorySeparator(Path.GetFullPath(configured));
        if (!IsCompleteCandidate(path))
            throw new InvalidOperationException($"{Variable} points to an invalid or incomplete Spotify .app bundle: {path}");
        return path;
    }

    private static bool IsCompleteCandidate(string path) =>
        path.EndsWith(".app", StringComparison.OrdinalIgnoreCase) && MacBundleFiles.IsComplete(path);
}

// All writes, signing, backups and restores stay under this temporary root. The source is read only.
internal sealed class MacSpotifyFixture : IDisposable
{
    private readonly Sandbox sandbox = new();

    public MacSpotifyFixture(bool patched)
    {
        try
        {
            Source = MacSpotifyFixtureSource.Require();
            SourceArchive = Path.Combine(Source, "Contents", "Resources", "Apps", "xpui.spa");
            SourceArchiveHash = FileHash.Sha256(SourceArchive);
            SourceFingerprint = MacBundleFiles.Fingerprint(Source);
            Bundle = Path.Combine(sandbox.Root, "Runtime.app");
            MacBundleFiles.Copy(Source, Bundle);
            Assert.Equal(SourceFingerprint, MacBundleFiles.Fingerprint(Bundle));
            var resources = Path.Combine(Bundle, "Contents", "Resources");
            Archive = Path.Combine(resources, "Apps", "xpui.spa");
            Paths = sandbox.Paths with { SpotifyDirOverride = resources };

            var inspection = XpuiPatcher.Inspect(Archive);
            Assert.True(inspection.IsPatchable, $"The Spotify fixture cannot be patched: {inspection.Error ?? string.Join(", ", inspection.ForeignMods)}");
            // The installed app may already contain SpotiKit. Establish a known clean state on the copy.
            var normalized = inspection.HasSpotiKit || inspection.HasLoaderFile || inspection.HasClassMap;
            SourceWasPristine = !normalized;
            if (normalized)
                XpuiPatcher.Remove(Archive);
            var signer = new MacBundleSigner();
            if (normalized)
                signer.SignAndVerify(Bundle);
            else
                signer.Verify(Bundle); // Preserve the vendor signature on an already pristine source.
            Assert.False(XpuiPatcher.Inspect(Archive).HasSpotiKit);
            CleanArchive = Path.Combine(sandbox.Root, "clean-xpui.spa");
            File.Copy(Archive, CleanArchive);
            if (patched)
            {
                var client = new SpotifyService(Paths).Detect(freshBuild: true);
                var selection = ClassMapCatalog.Bundled.Select(client);
                XpuiPatcher.Inject(Archive, "/* previous installation fixture */", "0.0.0-fixture",
                    selection.Mappings, client.Version, AddonSet.Empty, selection);
                signer.SignAndVerify(Bundle);
            }
            StartingArchiveHash = FileHash.Sha256(Archive);
            StartingFingerprint = MacBundleFiles.Fingerprint(Bundle);
        }
        catch
        {
            sandbox.Dispose();
            throw;
        }
    }

    public string Source { get; }
    public string SourceArchive { get; }
    public string SourceArchiveHash { get; }
    public string SourceFingerprint { get; }
    public bool SourceWasPristine { get; }
    public string Bundle { get; }
    public string Archive { get; }
    public string CleanArchive { get; }
    public string StartingArchiveHash { get; }
    public string StartingFingerprint { get; }
    public SpotiKitPaths Paths { get; }

    public void AssertSourceUnchanged()
    {
        Assert.Equal(SourceArchiveHash, FileHash.Sha256(SourceArchive));
        Assert.Equal(SourceFingerprint, MacBundleFiles.Fingerprint(Source));
    }

    public void AssertStartingBundleRestored()
    {
        Assert.Equal(StartingArchiveHash, FileHash.Sha256(Archive));
        Assert.Equal(StartingFingerprint, MacBundleFiles.Fingerprint(Bundle));
        new MacBundleSigner().Verify(Bundle);
    }

    public void Dispose() => sandbox.Dispose();
}

using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Xml.Linq;
using SpotiKit.Models;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class MacBundleTests
{
    [Fact]
    public void Signing_entitlements_keep_existing_values_and_add_only_the_library_exception()
    {
        const string original = "<plist version=\"1.0\"><dict><key>com.apple.security.cs.allow-jit</key><true/>" +
            "<key>example.array</key><array><string>one</string><string>two</string></array>" +
            "<key>example.dictionary</key><dict><key>nested</key><integer>42</integer></dict></dict></plist>";
        var signed = XDocument.Parse(MacBundleSigner.WithLibraryValidationException(original));
        var dictionary = signed.Root!.Element("dict")!;
        Assert.Equal("true", Value(dictionary, "com.apple.security.cs.allow-jit").Name.LocalName);
        Assert.Equal("true", Value(dictionary, "com.apple.security.cs.disable-library-validation").Name.LocalName);
        Assert.True(XNode.DeepEquals(Value(XDocument.Parse(original).Root!.Element("dict")!, "example.array"), Value(dictionary, "example.array")));
        Assert.True(XNode.DeepEquals(Value(XDocument.Parse(original).Root!.Element("dict")!, "example.dictionary"), Value(dictionary, "example.dictionary")));
        Assert.Equal(4, System.Linq.Enumerable.Count(dictionary.Elements("key")));
    }

    [Fact]
    public void An_empty_entitlement_set_and_an_existing_false_exception_are_supported()
    {
        var empty = XDocument.Parse(MacBundleSigner.WithLibraryValidationException(""));
        Assert.Equal("true", Value(empty.Root!.Element("dict")!, "com.apple.security.cs.disable-library-validation").Name.LocalName);
        var existing = XDocument.Parse(MacBundleSigner.WithLibraryValidationException(
            "<plist><dict><key>com.apple.security.cs.disable-library-validation</key><false/></dict></plist>"));
        Assert.Equal("true", Value(existing.Root!.Element("dict")!, "com.apple.security.cs.disable-library-validation").Name.LocalName);
        Assert.Single(existing.Root.Element("dict")!.Elements("key"));
        Assert.Throws<InvalidDataException>(() => MacBundleSigner.WithLibraryValidationException("<plist><array/></plist>"));
    }

    [MacOSFact]
    public void Native_signing_preserves_jit_and_runtime_flags_without_resigning_nested_code()
    {
        using var fixture = new OwnedBundle(jit: true);
        var frameworkHash = FileHash.Sha256(fixture.FrameworkExecutable);
        new MacBundleSigner().SignAndVerify(fixture.Bundle);
        var entitlements = MacBundleFiles.Run("/usr/bin/codesign", "-d", "--entitlements", "-", "--xml", fixture.Bundle);
        entitlements.EnsureSuccess("Read signed fixture");
        var dictionary = XDocument.Parse(entitlements.Output).Root!.Element("dict")!;
        Assert.Equal("true", Value(dictionary, "com.apple.security.cs.allow-jit").Name.LocalName);
        Assert.Equal("true", Value(dictionary, "com.apple.security.cs.allow-unsigned-executable-memory").Name.LocalName);
        Assert.Equal("true", Value(dictionary, "com.apple.security.cs.disable-library-validation").Name.LocalName);
        Assert.Equal(frameworkHash, FileHash.Sha256(fixture.FrameworkExecutable));
        var flags = MacBundleFiles.Run("/usr/bin/codesign", "-d", "--verbose=4", fixture.Bundle);
        Assert.Contains("runtime", flags.Error);
        Assert.Contains("Signature=adhoc", flags.Error);
    }

    [MacOSFact]
    public void Complete_bundle_copy_preserves_symlinks_permissions_and_signature()
    {
        if (!OperatingSystem.IsMacOS()) return;
        using var fixture = new OwnedBundle();
        var destination = Path.Combine(fixture.Root, "Copied Spotify.app");
        MacBundleFiles.Copy(fixture.Bundle, destination);
        Assert.Equal(MacBundleFiles.Fingerprint(fixture.Bundle), MacBundleFiles.Fingerprint(destination));
        Assert.Equal("A", new DirectoryInfo(Path.Combine(destination, "Contents/Frameworks/Chromium Embedded Framework.framework/Versions/Current")).LinkTarget);
        Assert.Equal(File.GetUnixFileMode(Path.Combine(fixture.Bundle, "Contents/MacOS/Spotify")), File.GetUnixFileMode(Path.Combine(destination, "Contents/MacOS/Spotify")));
        Assert.True(MacBundleFiles.Size(destination) > 0);
        new MacBundleSigner().Verify(destination);
        Assert.Throws<IOException>(() => MacBundleFiles.Copy(fixture.Bundle, destination));
        Assert.Throws<IOException>(() => MacBundleFiles.Copy(fixture.Bundle, Path.Combine(fixture.Bundle, "Nested.app")));
    }

    [MacOSFact]
    public void Commit_publishes_a_signed_complete_working_copy_and_preserves_build_identity()
    {
        using var fixture = new OwnedBundle();
        var original = FileHash.Sha256(fixture.Archive);
        using var transaction = new MacBundleTransaction(fixture.Client, () => false);
        Assert.Equal(fixture.Client.Build, transaction.WorkingClient.Build);
        Sandbox.ReplaceEntry(transaction.WorkingClient.XpuiPath!, "index.html", "<html><body>changed</body></html>");
        Assert.Equal(original, FileHash.Sha256(fixture.Archive));
        transaction.Commit();
        Assert.NotEqual(original, FileHash.Sha256(fixture.Archive));
        Assert.False(Directory.Exists(transaction.WorkingBundle));
        Assert.Null(transaction.RetainedRecoveryBundle);
        new MacBundleSigner().Verify(fixture.Bundle);
    }

    [MacOSFact]
    public void Restore_can_preserve_the_exact_existing_signature_and_remove_extra_files()
    {
        using var fixture = new OwnedBundle();
        var snapshot = Path.Combine(fixture.Root, "Original Snapshot.app");
        MacBundleFiles.Copy(fixture.Bundle, snapshot);
        var original = MacBundleFiles.Fingerprint(snapshot);
        File.WriteAllText(Path.Combine(fixture.Bundle, "Contents/Resources/stale-file"), "not in the backup");
        Sandbox.ReplaceEntry(fixture.Archive, "index.html", "<html><body>modified</body></html>");
        new MacBundleSigner().SignAndVerify(fixture.Bundle);
        using var transaction = new MacBundleTransaction(fixture.Client, () => false);
        transaction.ReplaceWorkingBundle(snapshot);
        transaction.Commit(sign: false);
        Assert.Equal(original, MacBundleFiles.Fingerprint(fixture.Bundle));
        Assert.False(File.Exists(Path.Combine(fixture.Bundle, "Contents/Resources/stale-file")));
    }

    [MacOSFact]
    public void An_update_during_staging_is_left_untouched()
    {
        using var fixture = new OwnedBundle();
        using var transaction = new MacBundleTransaction(fixture.Client, () => false);
        Sandbox.ReplaceEntry(fixture.Archive, "index.html", "<html><body>updated externally</body></html>");
        new MacBundleSigner().SignAndVerify(fixture.Bundle);
        var updated = MacBundleFiles.Fingerprint(fixture.Bundle);
        var failure = Assert.Throws<IOException>(() => transaction.Commit());
        Assert.Contains("changed", failure.Message);
        Assert.Equal(updated, MacBundleFiles.Fingerprint(fixture.Bundle));
        new MacBundleSigner().Verify(fixture.Bundle);
    }

    [MacOSFact]
    public void Running_targets_are_refused_at_start_and_again_before_publication()
    {
        using var fixture = new OwnedBundle();
        Assert.Throws<InvalidOperationException>(() => new MacBundleTransaction(fixture.Client, () => true));
        var running = false;
        var before = MacBundleFiles.Fingerprint(fixture.Bundle);
        using var transaction = new MacBundleTransaction(fixture.Client, () => running);
        running = true;
        Assert.Throws<InvalidOperationException>(() => transaction.Commit());
        Assert.Equal(before, MacBundleFiles.Fingerprint(fixture.Bundle));
    }

    [MacOSFact]
    public void A_failed_signature_verification_leaves_the_original_untouched()
    {
        using var fixture = new OwnedBundle();
        var before = MacBundleFiles.Fingerprint(fixture.Bundle);
        using var transaction = new MacBundleTransaction(fixture.Client, () => false);
        var framework = Path.Combine(transaction.WorkingBundle, "Contents/Frameworks/Chromium Embedded Framework.framework/Versions/A/Chromium Embedded Framework");
        File.AppendAllText(framework, "invalidate nested signature");
        Assert.Throws<IOException>(() => transaction.Commit());
        Assert.Equal(before, MacBundleFiles.Fingerprint(fixture.Bundle));
        new MacBundleSigner().Verify(fixture.Bundle);
    }

    [MacOSFact]
    public void Mutation_paths_cannot_be_symbolic_links_to_files_outside_the_bundle()
    {
        using var fixture = new OwnedBundle();
        var external = Path.Combine(fixture.Root, "external.spa");
        File.Move(fixture.Archive, external);
        File.CreateSymbolicLink(fixture.Archive, external);
        var before = FileHash.Sha256(external);
        Assert.False(MacBundleFiles.IsComplete(fixture.Bundle));
        Assert.Throws<InvalidOperationException>(() => new MacBundleSigner().SignAndVerify(fixture.Bundle));
        Assert.Throws<InvalidOperationException>(() => new MacBundleTransaction(fixture.Client, () => false));
        Assert.Equal(before, FileHash.Sha256(external));
    }

    [MacOSFact]
    public void Publication_failure_restores_the_exact_original_bundle()
    {
        using var fixture = new OwnedBundle();
        var before = MacBundleFiles.Fingerprint(fixture.Bundle);
        var moveCount = 0;
        using var transaction = new MacBundleTransaction(fixture.Client, () => false, null, (source, destination) =>
        {
            if (++moveCount == 2) throw new IOException("Injected publication failure");
            Directory.Move(source, destination);
        });
        Assert.Throws<IOException>(() => transaction.Commit());
        Assert.Equal(before, MacBundleFiles.Fingerprint(fixture.Bundle));
        new MacBundleSigner().Verify(fixture.Bundle);
    }

    [MacOSFact]
    public void Verification_after_publication_can_roll_back_to_the_exact_original()
    {
        using var fixture = new OwnedBundle();
        var before = MacBundleFiles.Fingerprint(fixture.Bundle);
        using var transaction = new MacBundleTransaction(fixture.Client, () => false, new FailPublishedVerification(fixture.Bundle));
        Sandbox.ReplaceEntry(transaction.WorkingClient.XpuiPath!, "index.html", "<html><body>changed</body></html>");
        Assert.Throws<IOException>(() => transaction.Commit());
        Assert.Equal(before, MacBundleFiles.Fingerprint(fixture.Bundle));
    }

    [MacOSFact]
    public void Failed_rollback_retains_a_valid_recovery_bundle_after_disposal()
    {
        using var fixture = new OwnedBundle();
        var before = MacBundleFiles.Fingerprint(fixture.Bundle);
        var moveCount = 0;
        var transaction = new MacBundleTransaction(fixture.Client, () => false, null, (source, destination) =>
        {
            if (++moveCount is 2 or 3) throw new IOException("Injected replacement and recovery failures");
            Directory.Move(source, destination);
        });
        var failure = Assert.Throws<IOException>(() => transaction.Commit());
        Assert.Contains("recovery app is retained", failure.Message);
        var recovery = transaction.RetainedRecoveryBundle;
        Assert.NotNull(recovery);
        transaction.Dispose();
        Assert.True(Directory.Exists(recovery));
        Assert.Equal(before, MacBundleFiles.Fingerprint(recovery!));
        new MacBundleSigner().Verify(recovery!);
    }

    private static XElement Value(XElement dictionary, string key)
    {
        foreach (var element in dictionary.Elements("key"))
            if (element.Value == key) return System.Linq.Enumerable.First(element.ElementsAfterSelf());
        throw new InvalidOperationException("Missing entitlement " + key);
    }

    private sealed class FailPublishedVerification(string target) : MacBundleSigner
    {
        private bool _failed;
        public override void Verify(string bundle)
        {
            base.Verify(bundle);
            if (bundle == target && !_failed)
            {
                _failed = true;
                throw new IOException("Injected verification failure after publication");
            }
        }
    }

    internal sealed class OwnedBundle : IDisposable
    {
        public OwnedBundle(bool jit = false)
        {
            Root = Path.Combine(Path.GetTempPath(), "spotikit-bundle-tests", Guid.NewGuid().ToString("N"));
            Bundle = Path.Combine(Root, "Spotify Test.app");
            var contents = Path.Combine(Bundle, "Contents");
            Directory.CreateDirectory(Path.Combine(contents, "MacOS"));
            Directory.CreateDirectory(Path.Combine(contents, "Resources/Apps"));
            File.Copy("/usr/bin/true", Path.Combine(contents, "MacOS/Spotify"));
            File.WriteAllText(Path.Combine(contents, "Info.plist"),
                "<plist version=\"1.0\"><dict><key>CFBundleIdentifier</key><string>dev.spotikit.bundle-test</string>" +
                "<key>CFBundleExecutable</key><string>Spotify</string><key>CFBundlePackageType</key><string>APPL</string>" +
                "<key>CFBundleShortVersionString</key><string>1.3.9.2055</string></dict></plist>");
            Archive = Path.Combine(contents, "Resources/Apps/xpui.spa");
            Sandbox.CreateSpa(Archive, Sandbox.SampleIndex);
            var framework = Path.Combine(contents, "Frameworks/Chromium Embedded Framework.framework");
            var frameworkVersion = Path.Combine(framework, "Versions/A");
            Directory.CreateDirectory(Path.Combine(frameworkVersion, "Resources"));
            FrameworkExecutable = Path.Combine(frameworkVersion, "Chromium Embedded Framework");
            File.Copy(Path.Combine(RuntimeEnvironment.GetRuntimeDirectory(), "libSystem.Native.dylib"), FrameworkExecutable);
            File.WriteAllText(Path.Combine(frameworkVersion, "Resources/Info.plist"),
                "<plist version=\"1.0\"><dict><key>CFBundleIdentifier</key><string>dev.spotikit.framework-test</string>" +
                "<key>CFBundleExecutable</key><string>Chromium Embedded Framework</string><key>CFBundlePackageType</key><string>FMWK</string>" +
                "<key>CFBundleVersion</key><string>1.0</string></dict></plist>");
            Directory.CreateSymbolicLink(Path.Combine(framework, "Versions/Current"), "A");
            File.CreateSymbolicLink(Path.Combine(framework, "Chromium Embedded Framework"), "Versions/Current/Chromium Embedded Framework");
            Directory.CreateSymbolicLink(Path.Combine(framework, "Resources"), "Versions/Current/Resources");
            MacBundleFiles.Run("/usr/bin/codesign", "--force", "--sign", "-", framework).EnsureSuccess("Sign owned framework fixture");
            if (jit)
            {
                var entitlements = Path.Combine(Root, "original-entitlements.plist");
                File.WriteAllText(entitlements,
                    "<plist><dict><key>com.apple.security.cs.allow-jit</key><true/>" +
                    "<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/></dict></plist>");
                MacBundleFiles.Run("/usr/bin/codesign", "--force", "--sign", "-", "--options", "runtime", "--entitlements", entitlements, Bundle)
                    .EnsureSuccess("Sign owned app fixture");
            }
            else MacBundleFiles.Run("/usr/bin/codesign", "--force", "--sign", "-", "--options", "runtime", Bundle).EnsureSuccess("Sign owned app fixture");
            new MacBundleSigner().Verify(Bundle);
            var resources = Path.Combine(contents, "Resources");
            Client = new SpotifyInstallation(SpotifyEdition.Desktop, "1.3.9.2055", resources, false,
                Path.Combine(contents, "MacOS/Spotify"), XpuiKind.Spa, Archive, XpuiPatcher.Inspect(Archive))
            {
                Build = SpotifyBuildDetector.Read(resources, Path.Combine(contents, "MacOS/Spotify"), Archive),
            };
        }

        public string Root { get; }
        public string Bundle { get; }
        public string Archive { get; }
        public string FrameworkExecutable { get; }
        public SpotifyInstallation Client { get; }

        public void Dispose()
        {
            if (Directory.Exists(Root)) Directory.Delete(Root, recursive: true);
        }
    }
}

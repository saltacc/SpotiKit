using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using SpotiKit.Services;
using Xunit;

namespace SpotiKit.Tests;

public class DevToolsTests
{
    private static byte[] SampleBnk(char xml = '0', char binary = '0') => Encoding.Latin1.GetBytes(
        "\x01\x02header<enabled-account-settings><app-developer>" + xml + "</app-developer><apply-child>1</apply-child>" +
        "\x00\x00enabled-account-settings\x09\x01" + "1x\x01\x0D" + "app-developer\x09\x01" + binary + "x\x01\x20" +
        "apply-child-content-restrictions\x09\x01" + "0x\x01");

    private static (DevToolsService Service, StateStore State, string Bnk) Create(Sandbox box, byte[]? content)
    {
        Directory.CreateDirectory(box.Paths.SpotifyLocalDataDir);
        var bnk = Path.Combine(box.Paths.SpotifyLocalDataDir, "offline.bnk");
        if (content is not null)
            File.WriteAllBytes(bnk, content);
        var state = new StateStore(box.Paths);
        return (new DevToolsService(box.Paths, new SpotifyService(box.Paths), state, new ActivityLog(box.Paths)), state, bnk);
    }

    [Fact]
    public void Enable_sets_both_flags_and_Disable_restores_the_file_byte_for_byte()
    {
        using var box = new Sandbox();
        var original = SampleBnk();
        var (devTools, state, bnk) = Create(box, original);
        Assert.Equal(DevToolsState.Disabled, devTools.GetStatus().State);

        devTools.Enable();

        var patched = Encoding.Latin1.GetString(File.ReadAllBytes(bnk));
        Assert.Contains("<app-developer>2</app-developer>", patched);
        Assert.Contains("app-developer\x09\x01" + "2x\x01", patched);
        Assert.Equal(original.Length, File.ReadAllBytes(bnk).Length);
        Assert.Equal(DevToolsState.Enabled, devTools.GetStatus().State);
        Assert.True(devTools.GetStatus().EnabledBySpotiKit);
        Assert.NotNull(state.Load().DevTools);

        devTools.Disable();

        Assert.Equal(original, File.ReadAllBytes(bnk));
        Assert.Null(state.Load().DevTools);
        Assert.Equal(DevToolsState.Disabled, devTools.GetStatus().State);
    }

    [MacOSFact]
    public void Mac_developer_tools_use_PersistentCache_and_restore_it_exactly()
    {
        using var box = new Sandbox();
        var original = SampleBnk();
        var (devTools, state, legacy) = Create(box, original);
        var cached = Path.Combine(box.Paths.SpotifyLocalDataDir, "PersistentCache", "offline.bnk");
        Directory.CreateDirectory(Path.GetDirectoryName(cached)!);
        File.Move(legacy, cached);
        Assert.Equal(cached, devTools.BnkPath);
        Assert.Equal(DevToolsState.Disabled, devTools.GetStatus().State);
        devTools.Enable();
        Assert.Equal(DevToolsState.Enabled, devTools.GetStatus().State);
        devTools.Disable();
        Assert.Equal(original, File.ReadAllBytes(cached));
        Assert.Null(state.Load().DevTools);
        Assert.False(File.Exists(legacy));
    }

    [MacOSFact]
    public void Mac_prefers_PersistentCache_when_a_stale_legacy_file_exists()
    {
        using var box = new Sandbox();
        var (devTools, _, legacy) = Create(box, Encoding.UTF8.GetBytes("stale legacy data"));
        var cached = Path.Combine(box.Paths.SpotifyLocalDataDir, "PersistentCache", "offline.bnk");
        Directory.CreateDirectory(Path.GetDirectoryName(cached)!);
        File.WriteAllBytes(cached, SampleBnk());
        Assert.Equal(cached, devTools.BnkPath);
        devTools.Enable();
        devTools.Disable();
        Assert.Equal("stale legacy data", File.ReadAllText(legacy));
    }

    [Fact]
    public void Legacy_files_and_local_data_overrides_still_resolve_inside_the_selected_directory()
    {
        using var box = new Sandbox();
        var (devTools, _, legacy) = Create(box, SampleBnk());
        Assert.Equal(legacy, devTools.BnkPath);
        var isolated = box.Paths with { SpotifyLocalDataDir = Path.Combine(box.Root, "empty-local-override") };
        var expected = OperatingSystem.IsMacOS()
            ? Path.Combine(isolated.SpotifyLocalDataDir, "PersistentCache", "offline.bnk")
            : Path.Combine(isolated.SpotifyLocalDataDir, "offline.bnk");
        Assert.Equal(expected, isolated.SpotifyOfflineBnkPath);
        Assert.False(File.Exists(isolated.SpotifyOfflineBnkPath));
    }

    [Fact]
    public void Disable_after_Spotify_rewrote_the_file_only_puts_the_two_values_back()
    {
        using var box = new Sandbox();
        var (devTools, _, bnk) = Create(box, SampleBnk(xml: '2', binary: '0'));
        devTools.Enable();

        var rewritten = Encoding.Latin1.GetString(File.ReadAllBytes(bnk)).Replace("header", "HEADER");
        File.WriteAllBytes(bnk, Encoding.Latin1.GetBytes(rewritten));

        devTools.Disable();

        var result = Encoding.Latin1.GetString(File.ReadAllBytes(bnk));
        Assert.Contains("HEADER", result);
        Assert.Contains("<app-developer>2</app-developer>", result);
        Assert.Contains("app-developer\x09\x01" + "0x\x01", result);
    }

    [Fact]
    public void Tools_stay_on_after_Spotify_turns_them_off_until_they_are_turned_off()
    {
        using var box = new Sandbox();
        var original = SampleBnk();
        var (devTools, state, bnk) = Create(box, original);
        devTools.Enable();

        var reset = Encoding.Latin1.GetString(File.ReadAllBytes(bnk)).Replace("header", "HEADER")
            .Replace("<app-developer>2<", "<app-developer>0<").Replace("app-developer	" + "2x", "app-developer	" + "0x");
        File.WriteAllBytes(bnk, Encoding.Latin1.GetBytes(reset));
        Assert.Equal(DevToolsState.Enabled, devTools.GetStatus().State);

        Assert.NotNull(devTools.KeepOn());
        var kept = Encoding.Latin1.GetString(File.ReadAllBytes(bnk));
        Assert.Contains("HEADER", kept);
        Assert.Contains("<app-developer>2</app-developer>", kept);
        Assert.Contains("app-developer	" + "2x", kept);
        Assert.Null(devTools.KeepOn());

        devTools.Disable();
        Assert.Null(state.Load().DevTools);
        Assert.Contains("<app-developer>0</app-developer>", Encoding.Latin1.GetString(File.ReadAllBytes(bnk)));
        Assert.Null(devTools.KeepOn());
        Assert.Equal(DevToolsState.Disabled, devTools.GetStatus().State);
    }

    [Fact]
    public void An_unknown_layout_is_refused_and_left_untouched()
    {
        using var box = new Sandbox();
        var content = Encoding.Latin1.GetBytes("<app-developer>0</app-developer> no binary record here");
        var (devTools, state, bnk) = Create(box, content);

        Assert.Equal(DevToolsState.Unrecognized, devTools.GetStatus().State);
        Assert.Throws<InvalidDataException>(() => devTools.Enable());
        Assert.Equal(content, File.ReadAllBytes(bnk));
        Assert.Null(state.Load().DevTools);
    }

    [Fact]
    public void Tools_turned_on_elsewhere_can_be_turned_off_with_a_backup()
    {
        using var box = new Sandbox();
        var content = SampleBnk('2', '2');
        var (devTools, state, bnk) = Create(box, content);

        devTools.Enable();
        Assert.Null(state.Load().DevTools);
        Assert.Equal(content, File.ReadAllBytes(bnk));

        devTools.Disable();

        var result = Encoding.Latin1.GetString(File.ReadAllBytes(bnk));
        Assert.Contains("<app-developer>2</app-developer>", result);
        Assert.Contains("app-developer\x09\x01" + "0x\x01", result);
        Assert.Equal(DevToolsState.Disabled, devTools.GetStatus().State);
        Assert.Contains(Directory.EnumerateFiles(Path.Combine(box.Paths.DataRoot, "DevTools")), f => File.ReadAllBytes(f).AsSpan().SequenceEqual(content));
    }

    [Fact]
    public void Missing_file_is_reported()
    {
        using var box = new Sandbox();
        var (devTools, _, _) = Create(box, null);
        Assert.Equal(DevToolsState.NotFound, devTools.GetStatus().State);
        Assert.Throws<FileNotFoundException>(() => devTools.Enable());
    }

    [Fact]
    public async Task Uninstalling_SpotiKit_turns_off_the_tools_it_turned_on()
    {
        using var box = new Sandbox();
        var original = SampleBnk();
        var (devTools, state, bnk) = Create(box, original);
        var spotify = new SpotifyService(box.Paths);
        var log = new ActivityLog(box.Paths);
        var installer = new InstallerService(spotify, new BackupService(box.Paths), state, log, devTools);

        Assert.True((await installer.InstallAsync(FrameworkPackage.Bundled, 5, new Progress(), CancellationToken.None)).Succeeded);
        devTools.Enable();
        var uninstall = await installer.UninstallAsync(5, new Progress(), CancellationToken.None);

        Assert.True(uninstall.Succeeded, uninstall.Message);
        Assert.Equal(original, File.ReadAllBytes(bnk));
        Assert.Null(state.Load().DevTools);
    }

    [Fact]
    public void Real_offline_bnk_copy_round_trips()
    {
        var real = SpotiKitPaths.FromEnvironment().SpotifyOfflineBnkPath;
        if (!File.Exists(real))
            return;

        byte[] original;
        using (var stream = new FileStream(real, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        using (var buffer = new MemoryStream())
        {
            stream.CopyTo(buffer);
            original = buffer.ToArray();
        }

        using var box = new Sandbox();
        var (devTools, _, bnk) = Create(box, original);
        var wasOn = devTools.GetStatus().State == DevToolsState.Enabled;
        Assert.NotEqual(DevToolsState.Unrecognized, devTools.GetStatus().State);

        devTools.Enable();
        Assert.Equal(DevToolsState.Enabled, devTools.GetStatus().State);
        devTools.Disable();
        Assert.Equal(DevToolsState.Disabled, devTools.GetStatus().State);
        if (!wasOn)
            Assert.Equal(original, File.ReadAllBytes(bnk));
    }

    private sealed class Progress : IProgress<InstallProgress>
    {
        public void Report(InstallProgress value)
        {
        }
    }
}

using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using SpotiKit.Services;

namespace SpotiKit.Tests;

public sealed class Sandbox : IDisposable
{
    public const string SampleIndex =
        "<!doctype html><html><head><title>Spotify</title></head><body><div id=\"main\"></div>" +
        "<script defer=\"defer\" src=\"/xpui-snapshot.js\"></script></body></html>";

    public Sandbox(string? index = SampleIndex, bool withBom = false)
    {
        Root = Path.Combine(Path.GetTempPath(), "spotikit-tests", Guid.NewGuid().ToString("N"));
        SpotifyDir = OperatingSystem.IsMacOS()
            ? Path.Combine(Root, "Spotify.app", "Contents", "Resources")
            : Path.Combine(Root, "Spotify");
        Directory.CreateDirectory(Path.Combine(SpotifyDir, "Apps"));

        var executable = OperatingSystem.IsMacOS() ? Path.GetFullPath(Path.Combine(SpotifyDir, "../MacOS/Spotify"))
            : Path.Combine(SpotifyDir, OperatingSystem.IsWindows() ? "Spotify.exe" : "spotify");
        Directory.CreateDirectory(Path.GetDirectoryName(executable)!);
        var notepad = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "notepad.exe");
        if (OperatingSystem.IsWindows() && File.Exists(notepad))
            File.Copy(notepad, executable);
        else
            File.WriteAllBytes(executable, []);
        if (OperatingSystem.IsMacOS())
            File.WriteAllText(Path.Combine(SpotifyDir, "../Info.plist"),
                "<plist version=\"1.0\"><dict><key>CFBundleShortVersionString</key><string>1.2.3.4</string></dict></plist>");

        if (index is not null)
            CreateSpa(XpuiPath, index, withBom);

        Paths = new SpotiKitPaths(
            Path.Combine(Root, "Data"),
            Path.Combine(Root, "Data", "settings.json"),
            SpotifyDir,
            Path.Combine(Root, "SpotifyLocal"))
        { IsSandboxed = true };
    }

    public string Root { get; }
    public string SpotifyDir { get; }
    public string XpuiPath => Path.Combine(SpotifyDir, "Apps", "xpui.spa");
    public SpotiKitPaths Paths { get; }

    public static void CreateSpa(string path, string index, bool withBom = false, params (string Name, string Content)[] extra)
    {
        using var zip = ZipFile.Open(path, ZipArchiveMode.Create);
        Write(zip, "index.html", index, withBom);
        Write(zip, "xpui-snapshot.js", "console.log('spotify');", false);
        Write(zip, "images/logo.svg", "<svg/>", false);
        foreach (var (name, content) in extra)
            Write(zip, name, content, false);
    }

    public static void ReplaceEntry(string spaPath, string name, string content)
    {
        using var zip = ZipFile.Open(spaPath, ZipArchiveMode.Update);
        zip.GetEntry(name)?.Delete();
        Write(zip, name, content, false);
    }

    public static byte[] ReadEntryBytes(string spaPath, string name)
    {
        using var zip = ZipFile.OpenRead(spaPath);
        using var stream = zip.GetEntry(name)!.Open();
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }

    public void Dispose()
    {
        try
        {
            foreach (var file in Directory.EnumerateFiles(Root, "*", SearchOption.AllDirectories))
                File.SetAttributes(file, FileAttributes.Normal);
            Directory.Delete(Root, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    private static void Write(ZipArchive zip, string name, string content, bool withBom)
    {
        using var stream = zip.CreateEntry(name).Open();
        if (withBom)
            stream.Write([0xEF, 0xBB, 0xBF]);
        stream.Write(Encoding.UTF8.GetBytes(content));
    }
}

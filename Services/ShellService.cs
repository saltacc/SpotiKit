using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

namespace SpotiKit.Services;

public sealed class ShellService
{
    public Func<string, Task>? CopyText { get; set; }

    public Action? QuitApp { get; set; }

    public Task CopyAsync(string text) => CopyText?.Invoke(text) ?? Task.CompletedTask;

    public void Quit() => QuitApp?.Invoke();

    public void OpenFolder(string path)
    {
        Directory.CreateDirectory(path);
        var opener = OperatingSystem.IsWindows() ? "explorer.exe" : OperatingSystem.IsMacOS() ? "open" : "xdg-open";
        Process.Start(new ProcessStartInfo(opener, $"\"{path}\"") { UseShellExecute = false });
    }

    public void OpenUrl(string url)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps)
            Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true });
    }
}

using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace SpotiKit.Services;

public sealed record KitResult(int ExitCode, string Output, string Error);

public sealed class KitRunner
{
    public static string? FindNode()
    {
        var names = OperatingSystem.IsWindows() ? new[] { "node.exe" } : new[] { "node" };
        var dirs = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);
        foreach (var dir in dirs)
            foreach (var name in names)
            {
                var full = Path.Combine(dir.Trim('"'), name);
                if (File.Exists(full))
                    return full;
            }
        if (OperatingSystem.IsWindows())
        {
            var programFiles = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
            if (File.Exists(programFiles))
                return programFiles;
        }
        return null;
    }

    public static string? FindKit(string project)
    {
        var local = Path.Combine(project, "node_modules", "spotikit-kit", "bin", "spotikit-kit.mjs");
        if (File.Exists(local))
            return local;
        var roots = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm", "node_modules"),
            "/usr/local/lib/node_modules",
            "/opt/homebrew/lib/node_modules",
            "/usr/lib/node_modules",
        };
        return roots.Select(r => Path.Combine(r, "spotikit-kit", "bin", "spotikit-kit.mjs")).FirstOrDefault(File.Exists);
    }

    public static bool CanRun(string project) => FindNode() is not null && FindKit(project) is not null;

    public async Task<KitResult?> RunAsync(string project, string[] args, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        var node = FindNode();
        var kit = FindKit(project);
        if (node is null || kit is null)
            return null;

        var start = new ProcessStartInfo(node)
        {
            WorkingDirectory = project,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        start.ArgumentList.Add(kit);
        foreach (var arg in args)
            start.ArgumentList.Add(arg);
        start.Environment["NO_COLOR"] = "1";

        using var process = Process.Start(start) ?? throw new InvalidOperationException("Node.js didn't start.");
        var output = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var error = process.StandardError.ReadToEndAsync(cancellationToken);
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        limit.CancelAfter(timeout);
        try
        {
            await process.WaitForExitAsync(limit.Token);
        }
        catch (OperationCanceledException)
        {
            try
            {
                process.Kill(entireProcessTree: true);
            }
            catch (InvalidOperationException)
            {
            }
            throw new TimeoutException("spotikit-kit took too long.");
        }
        return new KitResult(process.ExitCode, await output, await error);
    }

    public async Task<string?> BuildAsync(string project, CancellationToken cancellationToken = default)
    {
        var result = await RunAsync(project, ["build"], TimeSpan.FromMinutes(2), cancellationToken)
                     ?? throw new InvalidOperationException(FindNode() is null
                         ? "Building TypeScript needs Node.js. Install it from nodejs.org."
                         : "Building TypeScript needs spotikit-kit. Run npm install in the project's folder.");
        if (result.ExitCode != 0)
            throw new InvalidOperationException((result.Error + "\n" + result.Output).Trim().Split('\n').FirstOrDefault(l => l.Trim().Length > 0)?.Trim()
                                                ?? "The build failed.");
        return result.Output.Trim();
    }
}

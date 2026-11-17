using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using SpotiKit.Models;

namespace SpotiKit.Services;

public sealed class ActivityLog(SpotiKitPaths paths)
{
    private readonly List<LogEntry> _entries = [];
    private readonly object _gate = new();

    public event EventHandler<LogEntry>? EntryAdded;

    public string LogsDirectory => paths.LogsDir;

    public IReadOnlyList<LogEntry> Entries
    {
        get
        {
            lock (_gate)
                return _entries.ToList();
        }
    }

    public LogEntry Write(LogLevel level, string operation, string message, string? hint = null)
    {
        var entry = new LogEntry(DateTimeOffset.Now, level, operation, message, hint);
        lock (_gate)
        {
            _entries.Add(entry);
            try
            {
                Directory.CreateDirectory(paths.LogsDir);
                File.AppendAllText(Path.Combine(paths.LogsDir, $"spotikit-{entry.Timestamp:yyyyMMdd}.log"),
                    entry + Environment.NewLine);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
            }
        }

        EntryAdded?.Invoke(this, entry);
        return entry;
    }

    public LogEntry Info(string operation, string message) => Write(LogLevel.Info, operation, message);
    public LogEntry Success(string operation, string message) => Write(LogLevel.Success, operation, message);
    public LogEntry Warning(string operation, string message, string? hint = null) => Write(LogLevel.Warning, operation, message, hint);

    public LogEntry Error(string operation, Exception exception)
    {
        var (message, hint) = FriendlyError.Describe(exception);
        return Write(LogLevel.Error, operation, message, hint);
    }

    public static string Format(IEnumerable<LogEntry> entries) =>
        string.Join(Environment.NewLine, entries.Select(e => e.ToString()));
}

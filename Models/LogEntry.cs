using System;

namespace SpotiKit.Models;

public enum LogLevel
{
    Info,
    Success,
    Warning,
    Error,
}

public sealed record LogEntry(DateTimeOffset Timestamp, LogLevel Level, string Operation, string Message, string? Hint = null)
{
    public StatusKind Status => Level switch
    {
        LogLevel.Success => StatusKind.Success,
        LogLevel.Warning => StatusKind.Warning,
        LogLevel.Error => StatusKind.Error,
        _ => StatusKind.Neutral,
    };

    public string TimeText => Timestamp.ToString("HH:mm:ss");

    public override string ToString()
    {
        var line = $"[{Timestamp:yyyy-MM-dd HH:mm:ss}] {Level.ToString().ToUpperInvariant(),-7} {Operation}: {Message}";
        return Hint is null ? line : $"{line}{Environment.NewLine}{new string(' ', 22)}Hint: {Hint}";
    }
}

using System;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;

namespace SpotiKit.Services;

public static class FriendlyError
{
    private const int SharingViolation = unchecked((int)0x80070020);
    private const int LockViolation = unchecked((int)0x80070021);
    private const int DiskFull = unchecked((int)0x80070070);

    public static (string Message, string? Hint) Describe(Exception exception) => exception switch
    {
        UnauthorizedAccessException =>
            ("Windows denied access to a Spotify file.",
             "Close Spotify and try again. If it keeps happening, check that your user account can write to the Spotify folder."),
        IOException io when io.HResult is SharingViolation or LockViolation =>
            ("A Spotify file is in use by another program.",
             "Spotify is probably still running in the background. Close it completely (including the tray icon) and try again."),
        IOException io when io.HResult == DiskFull =>
            ("There is not enough free disk space.", "Free up some space and try again."),
        InvalidDataException data =>
            (data.Message, "Spotify's files look different from what SpotiKit expects. Reinstalling Spotify usually fixes this."),
        HttpRequestException http =>
            ($"The update server could not be reached ({http.Message}).", "Check your internet connection and the feed address."),
        TaskCanceledException or OperationCanceledException =>
            ("The operation was cancelled.", null),
        InvalidOperationException invalid =>
            (invalid.Message, null),
        FileNotFoundException notFound =>
            ($"A required file is missing: {Path.GetFileName(notFound.FileName) ?? notFound.Message}", null),
        _ => ($"Unexpected error: {exception.Message}", "Copy the log and include it if you report this problem."),
    };
}

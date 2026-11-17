using System;
using System.IO;
using System.Security.Cryptography;

namespace SpotiKit.Services;

public static class FileHash
{
    public static string Sha256(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        return Convert.ToHexString(SHA256.HashData(stream));
    }

    public static string Sha256(byte[] data) => Convert.ToHexString(SHA256.HashData(data));
}

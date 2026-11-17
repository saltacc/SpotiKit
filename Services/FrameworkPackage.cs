using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using SpotiKit.Models;

namespace SpotiKit.Services;

public sealed record FrameworkPackage(string Version, ReleaseChannel Channel, string LoaderScript)
{
    public static string BundledVersion => AppInfo.Version;

    public static FrameworkPackage Bundled { get; } = FromTemplate(BundledVersion, ReleaseChannel.Stable, ReadEmbeddedTemplate());

    public static FrameworkPackage FromTemplate(string version, ReleaseChannel channel, string template) =>
        new(version, channel, template
            .Replace("{{VERSION}}", version)
            .Replace("{{CHANNEL}}", channel.ToString().ToLowerInvariant()));

    public string LoaderSha256 => FileHash.Sha256(System.Text.Encoding.UTF8.GetBytes(LoaderScript));

    private const string ApiResourcePrefix = "SpotiKit.Framework.api.";

    private static string ReadEmbeddedTemplate()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var parts = new List<string> { ReadResource(assembly, "SpotiKit.Framework.loader.js") };
        parts.AddRange(assembly.GetManifestResourceNames()
            .Where(name => name.StartsWith(ApiResourcePrefix, StringComparison.Ordinal) && name.EndsWith(".js", StringComparison.Ordinal))
            .Order(StringComparer.Ordinal)
            .Select(name => ReadResource(assembly, name)));
        return string.Join("\n", parts);
    }

    private static string ReadResource(Assembly assembly, string name)
    {
        using var stream = assembly.GetManifestResourceStream(name)
                           ?? throw new FileNotFoundException($"{name} is missing from the app.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}

using System.Text;
using System.Text.RegularExpressions;

namespace Netch.Services;

public sealed record EngineLogResult(IReadOnlyList<string> Lines, bool Truncated, string Source);

public static partial class EngineLogService
{
    private const int MaximumLines = 500;
    private const int MaximumBytes = 512 * 1024;

    public static EngineLogResult ReadRecent(int requestedLines)
    {
        var limit = Math.Clamp(requestedLines, 1, MaximumLines);
        var path = Path.Combine(Global.NetchDir, Constants.LogFile);
        if (!File.Exists(path))
            return new EngineLogResult([], false, "logging/application.log");

        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var truncatedByBytes = stream.Length > MaximumBytes;
        if (truncatedByBytes)
            stream.Seek(-MaximumBytes, SeekOrigin.End);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        if (truncatedByBytes)
            _ = reader.ReadLine();

        var lines = new Queue<string>(limit);
        while (reader.ReadLine() is { } line)
        {
            if (lines.Count == limit)
                lines.Dequeue();
            lines.Enqueue(RedactLine(line));
        }
        return new EngineLogResult(
            lines.ToArray(),
            truncatedByBytes || stream.Length > 0 && lines.Count == limit,
            "logging/application.log");
    }

    public static string RedactLine(string line)
    {
        var redacted = UriPattern().Replace(line, "[redacted-uri]");
        return SecretPattern().Replace(redacted, match => $"{match.Groups[1].Value}=[redacted]");
    }

    [GeneratedRegex(@"(?i)\b[a-z][a-z0-9+.-]*://\S+")]
    private static partial Regex UriPattern();

    [GeneratedRegex(@"(?i)\b(password|passwd|token|uuid|private\s*key|pre\s*shared\s*key|authorization)\b\s*[:=]\s*(?:""[^""]*""|'[^']*'|\S+)")]
    private static partial Regex SecretPattern();
}

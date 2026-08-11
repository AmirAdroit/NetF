using System.Text.Json;
using Netch.Models.Modes;
using Netch.Utils;

namespace Netch.Services;

public sealed record ModeDeleteResult(
    string DeletedSource,
    string DeletedRemark,
    string Origin,
    string BackupDirectory);

public static class ModeDeletionService
{
    private const int TombstoneSchemaVersion = 1;
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public static async Task<ModeDeleteResult> DeleteAsync(
        int modeId,
        CancellationToken cancellationToken = default)
    {
        await Gate.WaitAsync(cancellationToken);
        try
        {
            if ((uint)modeId >= (uint)Global.Modes.Count)
                throw new InvalidDataException("The selected mode no longer exists.");

            Mode mode = Global.Modes[modeId];
            var detail = ModeManagementService.GetDetail(modeId);
            var modeRoot = Path.GetFullPath(ModeService.Instance.ModeDirectoryFullName);
            var target = ValidateModePath(modeRoot, mode.FullName);
            if (!File.Exists(target))
                throw new InvalidDataException("The selected mode file no longer exists.");

            var backupDirectory = await BackupAsync(modeRoot, target, cancellationToken);
            if (detail.Origin == "built-in")
                await AddTombstoneAsync(modeRoot, detail.Source, cancellationToken);

            File.Delete(target);
            ModeService.Instance.Load(notifyPresentation: false);
            return new ModeDeleteResult(detail.Source, detail.Remark, detail.Origin, backupDirectory);
        }
        finally
        {
            Gate.Release();
        }
    }

    public static async Task ApplyTombstonesAsync(CancellationToken cancellationToken = default)
    {
        await Gate.WaitAsync(cancellationToken);
        try
        {
            var modeRoot = Path.GetFullPath(ModeService.Instance.ModeDirectoryFullName);
            var tombstones = await ReadTombstonesAsync(cancellationToken);
            foreach (var relativePath in tombstones.Paths)
            {
                var target = ValidateModePath(modeRoot, relativePath);
                if (!File.Exists(target))
                    continue;

                File.Delete(target);
            }
        }
        finally
        {
            Gate.Release();
        }
    }

    private static async Task AddTombstoneAsync(
        string modeRoot,
        string relativePath,
        CancellationToken cancellationToken)
    {
        var target = ValidateModePath(modeRoot, relativePath);
        var normalized = Path.GetRelativePath(modeRoot, target).Replace('\\', '/');
        var existing = await ReadTombstonesAsync(cancellationToken);
        if (!existing.Paths.Contains(normalized, StringComparer.OrdinalIgnoreCase))
            existing.Paths.Add(normalized);
        existing.Paths.Sort(StringComparer.OrdinalIgnoreCase);
        await WriteTombstonesAtomicAsync(existing, cancellationToken);
    }

    private static async Task<TombstoneDocument> ReadTombstonesAsync(CancellationToken cancellationToken)
    {
        var path = TombstonePath();
        if (!File.Exists(path))
            return new TombstoneDocument(TombstoneSchemaVersion, []);
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("The deleted-mode tombstone file is a filesystem reparse point.");

        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        var document = await JsonSerializer.DeserializeAsync<TombstoneDocument>(stream, JsonOptions, cancellationToken)
            ?? throw new InvalidDataException("The deleted-mode tombstone file is empty.");
        ValidateTombstoneDocument(document);
        return document;
    }

    private static async Task WriteTombstonesAtomicAsync(
        TombstoneDocument document,
        CancellationToken cancellationToken)
    {
        var destination = TombstonePath();
        await AtomicJsonFile.WriteAsync(
            destination,
            destination + ".bak",
            document,
            JsonOptions,
            ValidateTombstoneDocument,
            cancellationToken);
    }

    private static void ValidateTombstoneDocument(TombstoneDocument document)
    {
        if (document.SchemaVersion != TombstoneSchemaVersion)
            throw new InvalidDataException("The deleted-mode tombstone version is not supported.");
        if (document.Paths is null || document.Paths.Count > 10_000)
            throw new InvalidDataException("The deleted-mode tombstone file contains too many entries.");
        if (document.Paths.Any(string.IsNullOrWhiteSpace))
            throw new InvalidDataException("The deleted-mode tombstone file contains an empty path.");
    }

    private static async Task<string> BackupAsync(
        string modeRoot,
        string source,
        CancellationToken cancellationToken)
    {
        var stamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmssfff") + "-" + Guid.NewGuid().ToString("N")[..8];
        var backupRoot = Path.Combine(Global.NetchDir, "data", "deleted-mode-backups", stamp);
        var relative = Path.GetRelativePath(modeRoot, source);
        var destination = Path.GetFullPath(Path.Combine(backupRoot, relative));
        var backupPrefix = Path.GetFullPath(backupRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!destination.StartsWith(backupPrefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The mode backup path escaped its owned directory.");

        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        await using var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read);
        await using var output = new FileStream(
            destination,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            81920,
            FileOptions.WriteThrough);
        await input.CopyToAsync(output, cancellationToken);
        await output.FlushAsync(cancellationToken);
#pragma warning disable VSTHRD103 // Flush(true) is intentionally synchronous to durably persist the backup before deletion.
        output.Flush(flushToDisk: true);
#pragma warning restore VSTHRD103
        return backupRoot;
    }

    private static string ValidateModePath(string modeRoot, string candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate))
            throw new InvalidDataException("The mode path is empty.");

        var root = Path.GetFullPath(modeRoot).TrimEnd(Path.DirectorySeparatorChar);
        var target = Path.GetFullPath(Path.IsPathFullyQualified(candidate) ? candidate : Path.Combine(root, candidate));
        var prefix = root + Path.DirectorySeparatorChar;
        if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The mode path escaped the owned mode directory.");
        var extension = Path.GetExtension(target);
        if (!extension.Equals(".json", StringComparison.OrdinalIgnoreCase)
            && !extension.Equals(".txt", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Only JSON and text mode files can be deleted.");

        for (var current = target; current != null; current = Path.GetDirectoryName(current))
        {
            if ((File.Exists(current) || Directory.Exists(current))
                && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("The mode path contains a filesystem reparse point.");
            if (current.Equals(root, StringComparison.OrdinalIgnoreCase))
                return target;
        }
        throw new InvalidDataException("The mode path did not resolve beneath the owned mode directory.");
    }

    private static string TombstonePath() => Path.Combine(Global.NetchDir, "data", "deleted-modes.json");

    private sealed record TombstoneDocument(int SchemaVersion, List<string> Paths);
}

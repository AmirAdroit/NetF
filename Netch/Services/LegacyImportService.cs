using Netch.Utils;

namespace Netch.Services;

public sealed record LegacyImportResult(int ServerCount, int ModeCount, int ImportedCustomModes, string BackupDirectory);

public static class LegacyImportService
{
    private const int MaximumModeFiles = 5_000;
    private const long MaximumModeFileBytes = 16L * 1024 * 1024;
    private const long MaximumTotalModeBytes = 64L * 1024 * 1024;

    public static async Task<LegacyImportResult> ImportAsync(string sourceRoot)
    {
        if (!Path.IsPathFullyQualified(sourceRoot))
            throw new ArgumentException("The import source must be an absolute directory.");

        var source = Path.GetFullPath(sourceRoot).TrimEnd(Path.DirectorySeparatorChar);
        var owned = Path.GetFullPath(Global.NetchDir).TrimEnd(Path.DirectorySeparatorChar);
        if (source.Equals(owned, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The owned runtime cannot be imported into itself.");
        RejectReparsePoint(source);

        var sourceSettings = Path.Combine(source, "data", "settings.json");
        var sourceModes = Path.Combine(source, "mode");
        if (!File.Exists(sourceSettings) || !Directory.Exists(sourceModes))
            throw new InvalidDataException("The selected directory does not contain data/settings.json and mode/.");

        _ = await Configuration.ReadValidatedAsync(sourceSettings);
        var customSource = Path.Combine(sourceModes, "Custom");
        var modeFiles = Directory.Exists(customSource)
            ? EnumerateAndValidateModes(customSource, sourceModes)
            : [];

        var ownedCustom = Path.Combine(owned, "mode", "Custom");
        var staging = Path.Combine(owned, "mode", $".import-{Guid.NewGuid():N}.tmp");
        var backupDirectory = Path.Combine(
            owned,
            "data",
            "import-backups",
            $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}");
        var backupCustom = Path.Combine(backupDirectory, "Custom");
        var backupSettings = Path.Combine(backupDirectory, "settings.json");

        Directory.CreateDirectory(staging);
        try
        {
            foreach (var sourceMode in modeFiles)
            {
                var relative = Path.GetRelativePath(customSource, sourceMode);
                var destination = Path.GetFullPath(Path.Combine(staging, relative));
                EnsureWithin(staging, destination);
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                File.Copy(sourceMode, destination, overwrite: false);
            }

            Directory.CreateDirectory(backupDirectory);
            if (File.Exists(Configuration.FileFullName))
                File.Copy(Configuration.FileFullName, backupSettings, overwrite: false);

            var previousCustomMoved = false;
            if (Directory.Exists(ownedCustom))
            {
                Directory.Move(ownedCustom, backupCustom);
                previousCustomMoved = true;
            }
            try
            {
                Directory.Move(staging, ownedCustom);
            }
            catch
            {
                if (previousCustomMoved && !Directory.Exists(ownedCustom))
                    Directory.Move(backupCustom, ownedCustom);
                throw;
            }

            try
            {
                await Configuration.ImportAsync(sourceSettings);
                ModeService.Instance.Load(notifyPresentation: false);
            }
            catch
            {
                if (Directory.Exists(ownedCustom))
                    Directory.Delete(ownedCustom, recursive: true);
                if (Directory.Exists(backupCustom))
                    Directory.Move(backupCustom, ownedCustom);
                if (File.Exists(backupSettings))
                    await Configuration.ImportAsync(backupSettings);
                ModeService.Instance.Load(notifyPresentation: false);
                throw;
            }

            return new LegacyImportResult(
                Global.Settings.Server.Count,
                Global.Modes.Count,
                modeFiles.Count,
                backupDirectory);
        }
        finally
        {
            if (Directory.Exists(staging))
                Directory.Delete(staging, recursive: true);
        }
    }

    private static List<string> EnumerateAndValidateModes(string customRoot, string modeRoot)
    {
        RejectReparsePoint(customRoot);
        var files = new List<string>();
        long totalBytes = 0;
        foreach (var directory in Directory.EnumerateDirectories(customRoot, "*", SearchOption.AllDirectories))
            RejectReparsePoint(directory);

        foreach (var file in Directory.EnumerateFiles(customRoot, "*", SearchOption.AllDirectories))
        {
            RejectReparsePoint(file);
            var extension = Path.GetExtension(file);
            if (!extension.Equals(".json", StringComparison.OrdinalIgnoreCase)
                && !extension.Equals(".txt", StringComparison.OrdinalIgnoreCase))
                continue;
            if (files.Count >= MaximumModeFiles)
                throw new InvalidDataException($"Import exceeded {MaximumModeFiles} custom mode files.");

            var info = new FileInfo(file);
            if (info.Length > MaximumModeFileBytes)
                throw new InvalidDataException($"Custom mode file exceeded {MaximumModeFileBytes} bytes.");
            totalBytes += info.Length;
            if (totalBytes > MaximumTotalModeBytes)
                throw new InvalidDataException($"Custom modes exceeded {MaximumTotalModeBytes} bytes in total.");

            EnsureWithin(customRoot, file);
            _ = ModeHelper.LoadMode(file, modeRoot);
            files.Add(file);
        }
        return files;
    }

    private static void EnsureWithin(string root, string candidate)
    {
        var prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!Path.GetFullPath(candidate).StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Import path escaped its trusted root.");
    }

    private static void RejectReparsePoint(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException($"Import path contains a filesystem reparse point: {path}");
    }
}

using Netch.Models.Modes;
using Netch.Models.Modes.ProcessMode;
using Netch.Models.Modes.TunMode;
using Netch.Utils;

namespace Netch.Services;

public sealed record ModeDetail(
    int Id,
    string Type,
    string Remark,
    string Source,
    string Origin,
    bool EditableInPlace,
    IReadOnlyList<string> Handle,
    IReadOnlyList<string> Bypass);

public sealed record ModeSaveResult(ModeDetail Mode, bool CreatedCopy);

public sealed record ModeMergeResult(ModeDetail Mode, int AddedHandleRules, int AddedBypassRules, bool CreatedCopy);

public static class ModeManagementService
{
    private const int MaximumRemarkLength = 128;
    private static readonly HashSet<string> ReservedWindowsNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
    };

    public static string GetOrigin(Mode mode)
    {
        var relative = ModeService.Instance.GetRelativePath(mode.FullName)
            .Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar);
        var userPrefix = $"Custom{Path.DirectorySeparatorChar}User{Path.DirectorySeparatorChar}";
        var importedPrefix = $"Custom{Path.DirectorySeparatorChar}Imported{Path.DirectorySeparatorChar}";
        var customPrefix = $"Custom{Path.DirectorySeparatorChar}";

        if (relative.StartsWith(userPrefix, StringComparison.OrdinalIgnoreCase))
            return "user";
        if (relative.StartsWith(importedPrefix, StringComparison.OrdinalIgnoreCase)
            || relative.StartsWith(customPrefix, StringComparison.OrdinalIgnoreCase))
            return "imported";
        return "built-in";
    }

    public static ModeDetail GetDetail(int modeId)
    {
        var mode = GetMode(modeId);
        var (handle, bypass) = GetRules(mode);
        var origin = GetOrigin(mode);
        return new ModeDetail(
            modeId,
            mode.Type.ToString(),
            mode.i18NRemark,
            ModeService.Instance.GetRelativePath(mode.FullName),
            origin,
            origin != "built-in" && Path.GetExtension(mode.FullName).Equals(".json", StringComparison.OrdinalIgnoreCase),
            handle,
            bypass);
    }

    public static async Task<ModeSaveResult> SaveAsync(
        int? modeId,
        string type,
        string remark,
        IReadOnlyCollection<string> handle,
        IReadOnlyCollection<string> bypass,
        CancellationToken cancellationToken = default)
    {
        var normalizedRemark = ValidateRemark(remark);
        var normalizedHandle = NormalizeRules(handle);
        var normalizedBypass = NormalizeRules(bypass);

        Mode editable;
        var createdCopy = false;
        string destination;
        if (modeId is { } existingId)
        {
            var existing = GetMode(existingId);
            if (!existing.Type.ToString().Equals(type, StringComparison.Ordinal))
                throw new InvalidDataException("A mode's routing type cannot be changed in place.");
            editable = CloneEditable(existing);
            var origin = GetOrigin(existing);
            var isJson = Path.GetExtension(existing.FullName).Equals(".json", StringComparison.OrdinalIgnoreCase);
            if (origin == "built-in" || !isJson)
            {
                destination = AllocateUserPath(normalizedRemark);
                createdCopy = true;
            }
            else
            {
                destination = EnsureEditablePath(existing.FullName);
            }
        }
        else
        {
            editable = type switch
            {
                nameof(ModeType.ProcessMode) => new Redirector(),
                nameof(ModeType.TunMode) => new TunMode(),
                _ => throw new InvalidDataException("Only process and TUN modes can be created in the modern editor.")
            };
            destination = AllocateUserPath(normalizedRemark);
            createdCopy = true;
        }

        editable.Remark = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["en"] = normalizedRemark,
            ["en-US"] = normalizedRemark
        };
        switch (editable)
        {
            case Redirector processMode:
                processMode.Handle = normalizedHandle;
                processMode.Bypass = normalizedBypass;
                break;
            case TunMode tunMode:
                tunMode.Handle = normalizedHandle;
                tunMode.Bypass = normalizedBypass;
                break;
            default:
                throw new InvalidDataException("This mode type cannot be edited through the modern UI.");
        }

        await editable.WriteFileAtomicAsync(destination, cancellationToken);
        ModeService.Instance.Load(notifyPresentation: false);
        var savedId = Global.Modes.FindIndex(mode =>
            Path.GetFullPath(mode.FullName).Equals(Path.GetFullPath(destination), StringComparison.OrdinalIgnoreCase));
        if (savedId < 0)
            throw new InvalidDataException("The saved mode could not be reloaded.");
        return new ModeSaveResult(GetDetail(savedId), createdCopy);
    }

    public static async Task<ModeMergeResult> MergeAsync(
        int sourceModeId,
        int targetModeId,
        CancellationToken cancellationToken = default)
    {
        if (sourceModeId == targetModeId)
            throw new InvalidDataException("Choose two different modes to merge.");

        var source = GetMode(sourceModeId);
        var target = GetMode(targetModeId);
        if (source.Type != target.Type || source is not (Redirector or TunMode))
            throw new InvalidDataException("Only process-to-process or TUN-to-TUN mode merges are supported.");

        var (sourceHandle, sourceBypass) = GetRules(source);
        var (targetHandle, targetBypass) = GetRules(target);
        var mergedHandle = MergeRules(targetHandle, sourceHandle, out var addedHandle);
        var mergedBypass = MergeRules(targetBypass, sourceBypass, out var addedBypass);
        var saved = await SaveAsync(
            targetModeId,
            target.Type.ToString(),
            target.i18NRemark,
            mergedHandle,
            mergedBypass,
            cancellationToken);
        return new ModeMergeResult(saved.Mode, addedHandle, addedBypass, saved.CreatedCopy);
    }

    private static Mode GetMode(int modeId)
    {
        if ((uint)modeId >= (uint)Global.Modes.Count)
            throw new InvalidDataException("The selected mode no longer exists.");
        return Global.Modes[modeId];
    }

    private static (List<string> Handle, List<string> Bypass) GetRules(Mode mode)
    {
        return mode switch
        {
            Redirector processMode => ([.. processMode.Handle], [.. processMode.Bypass]),
            TunMode tunMode => ([.. tunMode.Handle], [.. tunMode.Bypass]),
            _ => ([], [])
        };
    }

    private static Mode CloneEditable(Mode mode)
    {
        var remark = new Dictionary<string, string>(mode.Remark, StringComparer.OrdinalIgnoreCase);
        return mode switch
        {
            Redirector source => new Redirector
            {
                Remark = remark,
                FilterICMP = source.FilterICMP,
                FilterTCP = source.FilterTCP,
                FilterUDP = source.FilterUDP,
                FilterDNS = source.FilterDNS,
                FilterParent = source.FilterParent,
                ICMPDelay = source.ICMPDelay,
                DNSProxy = source.DNSProxy,
                HandleOnlyDNS = source.HandleOnlyDNS,
                DNSHost = source.DNSHost,
                FilterLoopback = source.FilterLoopback,
                FilterIntranet = source.FilterIntranet,
                Handle = [.. source.Handle],
                Bypass = [.. source.Bypass]
            },
            TunMode source => new TunMode
            {
                Remark = remark,
                Handle = [.. source.Handle],
                Bypass = [.. source.Bypass]
            },
            _ => throw new InvalidDataException("This mode type cannot be edited through the modern UI.")
        };
    }

    private static string ValidateRemark(string remark)
    {
        var normalized = remark.Trim();
        if (normalized.Length is 0 or > MaximumRemarkLength || normalized.Any(char.IsControl))
            throw new InvalidDataException($"Mode name must be 1-{MaximumRemarkLength} printable characters.");
        return normalized;
    }

    private static List<string> NormalizeRules(IEnumerable<string> rules)
    {
        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var value in rules)
        {
            var rule = value.Trim();
            if (rule.Length == 0)
                continue;
            if (rule.Length > 2_048 || rule.Any(character => character is '\r' or '\n' or '\0'))
                throw new InvalidDataException("Rules must be single-line values no longer than 2048 characters.");
            if (seen.Add(rule))
                result.Add(rule);
        }
        if (result.Count > 10_000)
            throw new InvalidDataException("A mode cannot contain more than 10000 rules per list.");
        return result;
    }

    private static List<string> MergeRules(
        IReadOnlyCollection<string> target,
        IReadOnlyCollection<string> source,
        out int added)
    {
        var merged = NormalizeRules(target);
        var seen = new HashSet<string>(merged, StringComparer.OrdinalIgnoreCase);
        added = 0;
        foreach (var rule in NormalizeRules(source))
        {
            if (!seen.Add(rule))
                continue;
            merged.Add(rule);
            added++;
        }
        return merged;
    }

    private static string AllocateUserPath(string remark)
    {
        var directory = Path.Combine(ModeService.Instance.ModeDirectoryFullName, "Custom", "User");
        Directory.CreateDirectory(directory);
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        var stem = new string(remark.Select(character => invalid.Contains(character) ? '_' : character).ToArray())
            .Trim()
            .TrimEnd('.', ' ');
        if (stem.Length > 80)
            stem = stem[..80].Trim().TrimEnd('.', ' ');
        if (stem.Length == 0)
            stem = "Mode";
        if (ReservedWindowsNames.Contains(stem))
            stem = "_" + stem;

        var candidate = Path.Combine(directory, stem + ".json");
        for (var index = 2; File.Exists(candidate); index++)
            candidate = Path.Combine(directory, $"{stem} ({index}).json");
        return EnsureEditablePath(candidate);
    }

    private static string EnsureEditablePath(string path)
    {
        var customRootDirectory = Path.GetFullPath(Path.Combine(ModeService.Instance.ModeDirectoryFullName, "Custom"))
            .TrimEnd(Path.DirectorySeparatorChar);
        var customRoot = customRootDirectory + Path.DirectorySeparatorChar;
        var candidate = Path.GetFullPath(path);
        if (!candidate.StartsWith(customRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Mode edit path escaped the custom-mode directory.");

        if (File.Exists(candidate) && (File.GetAttributes(candidate) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("Mode edit path is a filesystem reparse point.");

        for (var current = Path.GetDirectoryName(candidate); current != null; current = Path.GetDirectoryName(current))
        {
            if (Directory.Exists(current) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("Mode edit path contains a filesystem reparse point.");
            if (current.Equals(customRootDirectory, StringComparison.OrdinalIgnoreCase))
                break;
        }
        return candidate;
    }
}

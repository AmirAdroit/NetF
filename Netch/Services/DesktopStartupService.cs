using System.Security.Principal;
using Microsoft.Win32.TaskScheduler;

namespace Netch.Services;

public sealed record DesktopStartupStatus(
    bool Enabled,
    bool MatchesCurrentExecutable,
    string TaskName,
    string? RegisteredExecutable,
    string? Message);

public static class DesktopStartupService
{
    public const string TaskName = "NetF Startup";
    private const string StartupArgument = "--autostart";

    public static DesktopStartupStatus Get(string executablePath)
    {
        var expectedPath = ValidateExecutable(executablePath);
        var task = TaskService.Instance.GetTask(TaskName);
        if (task == null)
            return new DesktopStartupStatus(false, false, TaskName, null, "Not registered");

        var action = task.Definition.Actions.OfType<ExecAction>().SingleOrDefault();
        var hasLogonTrigger = task.Definition.Triggers.OfType<LogonTrigger>().Any();
        var isHighest = task.Definition.Principal.RunLevel == TaskRunLevel.Highest;
        var currentUser = WindowsIdentity.GetCurrent().Name;
        var registeredUser = task.Definition.Principal.UserId;
        var ownerMatches = string.IsNullOrWhiteSpace(registeredUser)
                           || string.Equals(registeredUser, currentUser, StringComparison.OrdinalIgnoreCase);
        var pathMatches = action != null
                          && string.Equals(
                              Path.GetFullPath(action.Path.Trim('"')),
                              expectedPath,
                              StringComparison.OrdinalIgnoreCase);
        var argumentsMatch = action != null
                             && string.Equals(action.Arguments?.Trim(), StartupArgument, StringComparison.Ordinal);
        var matches = pathMatches && argumentsMatch && hasLogonTrigger && isHighest && ownerMatches;

        return new DesktopStartupStatus(
            true,
            matches,
            TaskName,
            action?.Path,
            matches ? "Registered and verified" : "Registration differs from the current NetF installation");
    }

    public static DesktopStartupStatus Configure(bool enabled, string executablePath)
    {
        var expectedPath = ValidateExecutable(executablePath);
        var folder = TaskService.Instance.RootFolder;

        if (!enabled)
        {
            if (TaskService.Instance.GetTask(TaskName) != null)
                folder.DeleteTask(TaskName, false);
            return Get(expectedPath);
        }

        using var definition = TaskService.Instance.NewTask();
        definition.RegistrationInfo.Author = "NetF contributors";
        definition.RegistrationInfo.Description = "Start NetF in the notification area when this user signs in.";
        definition.Principal.UserId = WindowsIdentity.GetCurrent().Name;
        definition.Principal.LogonType = TaskLogonType.InteractiveToken;
        definition.Principal.RunLevel = TaskRunLevel.Highest;
        definition.Triggers.Add(new LogonTrigger());
        definition.Actions.Add(new ExecAction(
            expectedPath,
            StartupArgument,
            Path.GetDirectoryName(expectedPath)));
        definition.Settings.ExecutionTimeLimit = TimeSpan.Zero;
        definition.Settings.DisallowStartIfOnBatteries = false;
        definition.Settings.StopIfGoingOnBatteries = false;
        definition.Settings.IdleSettings.StopOnIdleEnd = false;
        definition.Settings.IdleSettings.RestartOnIdle = false;
        definition.Settings.RunOnlyIfIdle = false;
        definition.Settings.Compatibility = TaskCompatibility.V2_1;

        folder.RegisterTaskDefinition(TaskName, definition);
        var status = Get(expectedPath);
        if (!status.Enabled || !status.MatchesCurrentExecutable)
            throw new InvalidOperationException(status.Message ?? "Windows did not verify the NetF startup task.");
        return status;
    }

    private static string ValidateExecutable(string executablePath)
    {
        if (string.IsNullOrWhiteSpace(executablePath) || !Path.IsPathFullyQualified(executablePath))
            throw new ArgumentException("The NetF executable path must be absolute.");
        var fullPath = Path.GetFullPath(executablePath);
        if (!File.Exists(fullPath) || !string.Equals(Path.GetExtension(fullPath), ".exe", StringComparison.OrdinalIgnoreCase))
            throw new FileNotFoundException("The NetF executable was not found.", fullPath);
        return fullPath;
    }
}

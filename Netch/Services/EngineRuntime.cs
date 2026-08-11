using Netch.Interfaces;
using Netch.Utils;

namespace Netch.Services;

/// <summary>
/// Initializes the existing engine without constructing a WinForms main
/// window. The runtime root is selected by the trusted native host, never by
/// webview input.
/// </summary>
public static class EngineRuntime
{
    private static int _initialized;

    public static async Task InitializeHeadlessAsync(
        string runtimeRoot,
        string executablePath,
        IEngineObserver observer)
    {
        ArgumentNullException.ThrowIfNull(observer);
        if (Interlocked.Exchange(ref _initialized, 1) != 0)
            throw new InvalidOperationException("The engine runtime is already initialized.");

        try
        {
            Global.ConfigureRuntimeRoot(runtimeRoot, executablePath);
            Directory.SetCurrentDirectory(Global.NetchDir);

            var binPath = Path.Combine(Global.NetchDir, "bin");
            var currentPath = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            Environment.SetEnvironmentVariable("PATH", $"{currentPath};{binPath}");

            foreach (var directory in new[] { "mode\\Custom", "data", "i18n", "logging" })
                Directory.CreateDirectory(Path.Combine(Global.NetchDir, directory));

            Program.CreateLogger(writeConsole: false);
            EngineEvents.Observer = observer;
            await Configuration.LoadAsync();
            i18N.Load(Global.Settings.Language);
            await ModeDeletionService.ApplyTombstonesAsync();
            ModeService.Instance.Load(notifyPresentation: false);
        }
        catch
        {
            Interlocked.Exchange(ref _initialized, 0);
            throw;
        }
    }
}

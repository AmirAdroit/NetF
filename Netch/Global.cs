using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using Netch.Forms;
using Netch.Models;
using Netch.Models.Modes;
using WindowsJobAPI;

namespace Netch;

public static class Global
{
    /// <summary>
    ///     主窗体的静态实例
    /// </summary>
    private static readonly Lazy<MainForm> LazyMainForm = new(() => new MainForm());

    /// <summary>
    ///     用于读取和写入的配置
    /// </summary>
    public static Setting Settings = new();

    public static readonly JobObject Job = new();

    /// <summary>
    ///     用于存储模式
    /// </summary>
    public static readonly List<Mode> Modes = new();

    public static string NetchDir { get; private set; }

    public static string NetchExecutable { get; private set; }

    static Global()
    {
        NetchExecutable = Application.ExecutablePath;
        NetchDir = Application.StartupPath;
    }

    /// <summary>
    /// Configures the runtime asset root for a trusted native host. This must be
    /// called before configuration, modes, helpers, or controllers are loaded.
    /// The webview never supplies this path.
    /// </summary>
    public static void ConfigureRuntimeRoot(string runtimeRoot, string executablePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(runtimeRoot);
        ArgumentException.ThrowIfNullOrWhiteSpace(executablePath);

        var resolvedRoot = Path.GetFullPath(runtimeRoot);
        if (!Directory.Exists(resolvedRoot))
            throw new DirectoryNotFoundException($"Runtime root does not exist: {resolvedRoot}");

        NetchDir = resolvedRoot;
        NetchExecutable = Path.GetFullPath(executablePath);
    }

    /// <summary>
    ///     主窗体的静态实例
    /// </summary>
    public static MainForm MainForm => LazyMainForm.Value;

    public static JsonSerializerOptions NewCustomJsonSerializerOptions() => new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };
}

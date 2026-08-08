using System.Text.Json;
using System.Text.Json.Serialization;
using Netch.Controllers;
using Netch.Interfaces;
using Netch.Services;
using Serilog;

namespace Netch.EngineHost;

internal static class Program
{
    private const int MaximumRequestCharacters = 64 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public static async Task<int> Main(string[] args)
    {
        Console.InputEncoding = System.Text.Encoding.UTF8;
        Console.OutputEncoding = System.Text.Encoding.UTF8;

        try
        {
            var options = ParseOptions(args);
            var state = new HostState(options.RuntimeKind);
            await EngineRuntime.InitializeHeadlessAsync(
                options.RuntimeRoot,
                Environment.ProcessPath ?? AppContext.BaseDirectory,
                state);

            return await RunProtocolAsync(state);
        }
        catch (Exception exception)
        {
            await Console.Error.WriteLineAsync($"Engine host failed to initialize: {exception.Message}");
            return 2;
        }
        finally
        {
            await MainController.StopAsync();
            await Log.CloseAndFlushAsync();
        }
    }

    private static HostOptions ParseOptions(IReadOnlyList<string> args)
    {
        if (args.Count == 0)
            return new HostOptions(AppContext.BaseDirectory, "standalone-runtime");

        if (args.Count is not (2 or 4) || args[0] != "--runtime-root")
            throw new ArgumentException(
                "Expected --runtime-root <absolute-directory> [--runtime-kind owned-runtime].");

        if (!Path.IsPathFullyQualified(args[1]))
            throw new ArgumentException("The runtime root must be an absolute directory.");

        var runtimeKind = "external-runtime";
        if (args.Count == 4)
        {
            if (args[2] != "--runtime-kind" || args[3] != "owned-runtime")
                throw new ArgumentException("The runtime kind was not recognized.");
            runtimeKind = args[3];
        }

        return new HostOptions(args[1], runtimeKind);
    }

    private static async Task<int> RunProtocolAsync(HostState state)
    {
        while (await Console.In.ReadLineAsync() is { } line)
        {
            EngineResponse response;
            if (line.Length == 0)
                continue;

            if (line.Length > MaximumRequestCharacters)
            {
                response = EngineResponse.Failure(0, "request_too_large", "Engine request exceeded 64 KiB.");
            }
            else
            {
                response = await HandleLineAsync(line, state);
            }

            await Console.Out.WriteLineAsync(JsonSerializer.Serialize(response, JsonOptions));
            await Console.Out.FlushAsync();

            if (response.Shutdown)
                return 0;
        }

        return 0;
    }

    private static async Task<EngineResponse> HandleLineAsync(string line, HostState state)
    {
        EngineRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<EngineRequest>(line, JsonOptions);
        }
        catch (JsonException)
        {
            return EngineResponse.Failure(0, "invalid_json", "Engine request was not valid JSON.");
        }

        if (request == null || request.Id <= 0 || string.IsNullOrWhiteSpace(request.Method))
            return EngineResponse.Failure(request?.Id ?? 0, "invalid_request", "A positive id and method are required.");

        try
        {
            return request.Method switch
            {
                "hello" => EngineResponse.Success(request.Id, new
                {
                    apiVersion = 1,
                    engine = "netch-dotnet-bridge",
                    supports = new[] { "snapshot", "status", "connect", "disconnect", "importLegacy", "shutdown" }
                }),
                "snapshot" => EngineResponse.Success(request.Id, BuildSnapshot(state)),
                "status" => EngineResponse.Success(request.Id, state.Snapshot()),
                "connect" => await ConnectAsync(request, state),
                "disconnect" => await DisconnectAsync(request.Id, state),
                "importLegacy" => await ImportLegacyAsync(request, state),
                "shutdown" => EngineResponse.Success(request.Id, state.Snapshot(), shutdown: true),
                _ => EngineResponse.Failure(request.Id, "unknown_method", "The requested engine method is not allowlisted.")
            };
        }
        catch (Exception exception)
        {
            state.Failed(exception.Message);
            return EngineResponse.Failure(request.Id, "engine_error", exception.Message);
        }
    }

    private static object BuildSnapshot(HostState state)
    {
        var servers = Global.Settings.Server.Select((server, index) => new
        {
            id = index,
            type = server.Type,
            server.Remark,
            server.Group
        });
        var modes = Global.Modes.Select((mode, index) => new
        {
            id = index,
            type = mode.Type.ToString(),
            remark = mode.i18NRemark,
            source = ModeService.Instance.GetRelativePath(mode.FullName)
        });

        var capabilityRequirements = new[]
        {
            (Name: "Process routing", Files: new[] { "Redirector.bin", "nfapi.dll", "nfdriver.sys" }),
            (Name: "TUN routing", Files: new[] { "RouteHelper.bin", "wintun.dll", "tun2socks.bin" }),
            (Name: "Split DNS", Files: new[] { "aiodns.bin", "aiodns.conf" }),
            (Name: "Network sharing", Files: new[] { "pcap2socks.exe" }),
            (Name: "Legacy protocol fallback", Files: new[] { "v2ray-sn.exe" })
        };
        var capabilities = capabilityRequirements.Select(capability =>
        {
            var missing = capability.Files
                .Where(name => !File.Exists(Path.Combine(Global.NetchDir, "bin", name)))
                .ToArray();
            return new { name = capability.Name, available = missing.Length == 0, missing };
        }).ToArray();
        var missingHelpers = capabilities.SelectMany(capability => capability.missing).Distinct().ToArray();

        var proxyCores = new List<string> { "direct SOCKS" };
        foreach (var (fileName, displayName) in new[]
                 {
                     ("xray.exe", "Xray"),
                     ("v2ray-sn.exe", "V2Ray (SagerNet)"),
                     ("Shadowsocks.exe", "Shadowsocks"),
                     ("ShadowsocksR.exe", "ShadowsocksR"),
                     ("Trojan.exe", "Trojan")
                 })
        {
            if (File.Exists(Path.Combine(Global.NetchDir, "bin", fileName)))
                proxyCores.Add(displayName);
        }

        return new
        {
            apiVersion = 1,
            status = state.Snapshot(),
            servers,
            modes,
            missingHelpers,
            capabilities,
            coreSource = state.RuntimeKind,
            proxyCores
        };
    }

    private static async Task<EngineResponse> ConnectAsync(EngineRequest request, HostState state)
    {
        var parameters = request.Parameters.Deserialize<ConnectParameters>(JsonOptions)
            ?? throw new ArgumentException("Connect parameters are required.");

        if ((uint)parameters.ServerId >= (uint)Global.Settings.Server.Count)
            return EngineResponse.Failure(request.Id, "server_not_found", "The selected server no longer exists.");
        if ((uint)parameters.ModeId >= (uint)Global.Modes.Count)
            return EngineResponse.Failure(request.Id, "mode_not_found", "The selected mode no longer exists.");
        if (state.State != ConnectionState.Stopped && state.State != ConnectionState.Failed)
            return EngineResponse.Failure(request.Id, "invalid_state", "Disconnect the active profile before connecting again.");

        state.Transition(ConnectionState.Starting, "Validating and starting profile");
        await MainController.StartAsync(
            Global.Settings.Server[parameters.ServerId],
            Global.Modes[parameters.ModeId],
            headless: true);
        state.Transition(ConnectionState.Connected, "Connected");
        return EngineResponse.Success(request.Id, state.Snapshot());
    }

    private static async Task<EngineResponse> DisconnectAsync(long requestId, HostState state)
    {
        if (state.State == ConnectionState.Stopped)
            return EngineResponse.Success(requestId, state.Snapshot());

        state.Transition(ConnectionState.Stopping, "Stopping profile");
        await MainController.StopAsync();
        state.Transition(ConnectionState.Stopped, "Stopped");
        return EngineResponse.Success(requestId, state.Snapshot());
    }

    private static async Task<EngineResponse> ImportLegacyAsync(EngineRequest request, HostState state)
    {
        if (state.State != ConnectionState.Stopped && state.State != ConnectionState.Failed)
            return EngineResponse.Failure(request.Id, "invalid_state", "Disconnect before importing configuration.");

        var parameters = request.Parameters.Deserialize<ImportParameters>(JsonOptions)
            ?? throw new ArgumentException("Import parameters are required.");
        var result = await LegacyImportService.ImportAsync(parameters.SourceRoot);
        state.Transition(ConnectionState.Stopped, "Import completed");
        return EngineResponse.Success(request.Id, new
        {
            importedCustomModes = result.ImportedCustomModes,
            backupDirectory = result.BackupDirectory,
            snapshot = BuildSnapshot(state)
        });
    }

    private sealed record EngineRequest(long Id, string Method, JsonElement Parameters);

    private sealed record ConnectParameters(int ServerId, int ModeId);

    private sealed record ImportParameters(string SourceRoot);

    private sealed record HostOptions(string RuntimeRoot, string RuntimeKind);

    private sealed record EngineError(string Code, string Message);

    private sealed record EngineResponse(long Id, bool Ok, object? Result, EngineError? Error, bool Shutdown = false)
    {
        public static EngineResponse Success(long id, object result, bool shutdown = false) =>
            new(id, true, result, null, shutdown);

        public static EngineResponse Failure(long id, string code, string message) =>
            new(id, false, null, new EngineError(code, message));
    }

    private enum ConnectionState
    {
        Stopped,
        Starting,
        Connected,
        Stopping,
        Failed
    }

    private sealed class HostState : IEngineObserver
    {
        private readonly object _sync = new();
        private string _message = "Stopped";

        public HostState(string runtimeKind)
        {
            RuntimeKind = runtimeKind;
        }

        public string RuntimeKind { get; }

        public ConnectionState State { get; private set; } = ConnectionState.Stopped;

        public void StatusChanged(string? status)
        {
            lock (_sync)
                _message = status ?? State.ToString();
        }

        public void Transition(ConnectionState state, string message)
        {
            lock (_sync)
            {
                State = state;
                _message = message;
            }
        }

        public void Failed(string message) => Transition(ConnectionState.Failed, message);

        public object Snapshot()
        {
            lock (_sync)
                return new { state = State.ToString().ToLowerInvariant(), message = _message };
        }
    }
}

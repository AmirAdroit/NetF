using System.Text.Json;
using System.Text.Json.Serialization;
using Netch.Controllers;
using Netch.Interfaces;
using Netch.Models;
using Netch.Services;
using Serilog;

namespace Netch.EngineHost;

internal static class Program
{
    private const int MaximumRequestCharacters = 2 * 1024 * 1024;

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
        HostState? state = null;
        try
        {
            var options = ParseOptions(args);
            state = new HostState(options.RuntimeKind);
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
            if (state != null)
                await state.StopLiveLatencyAsync();
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
                response = EngineResponse.Failure(0, "request_too_large", "Engine request exceeded 2 MiB.");
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
                    backendId = "netf-engine",
                    displayName = "NetF engine",
                    backendVersion = typeof(Program).Assembly.GetName().Version?.ToString() ?? "development",
                    components = new[]
                    {
                        new { name = "NetF Engine Host", version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "development" },
                        new { name = ".NET runtime", version = Environment.Version.ToString() }
                    },
                    supports = new[]
                    {
                        "snapshot", "status", "connect", "disconnect", "importLegacy",
                        "serverDetail", "saveServer", "importServerLink", "duplicateServer", "deleteServer",
                        "testServerLatency", "testAllServerLatencies",
                        "modeDetail", "saveMode", "mergeMode", "deleteMode", "logs", "settings",
                        "updateSettings", "desktopStartupStatus", "configureDesktopStartup",
                        "shutdown"
                    }
                }),
                "snapshot" => EngineResponse.Success(request.Id, BuildSnapshot(state)),
                "status" => EngineResponse.Success(request.Id, state.Snapshot()),
                "connect" => await ConnectAsync(request, state),
                "disconnect" => await DisconnectAsync(request.Id, state),
                "importLegacy" => await ImportLegacyAsync(request, state),
                "serverDetail" => EngineResponse.Success(request.Id, GetServerDetail(request)),
                "saveServer" => await SaveServerAsync(request, state),
                "importServerLink" => await ImportServerLinkAsync(request, state),
                "duplicateServer" => await DuplicateServerAsync(request, state),
                "deleteServer" => await DeleteServerAsync(request, state),
                "testServerLatency" => await TestServerLatencyAsync(request, state),
                "testAllServerLatencies" => await TestAllServerLatenciesAsync(request, state),
                "modeDetail" => EngineResponse.Success(request.Id, GetModeDetail(request)),
                "saveMode" => await SaveModeAsync(request, state),
                "mergeMode" => await MergeModeAsync(request, state),
                "deleteMode" => await DeleteModeAsync(request, state),
                "logs" => EngineResponse.Success(request.Id, GetLogs(request)),
                "settings" => EngineResponse.Success(request.Id, EngineSettingsService.Get()),
                "updateSettings" => await UpdateSettingsAsync(request, state),
                "desktopStartupStatus" => EngineResponse.Success(
                    request.Id,
                    DesktopStartupService.Get(GetDesktopStartupParameters(request).ExecutablePath)),
                "configureDesktopStartup" => ConfigureDesktopStartup(request),
                "shutdown" => await ShutdownAsync(request.Id, state),
                _ => EngineResponse.Failure(request.Id, "unknown_method", "The requested engine method is not allowlisted.")
            };
        }
        catch (Exception exception)
        {
            if (request.Method is "connect" or "disconnect")
                state.Failed(exception.Message);
            return EngineResponse.Failure(request.Id, "engine_error", exception.Message);
        }
    }

    private static object BuildSnapshot(HostState state)
    {
        var servers = Global.Settings.Server.Select((server, index) =>
        {
            var support = ServerManagementService.Support(server);
            var latency = ServerLatencyService.GetLatest(server, index);
            return new
            {
                id = index,
                type = server.Type,
                server.Remark,
                server.Group,
                endpoint = $"{server.Hostname}:{server.Port}",
                supported = support.Supported,
                supportMessage = support.Message,
                latency
            };
        });
        var modes = Global.Modes.Select((mode, index) =>
        {
            var detail = ModeManagementService.GetDetail(index);
            return new
            {
                id = index,
                type = mode.Type.ToString(),
                remark = mode.i18NRemark,
                source = detail.Source,
                origin = detail.Origin,
                editableInPlace = detail.EditableInPlace,
                handleCount = detail.Handle.Count,
                bypassCount = detail.Bypass.Count
            };
        });

        var capabilityRequirements = new[]
        {
            (Name: "Xray connections", Required: true, Files: new[] { "xray.exe" }),
            (Name: "Process routing", Required: true, Files: new[] { "Redirector.bin", "nfapi.dll", "nfdriver.sys" }),
            (Name: "TUN routing", Required: true, Files: new[] { "RouteHelper.bin", "wintun.dll", "tun2socks.bin" }),
            (Name: "Network sharing", Required: false, Files: new[] { "pcap2socks.exe" })
        };
        var capabilities = capabilityRequirements.Select(capability =>
        {
            var missing = capability.Files
                .Where(name => !File.Exists(Path.Combine(Global.NetchDir, "bin", name)))
                .ToArray();
            return new { name = capability.Name, capability.Required, available = missing.Length == 0, missing };
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
        var support = ServerManagementService.Support(Global.Settings.Server[parameters.ServerId]);
        if (!support.Supported)
            return EngineResponse.Failure(request.Id, "unsupported_server", support.Message ?? "The selected server is not supported by the packaged runtime.");
        if (state.State != ConnectionState.Stopped && state.State != ConnectionState.Failed)
            return EngineResponse.Failure(request.Id, "invalid_state", "Disconnect the active profile before connecting again.");

        state.Transition(ConnectionState.Starting, "Validating and starting profile");
        await MainController.StartAsync(
            Global.Settings.Server[parameters.ServerId],
            Global.Modes[parameters.ModeId],
            headless: true);
        state.Transition(ConnectionState.Connected, "Connected");
        await state.StartLiveLatencyAsync(
            Global.Settings.Server[parameters.ServerId],
            parameters.ServerId,
            Global.Settings.StartedPingInterval);
        return EngineResponse.Success(request.Id, state.Snapshot());
    }

    private static async Task<EngineResponse> DisconnectAsync(long requestId, HostState state)
    {
        await state.StopLiveLatencyAsync();
        if (state.State == ConnectionState.Stopped)
            return EngineResponse.Success(requestId, state.Snapshot());

        state.Transition(ConnectionState.Stopping, "Stopping profile");
        await MainController.StopAsync();
        state.Transition(ConnectionState.Stopped, "Stopped");
        return EngineResponse.Success(requestId, state.Snapshot());
    }

    private static async Task<EngineResponse> ShutdownAsync(long requestId, HostState state)
    {
        await state.StopLiveLatencyAsync();
        return EngineResponse.Success(requestId, state.Snapshot(), shutdown: true);
    }

    private static async Task<EngineResponse> ImportLegacyAsync(EngineRequest request, HostState state)
    {
        if (state.State != ConnectionState.Stopped && state.State != ConnectionState.Failed)
            return EngineResponse.Failure(request.Id, "invalid_state", "Disconnect before importing configuration.");

        var parameters = request.Parameters.Deserialize<ImportParameters>(JsonOptions)
            ?? throw new ArgumentException("Import parameters are required.");
        var result = await LegacyImportService.ImportAsync(parameters.SourceRoot);
        ServerLatencyService.Clear();
        state.Transition(ConnectionState.Stopped, "Import completed");
        return EngineResponse.Success(request.Id, new
        {
            importedCustomModes = result.ImportedCustomModes,
            backupDirectory = result.BackupDirectory,
            snapshot = BuildSnapshot(state)
        });
    }

    private static ModeDetail GetModeDetail(EngineRequest request)
    {
        var parameters = request.Parameters.Deserialize<ModeIdParameters>(JsonOptions)
            ?? throw new ArgumentException("Mode parameters are required.");
        return ModeManagementService.GetDetail(parameters.ModeId);
    }

    private static ServerDetail GetServerDetail(EngineRequest request)
    {
        var parameters = request.Parameters.Deserialize<ServerIdParameters>(JsonOptions)
            ?? throw new ArgumentException("Server parameters are required.");
        return ServerManagementService.GetDetail(parameters.ServerId);
    }

    private static async Task<EngineResponse> SaveServerAsync(EngineRequest request, HostState state)
    {
        RequireStopped(state, "editing a server");
        var parameters = request.Parameters.Deserialize<ServerEditRequest>(JsonOptions)
            ?? throw new ArgumentException("Server edit parameters are required.");
        var result = await ServerManagementService.SaveAsync(parameters);
        ServerLatencyService.Clear();
        state.Transition(ConnectionState.Stopped, parameters.ServerId == null ? "Server created" : "Server saved");
        return EngineResponse.Success(request.Id, new
        {
            result.Server,
            result.BackupDirectory,
            snapshot = BuildSnapshot(state)
        });
    }

    private static async Task<EngineResponse> DuplicateServerAsync(EngineRequest request, HostState state)
    {
        RequireStopped(state, "duplicating a server");
        var parameters = request.Parameters.Deserialize<ServerIdParameters>(JsonOptions)
            ?? throw new ArgumentException("Server parameters are required.");
        var result = await ServerManagementService.DuplicateAsync(parameters.ServerId);
        ServerLatencyService.Clear();
        state.Transition(ConnectionState.Stopped, "Server duplicated");
        return EngineResponse.Success(request.Id, new
        {
            result.Server,
            snapshot = BuildSnapshot(state)
        });
    }

    private static async Task<EngineResponse> ImportServerLinkAsync(EngineRequest request, HostState state)
    {
        RequireStopped(state, "importing a server link");
        var parameters = request.Parameters.Deserialize<ServerLinkParameters>(JsonOptions)
            ?? throw new ArgumentException("Server link parameters are required.");
        var result = await ServerShareLinkService.ImportAsync(parameters.Link);
        ServerLatencyService.Clear();
        state.Transition(ConnectionState.Stopped, "Server link imported");
        return EngineResponse.Success(request.Id, new
        {
            result.Server,
            snapshot = BuildSnapshot(state)
        });
    }

    private static async Task<EngineResponse> DeleteServerAsync(EngineRequest request, HostState state)
    {
        RequireStopped(state, "deleting a server");
        var parameters = request.Parameters.Deserialize<ServerIdParameters>(JsonOptions)
            ?? throw new ArgumentException("Server parameters are required.");
        var result = await ServerManagementService.DeleteAsync(parameters.ServerId);
        ServerLatencyService.Clear();
        state.Transition(ConnectionState.Stopped, "Server deleted");
        return EngineResponse.Success(request.Id, new
        {
            result.DeletedRemark,
            result.DeletedType,
            result.BackupDirectory,
            snapshot = BuildSnapshot(state)
        });
    }

    private static async Task<EngineResponse> TestServerLatencyAsync(EngineRequest request, HostState state)
    {
        if (state.State is ConnectionState.Starting or ConnectionState.Stopping)
            return EngineResponse.Failure(request.Id, "invalid_state", "Wait for the current engine transition before testing latency.");
        var parameters = request.Parameters.Deserialize<ServerIdParameters>(JsonOptions)
            ?? throw new ArgumentException("Server parameters are required.");
        if ((uint)parameters.ServerId >= (uint)Global.Settings.Server.Count)
            return EngineResponse.Failure(request.Id, "server_not_found", "The selected server no longer exists.");
        return EngineResponse.Success(request.Id, await ServerLatencyService.TestAsync(parameters.ServerId));
    }

    private static async Task<EngineResponse> TestAllServerLatenciesAsync(EngineRequest request, HostState state)
    {
        if (state.State is ConnectionState.Starting or ConnectionState.Stopping)
            return EngineResponse.Failure(request.Id, "invalid_state", "Wait for the current engine transition before testing latency.");
        return EngineResponse.Success(request.Id, await ServerLatencyService.TestAllAsync());
    }

    private static async Task<EngineResponse> SaveModeAsync(EngineRequest request, HostState state)
    {
        RequireStopped(state, "editing a mode");
        var parameters = request.Parameters.Deserialize<SaveModeParameters>(JsonOptions)
            ?? throw new ArgumentException("Mode edit parameters are required.");
        var result = await ModeManagementService.SaveAsync(
            parameters.ModeId,
            parameters.Type,
            parameters.Remark,
            parameters.Handle ?? [],
            parameters.Bypass ?? []);
        state.Transition(ConnectionState.Stopped, result.CreatedCopy ? "Custom mode created" : "Mode saved");
        return EngineResponse.Success(request.Id, new
        {
            mode = result.Mode,
            result.CreatedCopy,
            snapshot = BuildSnapshot(state)
        });
    }

    private static async Task<EngineResponse> MergeModeAsync(EngineRequest request, HostState state)
    {
        RequireStopped(state, "merging modes");
        var parameters = request.Parameters.Deserialize<MergeModeParameters>(JsonOptions)
            ?? throw new ArgumentException("Mode merge parameters are required.");
        var result = await ModeManagementService.MergeAsync(parameters.SourceModeId, parameters.TargetModeId);
        state.Transition(ConnectionState.Stopped, "Mode rules merged");
        return EngineResponse.Success(request.Id, new
        {
            mode = result.Mode,
            result.AddedHandleRules,
            result.AddedBypassRules,
            result.CreatedCopy,
            snapshot = BuildSnapshot(state)
        });
    }

    private static async Task<EngineResponse> DeleteModeAsync(EngineRequest request, HostState state)
    {
        RequireStopped(state, "deleting a mode");
        var parameters = request.Parameters.Deserialize<ModeIdParameters>(JsonOptions)
            ?? throw new ArgumentException("Mode parameters are required.");
        var result = await ModeDeletionService.DeleteAsync(parameters.ModeId);
        state.Transition(ConnectionState.Stopped, "Mode deleted");
        return EngineResponse.Success(request.Id, new
        {
            result.DeletedSource,
            result.DeletedRemark,
            result.Origin,
            result.BackupDirectory,
            snapshot = BuildSnapshot(state)
        });
    }

    private static EngineLogResult GetLogs(EngineRequest request)
    {
        var parameters = request.Parameters.Deserialize<LogParameters>(JsonOptions)
            ?? new LogParameters(200);
        return EngineLogService.ReadRecent(parameters.Limit);
    }

    private static async Task<EngineResponse> UpdateSettingsAsync(EngineRequest request, HostState state)
    {
        RequireStopped(state, "changing settings");
        var parameters = request.Parameters.Deserialize<EngineSettingsSnapshot>(JsonOptions)
            ?? throw new ArgumentException("Settings are required.");
        var settings = await EngineSettingsService.UpdateAsync(parameters);
        state.Transition(ConnectionState.Stopped, "Settings saved");
        return EngineResponse.Success(request.Id, settings);
    }

    private static EngineResponse ConfigureDesktopStartup(EngineRequest request)
    {
        var parameters = GetDesktopStartupParameters(request);
        return EngineResponse.Success(
            request.Id,
            DesktopStartupService.Configure(parameters.Enabled, parameters.ExecutablePath));
    }

    private static DesktopStartupParameters GetDesktopStartupParameters(EngineRequest request) =>
        request.Parameters.Deserialize<DesktopStartupParameters>(JsonOptions)
        ?? throw new ArgumentException("Desktop startup parameters are required.");

    private static void RequireStopped(HostState state, string operation)
    {
        if (state.State != ConnectionState.Stopped && state.State != ConnectionState.Failed)
            throw new InvalidOperationException($"Disconnect before {operation}.");
    }

    private sealed record EngineRequest(long Id, string Method, JsonElement Parameters);

    private sealed record ConnectParameters(int ServerId, int ModeId);

    private sealed record ImportParameters(string SourceRoot);

    private sealed record ModeIdParameters(int ModeId);

    private sealed record ServerIdParameters(int ServerId);

    private sealed record ServerLinkParameters(string Link);

    private sealed record SaveModeParameters(
        int? ModeId,
        string Type,
        string Remark,
        List<string>? Handle,
        List<string>? Bypass);

    private sealed record MergeModeParameters(int SourceModeId, int TargetModeId);

    private sealed record LogParameters(int Limit);

    private sealed record DesktopStartupParameters(string ExecutablePath, bool Enabled = false);

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
        private CancellationTokenSource? _liveLatencyCancellation;
        private Task? _liveLatencyTask;

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

        public async Task StartLiveLatencyAsync(Server server, int serverId, int intervalSeconds)
        {
            await StopLiveLatencyAsync();
            if (intervalSeconds <= 0)
                return;

            var cancellation = new CancellationTokenSource();
            var task = Task.Run(async () =>
            {
                try
                {
                    while (true)
                    {
                        cancellation.Token.ThrowIfCancellationRequested();
                        _ = await ServerLatencyService.TryTestAsync(server, serverId, cancellation.Token);
                        await Task.Delay(TimeSpan.FromSeconds(intervalSeconds), cancellation.Token);
                    }
                }
                catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
                {
                    // Expected during disconnect, shutdown, or host disposal.
                }
            });
            lock (_sync)
            {
                _liveLatencyCancellation = cancellation;
                _liveLatencyTask = task;
            }
        }

        public async Task StopLiveLatencyAsync()
        {
            CancellationTokenSource? cancellation;
            Task? task;
            lock (_sync)
            {
                cancellation = _liveLatencyCancellation;
                task = _liveLatencyTask;
                _liveLatencyCancellation = null;
                _liveLatencyTask = null;
            }

            if (cancellation == null)
                return;
            await cancellation.CancelAsync();
            if (task != null)
                await task;
            cancellation.Dispose();
        }

        public object Snapshot()
        {
            lock (_sync)
                return new { state = State.ToString().ToLowerInvariant(), message = _message };
        }
    }
}

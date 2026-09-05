using System.Net;
using System.Text.Json;
using Netch.Models;
using Netch.Servers;
using Netch.Utils;

namespace Netch.Services;

public sealed record SecretUpdate(string Action, string? Value = null);

public sealed record ServerConfigurationInput(
    string? Username = null,
    SecretUpdate? Password = null,
    string? Version = null,
    string? RemoteHostname = null,
    string? EncryptMethod = null,
    SecretUpdate? UserId = null,
    int? AlterId = null,
    string? TransferProtocol = null,
    string? PacketEncoding = null,
    string? FakeType = null,
    string? Host = null,
    string? ServerName = null,
    string? Path = null,
    string? TlsSecureType = null,
    bool? UseMux = null,
    string? LocalAddresses = null,
    string? PeerPublicKey = null,
    SecretUpdate? PrivateKey = null,
    SecretUpdate? PreSharedKey = null,
    int? Mtu = null);

public sealed record ServerEditRequest(
    int? ServerId,
    string Type,
    string Remark,
    string Hostname,
    ushort Port,
    ServerConfigurationInput Configuration);

public sealed record ServerConfigurationDetail(
    string? Username,
    bool HasPassword,
    string? Version,
    string? RemoteHostname,
    string? EncryptMethod,
    bool HasUserId,
    int? AlterId,
    string? TransferProtocol,
    string? PacketEncoding,
    string? FakeType,
    string? Host,
    string? ServerName,
    string? Path,
    string? TlsSecureType,
    bool? UseMux,
    string? LocalAddresses,
    string? PeerPublicKey,
    bool HasPrivateKey,
    bool HasPreSharedKey,
    int? Mtu);

public sealed record ServerDetail(
    int Id,
    string Type,
    string Remark,
    string Group,
    string Hostname,
    ushort Port,
    bool Supported,
    string? SupportMessage,
    ServerConfigurationDetail Configuration);

public sealed record ServerMutationResult(ServerDetail Server, string? BackupDirectory = null);

public sealed record ServerDeletionResult(
    string DeletedRemark,
    string DeletedType,
    string BackupDirectory);

public static class ServerManagementService
{
    private static readonly HashSet<string> SupportedShadowsocksMethods = new(StringComparer.Ordinal)
    {
        "2022-blake3-aes-128-gcm",
        "2022-blake3-aes-256-gcm",
        "2022-blake3-chacha20-poly1305",
        "aes-128-gcm",
        "aes-256-gcm",
        "chacha20-poly1305",
        "chacha20-ietf-poly1305",
        "xchacha20-poly1305",
        "xchacha20-ietf-poly1305"
    };

    private static readonly HashSet<string> SupportedTransports = new(StringComparer.Ordinal)
    {
        "tcp", "ws", "grpc"
    };

    public static IReadOnlyCollection<string> SupportedTypes { get; } =
        ["SOCKS", "SS", "VMess", "VLESS", "Trojan", "WireGuard"];

    public static ServerDetail GetDetail(int serverId)
    {
        var server = Get(serverId);
        return ToDetail(serverId, server);
    }

    public static (bool Supported, string? Message) Support(Server server)
    {
        if (!IsValidHostname(server.Hostname) || server.Port == 0)
            return (false, "The server endpoint is invalid.");
        return server switch
        {
            Socks5Server socks when socks.Version != "5" =>
                (false, "Only SOCKS5 profiles are supported by the packaged runtime."),
            Socks5Server socks when HasOnlyOne(socks.Username, socks.Password) =>
                (false, "SOCKS5 username and password must be supplied together."),
            Socks5Server socks when Has(socks.RemoteHostname) && !IsValidHostname(socks.RemoteHostname) =>
                (false, "The SOCKS5 remote hostname is invalid."),
            Socks5Server => (true, null),
            ShadowsocksServer shadowsocks when shadowsocks.HasPlugin() =>
                (false, "Shadowsocks plugins require a provider that is not packaged with NetF."),
            ShadowsocksServer shadowsocks when !SupportedShadowsocksMethods.Contains(shadowsocks.EncryptMethod) =>
                (false, $"The Shadowsocks cipher '{shadowsocks.EncryptMethod}' is not supported by the packaged runtime."),
            ShadowsocksServer shadowsocks when !Has(shadowsocks.Password) =>
                (false, "The Shadowsocks profile has no password."),
            ShadowsocksServer shadowsocks when !IsValidShadowsocksKey(shadowsocks.EncryptMethod, shadowsocks.Password) =>
                (false, "The Shadowsocks 2022 key format is invalid."),
            ShadowsocksServer => (true, null),
            ShadowsocksRServer =>
                (false, "ShadowsocksR requires a legacy provider that is not packaged with NetF."),
            SSHServer =>
                (false, "SSH profiles require a legacy provider that is not packaged with NetF."),
            TrojanServer trojan when trojan.TLSSecureType == "xtls" =>
                (false, "XTLS Trojan profiles are not supported by the packaged runtime."),
            TrojanServer trojan when trojan.TLSSecureType is not ("none" or "tls") =>
                (false, "The Trojan TLS mode is not supported by the packaged runtime."),
            TrojanServer trojan when Has(trojan.Host) && !IsValidHostname(trojan.Host) =>
                (false, "The Trojan server name is invalid."),
            TrojanServer trojan when !Has(trojan.Password) =>
                (false, "The Trojan profile has no password."),
            TrojanServer => (true, null),
            VLESSServer vless when !SupportedTransports.Contains(vless.TransferProtocol) =>
                (false, $"The {vless.TransferProtocol} transport is not supported by the packaged runtime."),
            VLESSServer vless when vless.TLSSecureType == "xtls" =>
                (false, "XTLS VLESS profiles are not supported by the packaged runtime."),
            VLESSServer vless when vless.TLSSecureType is not ("none" or "tls") =>
                (false, "The VLESS TLS mode is not supported by the packaged runtime."),
            VLESSServer vless when !Guid.TryParse(vless.UserID, out _) =>
                (false, "The VLESS profile UUID is invalid."),
            VLESSServer vless when Has(vless.ServerName) && !IsValidHostname(vless.ServerName) =>
                (false, "The VLESS server name is invalid."),
            VLESSServer vless when !VMessGlobal.PacketEncodings.Contains(vless.PacketEncoding) =>
                (false, "The VLESS packet encoding is not supported by the packaged runtime."),
            VLESSServer vless when !IsValidHeader(vless.TransferProtocol, vless.FakeType) =>
                (false, "The VLESS transport and header combination is not supported."),
            VLESSServer => (true, null),
            VMessServer vmess when !SupportedTransports.Contains(vmess.TransferProtocol) =>
                (false, $"The {vmess.TransferProtocol} transport is not supported by the packaged runtime."),
            VMessServer vmess when vmess.TLSSecureType == "xtls" =>
                (false, "XTLS VMess profiles are not supported by the packaged runtime."),
            VMessServer vmess when vmess.TLSSecureType is not ("none" or "tls") =>
                (false, "The VMess TLS mode is not supported by the packaged runtime."),
            VMessServer vmess when !Guid.TryParse(vmess.UserID, out _) =>
                (false, "The VMess user ID is invalid."),
            VMessServer vmess when Has(vmess.ServerName) && !IsValidHostname(vmess.ServerName) =>
                (false, "The VMess server name is invalid."),
            VMessServer vmess when !VMessGlobal.EncryptMethods.Contains(vmess.EncryptMethod) =>
                (false, "The VMess encryption mode is not supported by the packaged runtime."),
            VMessServer vmess when !VMessGlobal.PacketEncodings.Contains(vmess.PacketEncoding) =>
                (false, "The VMess packet encoding is not supported by the packaged runtime."),
            VMessServer vmess when !IsValidHeader(vmess.TransferProtocol, vmess.FakeType) =>
                (false, "The VMess transport and header combination is not supported."),
            VMessServer => (true, null),
            WireGuardServer wireGuard when !IsValidWireGuardAddresses(wireGuard.LocalAddresses) =>
                (false, "The WireGuard local address list is invalid."),
            WireGuardServer wireGuard when !IsValidWireGuardKey(wireGuard.PeerPublicKey)
                                               || !IsValidWireGuardKey(wireGuard.PrivateKey)
                                               || (Has(wireGuard.PreSharedKey) && !IsValidWireGuardKey(wireGuard.PreSharedKey)) =>
                (false, "The WireGuard key format is invalid."),
            WireGuardServer wireGuard when wireGuard.MTU is < 576 or > 9000 =>
                (false, "The WireGuard MTU is outside the supported range."),
            WireGuardServer => (true, null),
            _ => (false, $"Server type '{server.Type}' is not supported by the packaged runtime.")
        };
    }

    public static async Task<ServerMutationResult> SaveAsync(ServerEditRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ValidateCommon(request);

        var current = request.ServerId is { } id ? Get(id) : null;
        if (current != null && !Support(current).Supported)
            throw new InvalidOperationException("Unsupported imported profiles are read-only.");
        if (current != null && !string.Equals(current.Type, request.Type, StringComparison.Ordinal))
            throw new InvalidDataException("A server type cannot be changed in place. Create a new server instead.");

        var candidate = BuildServer(request, current);
        var support = Support(candidate);
        if (!support.Supported)
            throw new InvalidDataException(support.Message);

        var resultingId = request.ServerId ?? Global.Settings.Server.Count;
        var oldRemark = current?.Remark;
        var backupDirectory = current == null ? null : await CreateMutationBackupAsync("server-edit-backups");
        await Configuration.UpdateAsync(settings =>
        {
            if (request.ServerId is { } serverId)
            {
                if ((uint)serverId >= (uint)settings.Server.Count)
                    throw new InvalidOperationException("The selected server no longer exists.");
                settings.Server[serverId] = candidate;
                var oldRemarkStillExists = settings.Server
                    .Where((_, index) => index != serverId)
                    .Any(server => string.Equals(server.Remark, oldRemark, StringComparison.Ordinal));
                if (!oldRemarkStillExists && !string.Equals(oldRemark, candidate.Remark, StringComparison.Ordinal))
                    foreach (var profile in settings.Profiles.Where(profile => profile.ServerRemark == oldRemark))
                        profile.ServerRemark = candidate.Remark;
            }
            else
            {
                settings.Server.Add(candidate);
            }
        });

        return new ServerMutationResult(GetDetail(resultingId), backupDirectory);
    }

    public static async Task<ServerMutationResult> DuplicateAsync(int serverId)
    {
        var source = Get(serverId);
        var support = Support(source);
        if (!support.Supported)
            throw new InvalidOperationException("Unsupported imported profiles cannot be duplicated.");

        var copy = (Server)source.Clone();
        copy.Group = Constants.DefaultGroup;
        copy.Remark = UniqueCopyRemark(source.Remark, Global.Settings.Server);
        var resultingId = Global.Settings.Server.Count;
        await Configuration.UpdateAsync(settings => settings.Server.Add(copy));
        return new ServerMutationResult(GetDetail(resultingId));
    }

    public static async Task<ServerDeletionResult> DeleteAsync(int serverId)
    {
        var server = Get(serverId);
        var backup = await CreateMutationBackupAsync("deleted-server-backups");
        var deletedRemark = server.Remark;
        var deletedType = server.Type;

        await Configuration.UpdateAsync(settings =>
        {
            if ((uint)serverId >= (uint)settings.Server.Count)
                throw new InvalidOperationException("The selected server no longer exists.");
            settings.Server.RemoveAt(serverId);
            if (!settings.Server.Any(server => string.Equals(server.Remark, deletedRemark, StringComparison.Ordinal)))
                settings.Profiles.RemoveAll(profile => profile.ServerRemark == deletedRemark);
            settings.ServerComboBoxSelectedIndex = settings.Server.Count == 0
                ? -1
                : Math.Min(settings.ServerComboBoxSelectedIndex, settings.Server.Count - 1);
        });

        return new ServerDeletionResult(deletedRemark, deletedType, backup);
    }

    private static Server BuildServer(ServerEditRequest request, Server? current)
    {
        var configuration = request.Configuration ?? throw new InvalidDataException("Server configuration is required.");
        Server result = request.Type switch
        {
            "SOCKS" => BuildSocks(request, configuration, current as Socks5Server),
            "SS" => BuildShadowsocks(request, configuration, current as ShadowsocksServer),
            "VMess" => BuildVmess(request, configuration, current as VMessServer, false),
            "VLESS" => BuildVmess(request, configuration, current as VLESSServer, true),
            "Trojan" => BuildTrojan(request, configuration, current as TrojanServer),
            "WireGuard" => BuildWireGuard(request, configuration, current as WireGuardServer),
            _ => throw new InvalidDataException("The requested server type is not supported by the packaged runtime.")
        };
        result.Remark = request.Remark.Trim();
        result.Hostname = NormalizeHostname(request.Hostname);
        result.Port = request.Port;
        result.Group = current?.Group ?? Constants.DefaultGroup;
        return result;
    }

    private static Socks5Server BuildSocks(
        ServerEditRequest request,
        ServerConfigurationInput configuration,
        Socks5Server? current)
    {
        var username = CleanOptional(configuration.Username);
        var password = ApplySecret(configuration.Password, current?.Password, false, request.ServerId == null, "SOCKS5 password");
        if (HasOnlyOne(username, password))
            throw new InvalidDataException("SOCKS5 username and password must be supplied together.");
        if ((configuration.Version ?? "5") != "5")
            throw new InvalidDataException("Only SOCKS5 profiles are supported by the packaged runtime.");
        return new Socks5Server
        {
            Username = username,
            Password = password,
            Version = "5",
            RemoteHostname = CleanOptional(configuration.RemoteHostname)
        };
    }

    private static ShadowsocksServer BuildShadowsocks(
        ServerEditRequest request,
        ServerConfigurationInput configuration,
        ShadowsocksServer? current)
    {
        var method = configuration.EncryptMethod ?? "aes-256-gcm";
        if (!SupportedShadowsocksMethods.Contains(method))
            throw new InvalidDataException("The selected Shadowsocks cipher is not supported by the packaged runtime.");
        var password = ApplySecret(configuration.Password, current?.Password, true, request.ServerId == null, "Shadowsocks password")!;
        if (!IsValidShadowsocksKey(method, password))
            throw new InvalidDataException("The selected Shadowsocks 2022 cipher requires a correctly sized Base64 key.");
        return new ShadowsocksServer
        {
            Password = password,
            EncryptMethod = method,
            Plugin = null,
            PluginOption = null
        };
    }

    private static VMessServer BuildVmess(
        ServerEditRequest request,
        ServerConfigurationInput configuration,
        VMessServer? current,
        bool vless)
    {
        var userId = ApplySecret(configuration.UserId, current?.UserID, true, request.ServerId == null, vless ? "VLESS UUID" : "VMess user ID")!;
        if (!Guid.TryParse(userId, out _))
            throw new InvalidDataException(vless ? "VLESS UUID must be a valid UUID." : "VMess user ID must be a valid UUID.");
        var transport = configuration.TransferProtocol ?? "tcp";
        if (!SupportedTransports.Contains(transport))
            throw new InvalidDataException("Only TCP, WebSocket, and gRPC transports are supported by the packaged runtime.");
        var packetEncoding = configuration.PacketEncoding ?? "xudp";
        if (!VMessGlobal.PacketEncodings.Contains(packetEncoding))
            throw new InvalidDataException("Packet encoding was not recognized.");
        var fakeType = configuration.FakeType ?? "none";
        if (!VMessGlobal.FakeTypes.Contains(fakeType))
            throw new InvalidDataException("Transport header type was not recognized.");
        if (!IsValidHeader(transport, fakeType))
            throw new InvalidDataException("The selected transport and header combination is not supported by the packaged runtime.");
        var tls = configuration.TlsSecureType ?? "none";
        if (tls is not ("none" or "tls"))
            throw new InvalidDataException("Only standard TLS or no TLS is supported.");

        VMessServer server = vless ? new VLESSServer() : new VMessServer();
        server.UserID = userId;
        server.AlterID = vless ? 0 : Math.Max(0, configuration.AlterId ?? 0);
        server.EncryptMethod = vless ? "none" : configuration.EncryptMethod ?? "auto";
        if (!vless && !VMessGlobal.EncryptMethods.Contains(server.EncryptMethod))
            throw new InvalidDataException("VMess encryption was not recognized.");
        server.TransferProtocol = transport;
        server.PacketEncoding = packetEncoding;
        server.FakeType = fakeType;
        server.Host = CleanOptional(configuration.Host);
        server.Path = CleanOptional(configuration.Path);
        server.TLSSecureType = tls;
        server.UseMux = configuration.UseMux;
        server.ServerName = CleanOptional(configuration.ServerName);
        return server;
    }

    private static TrojanServer BuildTrojan(
        ServerEditRequest request,
        ServerConfigurationInput configuration,
        TrojanServer? current)
    {
        var tls = configuration.TlsSecureType ?? "tls";
        if (tls is not ("none" or "tls"))
            throw new InvalidDataException("Only standard TLS or no TLS is supported.");
        return new TrojanServer
        {
            Password = ApplySecret(configuration.Password, current?.Password, true, request.ServerId == null, "Trojan password")!,
            Host = CleanOptional(configuration.Host),
            TLSSecureType = tls
        };
    }

    private static WireGuardServer BuildWireGuard(
        ServerEditRequest request,
        ServerConfigurationInput configuration,
        WireGuardServer? current)
    {
        var mtu = configuration.Mtu ?? 1420;
        if (mtu is < 576 or > 9000)
            throw new InvalidDataException("WireGuard MTU must be between 576 and 9000.");
        if (string.IsNullOrWhiteSpace(configuration.LocalAddresses))
            throw new InvalidDataException("WireGuard local addresses are required.");
        if (string.IsNullOrWhiteSpace(configuration.PeerPublicKey))
            throw new InvalidDataException("WireGuard peer public key is required.");
        if (!IsValidWireGuardAddresses(configuration.LocalAddresses))
            throw new InvalidDataException("WireGuard local addresses must be comma-separated IP addresses with optional CIDR prefixes.");
        if (!IsValidWireGuardKey(configuration.PeerPublicKey))
            throw new InvalidDataException("WireGuard peer public key must be a Base64-encoded 32-byte key.");
        var privateKey = ApplySecret(configuration.PrivateKey, current?.PrivateKey, true, request.ServerId == null, "WireGuard private key")!;
        var preSharedKey = ApplySecret(configuration.PreSharedKey, current?.PreSharedKey, false, request.ServerId == null, "WireGuard pre-shared key");
        if (!IsValidWireGuardKey(privateKey))
            throw new InvalidDataException("WireGuard private key must be a Base64-encoded 32-byte key.");
        if (Has(preSharedKey) && !IsValidWireGuardKey(preSharedKey))
            throw new InvalidDataException("WireGuard pre-shared key must be a Base64-encoded 32-byte key.");
        return new WireGuardServer
        {
            LocalAddresses = configuration.LocalAddresses.Trim(),
            PeerPublicKey = configuration.PeerPublicKey.Trim(),
            PrivateKey = privateKey,
            PreSharedKey = preSharedKey,
            MTU = mtu
        };
    }

    private static string? ApplySecret(
        SecretUpdate? update,
        string? current,
        bool required,
        bool creating,
        string label)
    {
        var action = update?.Action?.Trim().ToLowerInvariant() ?? (creating ? "replace" : "keep");
        var value = action switch
        {
            "keep" when !creating => current,
            "replace" => CleanOptional(update?.Value),
            "clear" when !required => null,
            "keep" => throw new InvalidDataException($"{label} must be supplied when creating a server."),
            "clear" => throw new InvalidDataException($"{label} cannot be cleared."),
            _ => throw new InvalidDataException($"{label} update action was not recognized.")
        };
        if (required && string.IsNullOrWhiteSpace(value))
            throw new InvalidDataException($"{label} is required.");
        return value;
    }

    private static void ValidateCommon(ServerEditRequest request)
    {
        if (!SupportedTypes.Contains(request.Type))
            throw new InvalidDataException("The requested server type is not supported by the packaged runtime.");
        if (request.ServerId is < 0)
            throw new InvalidDataException("Server id cannot be negative.");
        if (request.Port == 0)
            throw new InvalidDataException("Server port must be between 1 and 65535.");
        if (request.Remark == null)
            throw new InvalidDataException("Server name field is required.");
        if (request.Remark.Length > 128 || request.Remark.Any(char.IsControl))
            throw new InvalidDataException("Server name must be at most 128 characters and contain no control characters.");
        if (!IsValidHostname(request.Hostname))
            throw new InvalidDataException("Server address must be a valid hostname or IP address.");
    }

    private static Server Get(int serverId)
    {
        if ((uint)serverId >= (uint)Global.Settings.Server.Count)
            throw new InvalidOperationException("The selected server no longer exists.");
        return Global.Settings.Server[serverId];
    }

    private static ServerDetail ToDetail(int id, Server server)
    {
        var support = Support(server);
        var configuration = server switch
        {
            Socks5Server socks => new ServerConfigurationDetail(
                Username: socks.Username, HasPassword: Has(socks.Password), Version: socks.Version,
                RemoteHostname: socks.RemoteHostname, EncryptMethod: null, HasUserId: false,
                AlterId: null, TransferProtocol: null, PacketEncoding: null, FakeType: null,
                Host: null, ServerName: null, Path: null, TlsSecureType: null, UseMux: null,
                LocalAddresses: null, PeerPublicKey: null, HasPrivateKey: false,
                HasPreSharedKey: false, Mtu: null),
            ShadowsocksServer shadowsocks => new ServerConfigurationDetail(
                Username: null, HasPassword: Has(shadowsocks.Password), Version: null,
                RemoteHostname: null, EncryptMethod: shadowsocks.EncryptMethod, HasUserId: false,
                AlterId: null, TransferProtocol: null, PacketEncoding: null, FakeType: null,
                Host: null, ServerName: null, Path: null, TlsSecureType: null, UseMux: null,
                LocalAddresses: null, PeerPublicKey: null, HasPrivateKey: false,
                HasPreSharedKey: false, Mtu: null),
            VLESSServer vless => VmessDetail(vless),
            VMessServer vmess => VmessDetail(vmess),
            TrojanServer trojan => new ServerConfigurationDetail(
                Username: null, HasPassword: Has(trojan.Password), Version: null,
                RemoteHostname: null, EncryptMethod: null, HasUserId: false,
                AlterId: null, TransferProtocol: null, PacketEncoding: null, FakeType: null,
                Host: trojan.Host, ServerName: null, Path: null, TlsSecureType: trojan.TLSSecureType,
                UseMux: null, LocalAddresses: null, PeerPublicKey: null, HasPrivateKey: false,
                HasPreSharedKey: false, Mtu: null),
            WireGuardServer wireGuard => new ServerConfigurationDetail(
                Username: null, HasPassword: false, Version: null, RemoteHostname: null,
                EncryptMethod: null, HasUserId: false, AlterId: null, TransferProtocol: null,
                PacketEncoding: null, FakeType: null, Host: null, ServerName: null, Path: null,
                TlsSecureType: null, UseMux: null, LocalAddresses: wireGuard.LocalAddresses,
                PeerPublicKey: wireGuard.PeerPublicKey, HasPrivateKey: Has(wireGuard.PrivateKey),
                HasPreSharedKey: Has(wireGuard.PreSharedKey), Mtu: wireGuard.MTU),
            _ => new ServerConfigurationDetail(
                Username: null, HasPassword: false, Version: null, RemoteHostname: null,
                EncryptMethod: null, HasUserId: false, AlterId: null, TransferProtocol: null,
                PacketEncoding: null, FakeType: null, Host: null, ServerName: null, Path: null,
                TlsSecureType: null, UseMux: null, LocalAddresses: null, PeerPublicKey: null,
                HasPrivateKey: false, HasPreSharedKey: false, Mtu: null)
        };
        return new ServerDetail(
            id,
            server.Type,
            server.Remark,
            server.Group,
            server.Hostname,
            server.Port,
            support.Supported,
            support.Message,
            configuration);
    }

    private static ServerConfigurationDetail VmessDetail(VMessServer server) => new(
        null,
        false,
        null,
        null,
        server.EncryptMethod,
        Has(server.UserID),
        server.AlterID,
        server.TransferProtocol,
        server.PacketEncoding,
        server.FakeType,
        server.Host,
        server.ServerName,
        server.Path,
        server.TLSSecureType,
        server.UseMux,
        null,
        null,
        false,
        false,
        null);

    private static string UniqueCopyRemark(string remark, IEnumerable<Server> servers)
    {
        var baseRemark = string.IsNullOrWhiteSpace(remark) ? "Server copy" : $"{remark} copy";
        var existing = new HashSet<string>(servers.Select(server => server.Remark), StringComparer.OrdinalIgnoreCase);
        if (!existing.Contains(baseRemark))
            return baseRemark;
        for (var suffix = 2; suffix < int.MaxValue; suffix++)
        {
            var candidate = $"{baseRemark} {suffix}";
            if (!existing.Contains(candidate))
                return candidate;
        }
        throw new InvalidOperationException("Could not allocate a unique server name.");
    }

    private static async Task<string> CreateMutationBackupAsync(string category)
    {
        var source = Configuration.FileFullName;
        if (!File.Exists(source))
            throw new FileNotFoundException("The current NetF configuration could not be backed up.", source);
        var stamp = $"{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}";
        var root = Path.Combine(Configuration.DataDirectoryFullName, category, stamp);
        Directory.CreateDirectory(root);
        var destination = Path.Combine(root, "settings.json");
        await using var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
        await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true);
        await input.CopyToAsync(output);
        await output.FlushAsync();
#pragma warning disable VSTHRD103 // Flush(true) is intentionally synchronous to durably persist the backup before deletion.
        output.Flush(true);
#pragma warning restore VSTHRD103
        return root;
    }

    private static bool Has(string? value) => !string.IsNullOrWhiteSpace(value);

    private static bool HasOnlyOne(string? left, string? right) => Has(left) != Has(right);

    private static bool IsValidHostname(string? value)
    {
        var host = NormalizeHostname(value);
        if (host.Length is 0 or > 253 || host.Any(character => char.IsWhiteSpace(character) || char.IsControl(character)))
            return false;
        return Uri.CheckHostName(host) != UriHostNameType.Unknown;
    }

    private static string NormalizeHostname(string? value)
    {
        var host = value?.Trim() ?? string.Empty;
        return host.StartsWith('[') && host.EndsWith(']') ? host[1..^1] : host;
    }

    private static bool IsValidHeader(string transport, string fakeType) => transport switch
    {
        "tcp" => fakeType is "none" or "http",
        "ws" => fakeType == "none",
        "grpc" => fakeType is "none" or "gun" or "multi",
        _ => false
    };

    private static bool IsValidShadowsocksKey(string method, string password)
    {
        if (!method.StartsWith("2022-", StringComparison.Ordinal))
            return true;
        var expectedLength = method == "2022-blake3-aes-128-gcm" ? 16 : 32;
        try
        {
            return Convert.FromBase64String(password).Length == expectedLength;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static bool IsValidWireGuardKey(string? value)
    {
        if (!Has(value))
            return false;
        try
        {
            return Convert.FromBase64String(value!).Length == 32;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static bool IsValidWireGuardAddresses(string? value)
    {
        if (!Has(value))
            return false;
        var addresses = value!.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (addresses.Length == 0)
            return false;
        foreach (var item in addresses)
        {
            var parts = item.Split('/');
            if (parts.Length > 2 || !IPAddress.TryParse(parts[0], out var address))
                return false;
            var maximumPrefix = address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork ? 32 : 128;
            if (parts.Length == 2 && (!int.TryParse(parts[1], out var prefix) || prefix < 0 || prefix > maximumPrefix))
                return false;
        }
        return true;
    }

    private static string? CleanOptional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

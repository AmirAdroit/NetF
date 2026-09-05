import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type {
  EngineSettings,
  EngineSnapshot,
  ModeDetail,
  ModeEditRequest,
  ServerConfigurationDetail,
  ServerDetail,
  ServerEditRequest,
  ServerLinkImportRequest,
  ServerLatencyResult,
} from "./engine";
import type { DesktopSettings } from "./desktop";

const modeNames = [
  ["Age of Empires IV", "built-in"],
  ["Battle.net and WoW", "imported"],
  ["Counter-Strike 2", "user"],
  ["Discord", "built-in"],
  ["DOOM Eternal", "built-in"],
  ["Dota 2", "user"],
  ["Global", "built-in"],
  ["Steam Games", "built-in"],
  ["Visual Studio Code", "imported"],
  ["World of Warcraft", "user"],
] as const;

let snapshot: EngineSnapshot = {
  apiVersion: 1,
  status: { state: "stopped", message: "Stopped" },
  servers: [
    { id: 0, type: "SOCKS", remark: "Throne", group: "NONE", endpoint: "127.0.0.1:2080", supported: true, supportMessage: "Ready" },
    { id: 1, type: "VLESS", remark: "Primary Xray", group: "Personal", endpoint: "vpn.example.com:443", supported: true, supportMessage: "Ready" },
  ],
  modes: modeNames.map(([remark, origin], id) => ({
    id,
    type: remark === "Global" ? "TunMode" : "ProcessMode",
    remark,
    source: origin === "built-in" ? `Game\\${remark}.txt` : `Custom\\${origin === "user" ? "User" : "Imported"}\\${remark}.json`,
    origin,
    editableInPlace: origin !== "built-in",
    handleCount: id + 2,
    bypassCount: id % 3,
  })),
  missingHelpers: ["pcap2socks.exe"],
  capabilities: [
    { name: "Xray connections", available: true, required: true, missing: [] },
    { name: "Process routing", available: true, required: true, missing: [] },
    { name: "TUN routing", available: true, required: true, missing: [] },
    { name: "Network sharing", available: false, required: false, missing: ["pcap2socks.exe"] },
  ],
  coreSource: "owned-runtime",
  proxyCores: ["direct SOCKS", "Xray"],
};

const emptyServerConfiguration = (): ServerConfigurationDetail => ({
  username: null,
  hasPassword: false,
  version: null,
  remoteHostname: null,
  encryptMethod: null,
  hasUserId: false,
  alterId: null,
  transferProtocol: null,
  packetEncoding: null,
  fakeType: null,
  host: null,
  serverName: null,
  path: null,
  tlsSecureType: null,
  useMux: null,
  localAddresses: null,
  peerPublicKey: null,
  hasPrivateKey: false,
  hasPreSharedKey: false,
  mtu: null,
});

const serverDetails = new Map<number, ServerDetail>([
  [0, {
    ...snapshot.servers[0],
    hostname: "127.0.0.1",
    port: 2080,
    configuration: { ...emptyServerConfiguration(), username: "demo", hasPassword: true, version: "5" },
  }],
  [1, {
    ...snapshot.servers[1],
    hostname: "vpn.example.com",
    port: 443,
    configuration: {
      ...emptyServerConfiguration(),
      hasUserId: true,
      encryptMethod: "none",
      transferProtocol: "ws",
      packetEncoding: "xudp",
      fakeType: "none",
      host: "cdn.example.com",
      serverName: "vpn.example.com",
      path: "/socket",
      tlsSecureType: "tls",
      useMux: false,
    },
  }],
]);

const details = new Map<number, ModeDetail>(snapshot.modes.map((mode) => [mode.id, {
  ...mode,
  handle: Array.from({ length: mode.handleCount }, (_, index) => `${mode.remark.replaceAll(" ", "")}Helper${index + 1}\\.exe`),
  bypass: Array.from({ length: mode.bypassCount }, (_, index) => `Bypass${index + 1}\\.exe`),
}]));

let settings: EngineSettings = {
  localAddress: "127.0.0.1",
  socks5LocalPort: 2801,
  httpLocalPort: 2802,
  requestTimeout: 10000,
  serverTcpPing: true,
  filterTcp: true,
  filterUdp: true,
  filterDns: true,
  handleOnlyDns: true,
  dnsProxy: true,
  dnsHost: "1.1.1.1:53",
  filterParent: false,
  filterIcmp: false,
  icmpDelay: 10,
  tunAddress: "10.0.236.10",
  tunNetmask: "255.255.255.0",
  tunGateway: "10.0.236.1",
  tunUseCustomDns: true,
  tunDns: "1.1.1.1",
  tunProxyDns: false,
  liveLatencyIntervalSeconds: -1,
  allowInsecure: false,
  useMux: false,
  xrayCone: true,
  tcpFastOpen: false,
};

let desktopSettings: DesktopSettings = {
  schemaVersion: 2,
  runAtWindowsLogin: false,
  closeBehavior: "hideToTray",
};

export async function installDevelopmentMock() {
  mockIPC((command, args) => {
    const payload = args as Record<string, unknown> | undefined;
    if (command === "desktop_startup_status_snapshot") return { phase: "ready", message: "NetF is ready", elapsedMs: 420, retryable: false };
    if (command === "engine_runtime_state") return { phase: snapshot.status.state, active: snapshot.status.state === "connected", message: snapshot.status.message, updatedAtMs: Date.now() };
    if (command === "retry_desktop_startup") return { phase: "ready", message: "NetF is ready", elapsedMs: 420, retryable: false };
    if (command === "runtime_info") return {
      runtimeRoot: "C:\\Users\\Demo\\AppData\\Local\\NetF\\runtime",
      runtimeVersion: "0.2.0",
      backend: {
        id: "netf-engine",
        displayName: "NetF engine",
        version: "0.2.0",
        apiVersion: 1,
        capabilities: ["snapshot", "status", "connect", "disconnect"],
        components: [],
      },
    };
    if (command === "open_owned_folder") return null;
    if (command === "previous_netf_data_available") return false;
    if (command === "engine_snapshot") return snapshot;
    if (command === "server_detail") return serverDetails.get(Number(payload?.serverId));
    if (command === "test_server_latency") {
      const serverId = Number(payload?.serverId);
      const result: ServerLatencyResult = { serverId, status: "success", method: settings.serverTcpPing ? "tcp" : "icmp", latencyMs: 42 + serverId, testedAtUtc: new Date().toISOString() };
      snapshot = { ...snapshot, servers: snapshot.servers.map((server) => server.id === serverId ? { ...server, latency: result } : server) };
      return result;
    }
    if (command === "test_all_server_latencies") {
      const results = snapshot.servers.map((server) => ({ serverId: server.id, status: "success" as const, method: settings.serverTcpPing ? "tcp" as const : "icmp" as const, latencyMs: 42 + server.id, testedAtUtc: new Date().toISOString() }));
      snapshot = { ...snapshot, servers: snapshot.servers.map((server) => ({ ...server, latency: results.find((result) => result.serverId === server.id) })) };
      return { results, total: results.length, timedOut: false };
    }
    if (command === "mode_detail") return details.get(Number(payload?.modeId));
    if (command === "engine_logs") return {
      source: "logging/application.log",
      truncated: false,
      lines: [
        "[2026-08-09 01:20:11][Information] Owned runtime verified",
        "[2026-08-09 01:20:13][Information] Loaded 2 servers and 10 modes",
        "[2026-08-09 01:21:02][Information] Start MainController: SOCKS [1]World of Warcraft",
        "[2026-08-09 01:21:03][Information] Redirector started",
        "[2026-08-09 01:25:14][Information] Stop Main Controller",
      ],
    };
    if (command === "engine_settings") return settings;
    if (command === "update_engine_settings") {
      settings = payload?.settings as EngineSettings;
      return settings;
    }
    if (command === "desktop_settings") return desktopSettings;
    if (command === "desktop_autostart_status") return {
      enabled: desktopSettings.runAtWindowsLogin,
      matchesCurrentExecutable: desktopSettings.runAtWindowsLogin,
      taskName: "NetF Startup",
      registeredExecutable: desktopSettings.runAtWindowsLogin ? "C:\\Program Files\\NetF\\NetF.exe" : null,
      message: desktopSettings.runAtWindowsLogin ? "Registered and verified" : "Not registered",
    };
    if (command === "update_desktop_settings") {
      desktopSettings = payload?.settings as DesktopSettings;
      return desktopSettings;
    }
    if (command === "save_server") {
      const request = payload?.request as ServerEditRequest;
      const previous = request.serverId === null ? undefined : serverDetails.get(request.serverId);
      const id = previous?.id ?? snapshot.servers.length;
      const input = request.configuration;
      const hasSecret = (update: { action: string; value?: string } | undefined, saved: boolean) =>
        update?.action === "keep" ? saved : update?.action === "replace" ? Boolean(update.value) : false;
      const configuration: ServerConfigurationDetail = {
        username: input.username ?? null,
        hasPassword: hasSecret(input.password, previous?.configuration.hasPassword ?? false),
        version: input.version ?? null,
        remoteHostname: input.remoteHostname ?? null,
        encryptMethod: input.encryptMethod ?? null,
        hasUserId: hasSecret(input.userId, previous?.configuration.hasUserId ?? false),
        alterId: input.alterId ?? null,
        transferProtocol: input.transferProtocol ?? null,
        packetEncoding: input.packetEncoding ?? null,
        fakeType: input.fakeType ?? null,
        host: input.host ?? null,
        serverName: input.serverName ?? null,
        path: input.path ?? null,
        tlsSecureType: input.tlsSecureType ?? null,
        useMux: input.useMux ?? null,
        localAddresses: input.localAddresses ?? null,
        peerPublicKey: input.peerPublicKey ?? null,
        hasPrivateKey: hasSecret(input.privateKey, previous?.configuration.hasPrivateKey ?? false),
        hasPreSharedKey: hasSecret(input.preSharedKey, previous?.configuration.hasPreSharedKey ?? false),
        mtu: input.mtu ?? null,
      };
      const server: ServerDetail = {
        id,
        type: request.type,
        remark: request.remark,
        group: previous?.group ?? "NONE",
        hostname: request.hostname,
        port: request.port,
        endpoint: `${request.hostname}:${request.port}`,
        supported: true,
        supportMessage: "Ready",
        configuration,
      };
      serverDetails.set(id, server);
      snapshot = { ...snapshot, servers: [...snapshot.servers.filter((item) => item.id !== id), server] };
      return { server, snapshot };
    }
    if (command === "import_server_link") {
      const request = payload?.request as ServerLinkImportRequest;
      const scheme = request.link.slice(0, request.link.indexOf(":"));
      const type = ({ vless: "VLESS", vmess: "VMess", trojan: "Trojan", ss: "SS", socks: "SOCKS", socks5: "SOCKS" } as Record<string, string>)[scheme.toLocaleLowerCase()] ?? "VLESS";
      const id = snapshot.servers.length;
      const configuration = {
        ...emptyServerConfiguration(),
        hasPassword: type === "Trojan" || type === "SS" || type === "SOCKS",
        hasUserId: type === "VLESS" || type === "VMess",
        encryptMethod: type === "VLESS" ? "none" : type === "VMess" ? "auto" : null,
        transferProtocol: type === "VLESS" || type === "VMess" ? "ws" : null,
        packetEncoding: type === "VLESS" || type === "VMess" ? "xudp" : null,
        fakeType: type === "VLESS" || type === "VMess" ? "none" : null,
        path: type === "VLESS" || type === "VMess" ? "/" : null,
        tlsSecureType: type === "Trojan" ? "tls" : "none",
      };
      const server: ServerDetail = {
        id,
        type,
        remark: `Imported ${type}`,
        group: "NONE",
        hostname: "imported.example.com",
        port: 443,
        endpoint: "imported.example.com:443",
        supported: true,
        supportMessage: "Ready",
        configuration,
      };
      serverDetails.set(id, server);
      snapshot = { ...snapshot, servers: [...snapshot.servers, server] };
      return { server, snapshot };
    }
    if (command === "duplicate_server") {
      const source = serverDetails.get(Number(payload?.serverId))!;
      const id = snapshot.servers.length;
      const server = { ...source, id, remark: `${source.remark} copy`, configuration: { ...source.configuration } };
      serverDetails.set(id, server);
      snapshot = { ...snapshot, servers: [...snapshot.servers, server] };
      return { server, snapshot };
    }
    if (command === "delete_server") {
      const serverId = Number(payload?.serverId);
      const deleted = serverDetails.get(serverId)!;
      const remaining = snapshot.servers
        .filter((server) => server.id !== serverId)
        .map((server) => serverDetails.get(server.id)!);
      serverDetails.clear();
      snapshot = {
        ...snapshot,
        servers: remaining.map((server, id) => {
          const remapped = { ...server, id };
          serverDetails.set(id, remapped);
          return remapped;
        }),
      };
      return { deletedRemark: deleted.remark, deletedType: deleted.type, backupDirectory: "C:\\Users\\Demo\\AppData\\Local\\NetF\\runtime\\data\\deleted-server-backups\\sample", snapshot };
    }
    if (command === "save_mode") {
      const request = payload?.request as ModeEditRequest;
      const existing = request.modeId === null ? undefined : details.get(request.modeId);
      const id = existing?.id ?? snapshot.modes.length;
      const mode: ModeDetail = {
        id,
        type: request.type,
        remark: request.remark,
        source: existing?.editableInPlace ? existing.source : `Custom\\User\\${request.remark}.json`,
        origin: existing?.editableInPlace ? existing.origin : "user",
        editableInPlace: true,
        handleCount: request.handle.length,
        bypassCount: request.bypass.length,
        handle: request.handle,
        bypass: request.bypass,
      };
      details.set(id, mode);
      snapshot = { ...snapshot, modes: [...snapshot.modes.filter((item) => item.id !== id), mode] };
      return { mode, createdCopy: !existing?.editableInPlace, snapshot };
    }
    if (command === "merge_modes") {
      const target = details.get(Number(payload?.targetModeId))!;
      return { mode: target, addedHandleRules: 2, addedBypassRules: 1, createdCopy: !target.editableInPlace, snapshot };
    }
    if (command === "delete_mode") {
      const modeId = Number(payload?.modeId);
      const deleted = details.get(modeId)!;
      details.delete(modeId);
      const remaining = snapshot.modes
        .filter((mode) => mode.id !== modeId)
        .map((mode, id) => ({ ...mode, id }));
      const remapped = new Map<number, ModeDetail>();
      for (const mode of remaining) {
        const original = [...details.values()].find((item) => item.source === mode.source);
        if (original) remapped.set(mode.id, { ...original, id: mode.id });
      }
      details.clear();
      remapped.forEach((value, key) => details.set(key, value));
      snapshot = { ...snapshot, modes: remaining };
      return {
        deletedSource: deleted.source,
        deletedRemark: deleted.remark,
        origin: deleted.origin,
        backupDirectory: "C:\\Users\\Demo\\AppData\\Local\\NetF\\runtime\\data\\deleted-mode-backups\\sample",
        snapshot,
      };
    }
    if (command === "connect_profile") {
      snapshot = { ...snapshot, status: { state: "connected", message: "Connected" } };
      void emit("engine-status-changed", { phase: "connected", active: true, message: "Connected", updatedAtMs: Date.now() });
      return snapshot.status;
    }
    if (command === "disconnect_profile") {
      snapshot = { ...snapshot, status: { state: "stopped", message: "Stopped" } };
      void emit("engine-status-changed", { phase: "stopped", active: false, message: "Stopped", updatedAtMs: Date.now() });
      return snapshot.status;
    }
    if (command.startsWith("plugin:dialog|")) return null;
    throw new Error(`Development mock does not implement ${command}`);
  }, { shouldMockEvents: true });
}

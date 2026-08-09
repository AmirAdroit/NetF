import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type {
  EngineSettings,
  EngineSnapshot,
  ModeDetail,
  ModeEditRequest,
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
    { id: 0, type: "SOCKS", remark: "Throne", group: "NONE" },
    { id: 1, type: "VLESS", remark: "Primary Xray", group: "Personal" },
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
    { name: "Process routing", available: true, missing: [] },
    { name: "TUN routing", available: true, missing: [] },
    { name: "Split DNS", available: true, missing: [] },
    { name: "Network sharing", available: false, missing: ["pcap2socks.exe"] },
  ],
  coreSource: "owned-runtime",
  proxyCores: ["direct SOCKS", "Xray"],
};

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
  filterIcmp: false,
  icmpDelay: 10,
  allowInsecure: false,
  useMux: false,
  xrayCone: true,
  tcpFastOpen: false,
};

let desktopSettings: DesktopSettings = {
  schemaVersion: 1,
  runAtWindowsLogin: false,
};

export async function installDevelopmentMock() {
  mockIPC((command, args) => {
    const payload = args as Record<string, unknown> | undefined;
    if (command === "desktop_startup_status_snapshot") return { phase: "ready", message: "NetF is ready", elapsedMs: 420, retryable: false };
    if (command === "engine_runtime_state") return { phase: snapshot.status.state, active: snapshot.status.state === "connected", message: snapshot.status.message, updatedAtMs: Date.now() };
    if (command === "retry_desktop_startup") return { phase: "ready", message: "NetF is ready", elapsedMs: 420, retryable: false };
    if (command === "runtime_info") return {
      runtimeRoot: "C:\\Users\\Demo\\AppData\\Local\\NetF\\runtime",
      runtimeVersion: "0.1.0",
      backend: {
        id: "netch-compat",
        displayName: "Netch compatibility engine",
        version: "0.1.0",
        apiVersion: 1,
        capabilities: ["snapshot", "status", "connect", "disconnect"],
        components: [],
      },
    };
    if (command === "engine_snapshot") return snapshot;
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

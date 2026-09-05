import { describe, expect, it } from "vitest";
import {
  canConnect,
  canMutateModes,
  canSubmitServerLink,
  canStopEngine,
  filterModes,
  filterModesByOrigin,
  filterServers,
  latencyLabel,
  modeLabel,
  modeOriginLabel,
  serverLabel,
  supportedHeaderTypes,
  type EngineSnapshot,
} from "./engine";

const snapshot: EngineSnapshot = {
  apiVersion: 1,
  status: { state: "stopped", message: "Stopped" },
  servers: [{ id: 0, type: "VLESS", remark: "Primary", group: "Default", endpoint: "example.com:443", supported: true, supportMessage: "Ready" }],
  modes: [{
    id: 0,
    type: "ProcessMode",
    remark: "",
    source: "Game\\DOOM.txt",
    origin: "built-in",
    editableInPlace: false,
    handleCount: 4,
    bypassCount: 1,
  }],
  missingHelpers: [],
  capabilities: [{ name: "Process routing", available: true, required: true, missing: [] }],
  coreSource: "attached-runtime",
  proxyCores: ["direct SOCKS", "Xray"],
};

describe("engine view model", () => {
  it("falls back to safe non-secret labels", () => {
    expect(serverLabel(snapshot.servers[0])).toBe("Primary");
    expect(serverLabel({ id: 2, type: "Trojan", remark: "", group: "Default", endpoint: "example.com:443", supported: true, supportMessage: "Ready" })).toBe(
      "Trojan server 3",
    );
    expect(modeLabel(snapshot.modes[0])).toBe("Game\\DOOM");
  });

  it("connects only from a stopped or failed state with both selections", () => {
    expect(canConnect(snapshot, 0, 0)).toBe(true);
    expect(canConnect(snapshot, null, 0)).toBe(false);
    expect(
      canConnect({ ...snapshot, status: { state: "connected", message: "Connected" } }, 0, 0),
    ).toBe(false);
  });

  it("keeps stop available when a failed request leaves state uncertain", () => {
    expect(canStopEngine(snapshot, false)).toBe(false);
    expect(canStopEngine(snapshot, true)).toBe(true);
    expect(
      canStopEngine(
        { ...snapshot, status: { state: "connected", message: "Connected" } },
        false,
      ),
    ).toBe(true);
  });

  it("allows mode mutation only while the engine is stopped or failed", () => {
    expect(canMutateModes(snapshot)).toBe(true);
    expect(canMutateModes({ ...snapshot, status: { state: "failed", message: "Failed" } })).toBe(true);
    expect(canMutateModes({ ...snapshot, status: { state: "connected", message: "Connected" } })).toBe(false);
    expect(canMutateModes({ ...snapshot, status: { state: "unknown", message: "Unknown" } })).toBe(false);
  });

  it("searches all mode metadata and sorts labels alphabetically", () => {
    const modes = [
      { ...snapshot.modes[0], id: 2, remark: "zeta", origin: "user" as const },
      { ...snapshot.modes[0], id: 1, remark: "Alpha", origin: "imported" as const },
    ];

    expect(filterModes(modes, "").map((mode) => mode.remark)).toEqual(["Alpha", "zeta"]);
    expect(filterModes(modes, "imported").map((mode) => mode.remark)).toEqual(["Alpha"]);
    expect(modeOriginLabel(modes[0].origin)).toBe("User");
    expect(filterModesByOrigin(modes, "", "imported").map((mode) => mode.remark)).toEqual(["Alpha"]);
  });

  it("searches server metadata and rejects unsupported selections", () => {
    const unsupported = { ...snapshot.servers[0], id: 1, remark: "Old profile", endpoint: "old.example:443", supported: false };
    const withUnsupported = { ...snapshot, servers: [...snapshot.servers, unsupported] };
    expect(filterServers(withUnsupported.servers, "old.example")).toEqual([unsupported]);
    expect(canConnect(withUnsupported, unsupported.id, 0)).toBe(false);
  });

  it("renders credential-free endpoint latency states", () => {
    expect(latencyLabel(null)).toBe("Not tested");
    expect(latencyLabel({ serverId: 0, status: "success", method: "tcp", latencyMs: 42, testedAtUtc: "2026-08-14T00:00:00Z" })).toBe("42 ms");
    expect(latencyLabel({ serverId: 0, status: "dnsFailure", method: "tcp", latencyMs: null, testedAtUtc: "2026-08-14T00:00:00Z" })).toBe("DNS failed");
    expect(latencyLabel({ serverId: 0, status: "timeout", method: "icmp", latencyMs: null, testedAtUtc: "2026-08-14T00:00:00Z" })).toBe("Timed out");
    expect(latencyLabel({ serverId: 0, status: "error", method: "tcp", latencyMs: null, testedAtUtc: "2026-08-14T00:00:00Z" })).toBe("Test failed");
  });

  it("exposes only Xray-compatible transport headers", () => {
    expect(supportedHeaderTypes("tcp")).toEqual(["none", "http"]);
    expect(supportedHeaderTypes("ws")).toEqual(["none"]);
    expect(supportedHeaderTypes("grpc")).toEqual(["none", "gun", "multi"]);
  });

  it("submits only one bounded server link while mutations are unlocked", () => {
    expect(canSubmitServerLink("vless://id@example.com:443", false, false)).toBe(true);
    expect(canSubmitServerLink("", false, false)).toBe(false);
    expect(canSubmitServerLink("vless://one\nvmess://two", false, false)).toBe(false);
    expect(canSubmitServerLink("vless://id@example.com:443", true, false)).toBe(false);
    expect(canSubmitServerLink("vless://id@example.com:443", false, true)).toBe(false);
    expect(canSubmitServerLink(`vless://${"a".repeat(8192)}`, false, false)).toBe(false);
  });
});

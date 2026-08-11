import { describe, expect, it } from "vitest";
import {
  canConnect,
  canMutateModes,
  canStopEngine,
  filterModes,
  modeLabel,
  modeOriginLabel,
  serverLabel,
  type EngineSnapshot,
} from "./engine";

const snapshot: EngineSnapshot = {
  apiVersion: 1,
  status: { state: "stopped", message: "Stopped" },
  servers: [{ id: 0, type: "VLESS", remark: "Primary", group: "Default" }],
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
  capabilities: [{ name: "Process routing", available: true, missing: [] }],
  coreSource: "attached-runtime",
  proxyCores: ["direct SOCKS", "Xray"],
};

describe("engine view model", () => {
  it("falls back to safe non-secret labels", () => {
    expect(serverLabel(snapshot.servers[0])).toBe("Primary");
    expect(serverLabel({ id: 2, type: "Trojan", remark: "", group: "Default" })).toBe(
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
  });
});

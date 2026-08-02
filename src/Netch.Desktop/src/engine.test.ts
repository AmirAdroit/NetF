import { describe, expect, it } from "vitest";
import {
  canConnect,
  canStopEngine,
  modeLabel,
  serverLabel,
  type EngineSnapshot,
} from "./engine";

const snapshot: EngineSnapshot = {
  apiVersion: 1,
  status: { state: "stopped", message: "Stopped" },
  servers: [{ id: 0, type: "VLESS", remark: "Primary", group: "Default" }],
  modes: [{ id: 0, type: "ProcessMode", remark: "", source: "Game\\DOOM.txt" }],
  missingHelpers: [],
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
});

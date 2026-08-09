import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { EngineSnapshot } from "./engine";
import {
  errorMessage,
  type EngineRuntimeState,
  type RuntimeInfo,
  type StartupSnapshot,
} from "./desktop";

const waitingStartup: StartupSnapshot = {
  phase: "waiting",
  message: "Waiting for desktop initialization",
  elapsedMs: 0,
  retryable: false,
};

const unknownEngine: EngineRuntimeState = {
  phase: "unknown",
  active: false,
  message: "Engine status is not known yet",
  updatedAtMs: 0,
};

export function useDesktopController() {
  const [startup, setStartup] = useState(waitingStartup);
  const [engine, setEngine] = useState(unknownEngine);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [error, setError] = useState("");

  const hydrate = useCallback(async () => {
    const [runtimeInfo, engineSnapshot] = await Promise.all([
      invoke<RuntimeInfo>("runtime_info"),
      invoke<EngineSnapshot>("engine_snapshot"),
    ]);
    setRuntime(runtimeInfo);
    setSnapshot(engineSnapshot);
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisten: UnlistenFn[] = [];

    async function initialize() {
      try {
        unlisten.push(await listen<StartupSnapshot>("desktop-startup-changed", ({ payload }) => {
          if (disposed) return;
          setStartup(payload);
          if (payload.phase === "ready") {
            void hydrate().catch((loadError) => setError(errorMessage(loadError)));
          }
        }));
        unlisten.push(await listen<EngineRuntimeState>("engine-status-changed", ({ payload }) => {
          if (disposed) return;
          setEngine(payload);
          setSnapshot((current) => current ? {
            ...current,
            status: {
              state: payload.phase,
              message: payload.message,
            },
          } : current);
        }));

        const [startupSnapshot, engineState] = await Promise.all([
          invoke<StartupSnapshot>("desktop_startup_status_snapshot"),
          invoke<EngineRuntimeState>("engine_runtime_state"),
        ]);
        if (disposed) return;
        setStartup(startupSnapshot);
        setEngine(engineState);
        if (startupSnapshot.phase === "ready") await hydrate();
      } catch (loadError) {
        if (!disposed) setError(errorMessage(loadError));
      }
    }

    void initialize();
    return () => {
      disposed = true;
      unlisten.forEach((stop) => stop());
    };
  }, [hydrate]);

  const retry = useCallback(async () => {
    setError("");
    setRuntime(null);
    setSnapshot(null);
    setStartup(await invoke<StartupSnapshot>("retry_desktop_startup"));
  }, []);

  const refresh = useCallback(async () => {
    await hydrate();
  }, [hydrate]);

  return {
    startup,
    engine,
    runtime,
    snapshot,
    setSnapshot,
    error,
    setError,
    retry,
    refresh,
  };
}

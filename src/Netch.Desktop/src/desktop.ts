import type { EngineSnapshot } from "./engine";

export type StartupPhase =
  | "waiting"
  | "loadingSettings"
  | "preparingRuntime"
  | "startingEngine"
  | "ready"
  | "failed";

export interface StartupSnapshot {
  phase: StartupPhase;
  message: string;
  elapsedMs: number;
  retryable: boolean;
}

export type EnginePhase =
  | "stopped"
  | "starting"
  | "connected"
  | "stopping"
  | "failed"
  | "unknown";

export interface EngineRuntimeState {
  phase: EnginePhase;
  active: boolean;
  message: string;
  updatedAtMs: number;
}

export interface BackendComponent {
  name: string;
  version: string;
}

export interface BackendInfo {
  id: string;
  displayName: string;
  version: string;
  apiVersion: number;
  capabilities: string[];
  components: BackendComponent[];
}

export interface RuntimeInfo {
  runtimeRoot: string;
  runtimeVersion: string;
  backend: BackendInfo | null;
}

export interface DesktopSettings {
  schemaVersion: number;
  runAtWindowsLogin: boolean;
}

export interface DesktopStartupStatus {
  enabled: boolean;
  matchesCurrentExecutable: boolean;
  taskName: string;
  registeredExecutable: string | null;
  message: string | null;
}

export interface DesktopError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface DesktopModel {
  startup: StartupSnapshot;
  engine: EngineRuntimeState;
  runtime: RuntimeInfo | null;
  snapshot: EngineSnapshot | null;
}

export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return String(error);
}

export function enginePresentation(phase: EnginePhase) {
  switch (phase) {
    case "connected":
      return { label: "ACTIVE — TRAFFIC ROUTING", shortLabel: "Active", tone: "active" } as const;
    case "starting":
      return { label: "STARTING — PREPARING TUNNEL", shortLabel: "Starting", tone: "transition" } as const;
    case "stopping":
      return { label: "STOPPING — RESTORING NETWORK", shortLabel: "Stopping", tone: "transition" } as const;
    case "stopped":
      return { label: "INACTIVE — TUNNEL STOPPED", shortLabel: "Inactive", tone: "inactive" } as const;
    case "failed":
      return { label: "ATTENTION REQUIRED", shortLabel: "Failed", tone: "failed" } as const;
    default:
      return { label: "STATUS UNKNOWN", shortLabel: "Unknown", tone: "unknown" } as const;
  }
}

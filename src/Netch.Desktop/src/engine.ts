export interface EngineStatus {
  state: "stopped" | "starting" | "connected" | "stopping" | "failed";
  message: string;
}

export interface ServerSummary {
  id: number;
  type: string;
  remark: string;
  group: string;
}

export interface ModeSummary {
  id: number;
  type: string;
  remark: string;
  source: string;
}

export interface EngineSnapshot {
  apiVersion: number;
  status: EngineStatus;
  servers: ServerSummary[];
  modes: ModeSummary[];
  missingHelpers: string[];
}

export function modeLabel(mode: ModeSummary): string {
  return mode.remark.trim() || mode.source.replace(/\.(json|txt)$/i, "");
}

export function serverLabel(server: ServerSummary): string {
  return server.remark.trim() || `${server.type} server ${server.id + 1}`;
}

export function canConnect(
  snapshot: EngineSnapshot | null,
  serverId: number | null,
  modeId: number | null,
): boolean {
  return Boolean(
    snapshot &&
      (snapshot.status.state === "stopped" || snapshot.status.state === "failed") &&
      serverId !== null &&
      modeId !== null,
  );
}

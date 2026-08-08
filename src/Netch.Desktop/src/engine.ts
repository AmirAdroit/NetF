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
  origin: "built-in" | "imported" | "user";
  editableInPlace: boolean;
  handleCount: number;
  bypassCount: number;
}

export interface ModeDetail extends ModeSummary {
  handle: string[];
  bypass: string[];
}

export interface ModeEditRequest {
  modeId: number | null;
  type: "ProcessMode" | "TunMode";
  remark: string;
  handle: string[];
  bypass: string[];
}

export interface ModeSaveResult {
  mode: ModeDetail;
  createdCopy: boolean;
  snapshot: EngineSnapshot;
}

export interface ModeMergeResult extends ModeSaveResult {
  addedHandleRules: number;
  addedBypassRules: number;
}

export interface EngineSnapshot {
  apiVersion: number;
  status: EngineStatus;
  servers: ServerSummary[];
  modes: ModeSummary[];
  missingHelpers: string[];
  capabilities: RuntimeCapability[];
  coreSource: string;
  proxyCores: string[];
}

export interface RuntimeCapability {
  name: string;
  available: boolean;
  missing: string[];
}

export interface RuntimeInfo {
  runtimeRoot: string;
  runtimeVersion: string;
}

export interface LegacyImportResult {
  importedCustomModes: number;
  backupDirectory: string;
  snapshot: EngineSnapshot;
}

export interface EngineLogResult {
  lines: string[];
  truncated: boolean;
  source: string;
}

export interface EngineSettings {
  localAddress: string;
  socks5LocalPort: number;
  httpLocalPort: number;
  requestTimeout: number;
  serverTcpPing: boolean;
  filterTcp: boolean;
  filterUdp: boolean;
  filterDns: boolean;
  handleOnlyDns: boolean;
  dnsProxy: boolean;
  dnsHost: string;
  filterIcmp: boolean;
  icmpDelay: number;
  allowInsecure: boolean;
  useMux: boolean;
  xrayCone: boolean;
  tcpFastOpen: boolean;
}

export function modeLabel(mode: ModeSummary): string {
  return mode.remark.trim() || mode.source.replace(/\.(json|txt)$/i, "");
}

export function serverLabel(server: ServerSummary): string {
  return server.remark.trim() || `${server.type} server ${server.id + 1}`;
}

export function filterModes(modes: ModeSummary[], query: string): ModeSummary[] {
  const normalized = query.trim().toLocaleLowerCase();
  return [...modes]
    .filter((mode) =>
      !normalized ||
      `${mode.remark} ${mode.source} ${mode.type} ${mode.origin}`
        .toLocaleLowerCase()
        .includes(normalized),
    )
    .sort((left, right) =>
      modeLabel(left).localeCompare(modeLabel(right), undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    );
}

export function modeOriginLabel(origin: ModeSummary["origin"]): string {
  if (origin === "built-in") return "Built-in";
  if (origin === "imported") return "Imported";
  return "User";
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

export function canStopEngine(
  snapshot: EngineSnapshot | null,
  connectionMayBeActive: boolean,
): boolean {
  return Boolean(
    snapshot &&
      (connectionMayBeActive || snapshot.status.state !== "stopped"),
  );
}

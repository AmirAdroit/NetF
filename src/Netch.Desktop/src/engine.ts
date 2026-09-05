export interface EngineStatus {
  state: "stopped" | "starting" | "connected" | "stopping" | "failed" | "unknown";
  message: string;
}

export interface ServerSummary {
  id: number;
  type: string;
  remark: string;
  group: string;
  endpoint: string;
  supported: boolean;
  supportMessage: string | null;
  latency?: ServerLatencyResult | null;
}

export interface ServerLatencyResult {
  serverId: number;
  status: "success" | "timeout" | "dnsFailure" | "error";
  method: "tcp" | "icmp";
  latencyMs: number | null;
  testedAtUtc: string;
}

export interface ServerLatencyBatchResult {
  results: ServerLatencyResult[];
  total: number;
  timedOut: boolean;
}

export type SupportedServerType = "SOCKS" | "SS" | "VMess" | "VLESS" | "Trojan" | "WireGuard";
export type SecretAction = "keep" | "replace" | "clear";
export const MAXIMUM_SERVER_LINK_CHARACTERS = 8192;

export interface SecretUpdate {
  action: SecretAction;
  value?: string;
}

export interface ServerConfigurationInput {
  username?: string;
  password?: SecretUpdate;
  version?: string;
  remoteHostname?: string;
  encryptMethod?: string;
  userId?: SecretUpdate;
  alterId?: number;
  transferProtocol?: string;
  packetEncoding?: string;
  fakeType?: string;
  host?: string;
  serverName?: string;
  path?: string;
  tlsSecureType?: string;
  useMux?: boolean;
  localAddresses?: string;
  peerPublicKey?: string;
  privateKey?: SecretUpdate;
  preSharedKey?: SecretUpdate;
  mtu?: number;
}

export interface ServerConfigurationDetail {
  username: string | null;
  hasPassword: boolean;
  version: string | null;
  remoteHostname: string | null;
  encryptMethod: string | null;
  hasUserId: boolean;
  alterId: number | null;
  transferProtocol: string | null;
  packetEncoding: string | null;
  fakeType: string | null;
  host: string | null;
  serverName: string | null;
  path: string | null;
  tlsSecureType: string | null;
  useMux: boolean | null;
  localAddresses: string | null;
  peerPublicKey: string | null;
  hasPrivateKey: boolean;
  hasPreSharedKey: boolean;
  mtu: number | null;
}

export interface ServerDetail extends ServerSummary {
  hostname: string;
  port: number;
  configuration: ServerConfigurationDetail;
}

export interface ServerEditRequest {
  serverId: number | null;
  type: SupportedServerType;
  remark: string;
  hostname: string;
  port: number;
  configuration: ServerConfigurationInput;
}

export interface ServerLinkImportRequest {
  link: string;
}

export interface ServerSaveResult {
  server: ServerDetail;
  backupDirectory?: string | null;
  snapshot: EngineSnapshot;
}

export interface ServerDeleteResult {
  deletedRemark: string;
  deletedType: string;
  backupDirectory: string;
  snapshot: EngineSnapshot;
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

export interface ModeDeleteResult {
  deletedSource: string;
  deletedRemark: string;
  origin: ModeSummary["origin"];
  backupDirectory: string;
  snapshot: EngineSnapshot;
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
  required: boolean;
  available: boolean;
  missing: string[];
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
  filterParent: boolean;
  filterIcmp: boolean;
  icmpDelay: number;
  tunAddress: string;
  tunNetmask: string;
  tunGateway: string;
  tunUseCustomDns: boolean;
  tunDns: string;
  tunProxyDns: boolean;
  liveLatencyIntervalSeconds: number;
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

export function latencyLabel(latency: ServerLatencyResult | null | undefined): string {
  if (!latency) return "Not tested";
  if (latency.status === "success" && latency.latencyMs !== null) return `${latency.latencyMs} ms`;
  if (latency.status === "dnsFailure") return "DNS failed";
  if (latency.status === "timeout") return "Timed out";
  return "Test failed";
}

export function filterServers(servers: ServerSummary[], query: string): ServerSummary[] {
  const normalized = query.trim().toLocaleLowerCase();
  return [...servers]
    .filter((server) =>
      !normalized ||
      `${server.remark} ${server.type} ${server.group} ${server.endpoint}`
        .toLocaleLowerCase()
        .includes(normalized),
    )
    .sort((left, right) => serverLabel(left).localeCompare(serverLabel(right), undefined, {
      sensitivity: "base",
      numeric: true,
    }));
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

export type ModeOriginFilter = "all" | ModeSummary["origin"];

export function filterModesByOrigin(
  modes: ModeSummary[],
  query: string,
  origin: ModeOriginFilter,
): ModeSummary[] {
  return filterModes(modes, query).filter((mode) => origin === "all" || mode.origin === origin);
}

export function supportedHeaderTypes(transport: string | undefined): string[] {
  if (transport === "grpc") return ["none", "gun", "multi"];
  if (transport === "tcp") return ["none", "http"];
  return ["none"];
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
      modeId !== null &&
      snapshot.servers.some((server) => server.id === serverId && server.supported),
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

export function canMutateModes(snapshot: EngineSnapshot): boolean {
  return snapshot.status.state === "stopped" || snapshot.status.state === "failed";
}

export function canSubmitServerLink(link: string, busy: boolean, locked: boolean): boolean {
  const trimmed = link.trim();
  return !busy && !locked && trimmed.length > 0 && trimmed.length <= MAXIMUM_SERVER_LINK_CHARACTERS && !/[\r\n\0]/.test(trimmed);
}

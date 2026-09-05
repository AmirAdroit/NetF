import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  canSubmitServerLink,
  filterServers,
  MAXIMUM_SERVER_LINK_CHARACTERS,
  latencyLabel,
  supportedHeaderTypes,
  serverLabel,
  type EngineSnapshot,
  type SecretAction,
  type SecretUpdate,
  type ServerConfigurationInput,
  type ServerDeleteResult,
  type ServerDetail,
  type ServerEditRequest,
  type ServerLinkImportRequest,
  type ServerLatencyBatchResult,
  type ServerSaveResult,
  type SupportedServerType,
} from "./engine";
import { errorMessage } from "./desktop";
import { SearchIcon, ServerIcon } from "./icons";

const serverTypes: Array<[SupportedServerType, string]> = [
  ["SOCKS", "SOCKS5"],
  ["SS", "Shadowsocks"],
  ["VMess", "VMess"],
  ["VLESS", "VLESS"],
  ["Trojan", "Trojan"],
  ["WireGuard", "WireGuard"],
];

const shadowsocksMethods = [
  "2022-blake3-aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "2022-blake3-chacha20-poly1305",
  "aes-128-gcm",
  "aes-256-gcm",
  "chacha20-poly1305",
  "chacha20-ietf-poly1305",
  "xchacha20-poly1305",
  "xchacha20-ietf-poly1305",
];

interface ServerLibraryProps {
  snapshot: EngineSnapshot;
  onSnapshot: (snapshot: EngineSnapshot) => void;
  onSelectForConnection: (serverId: number) => void;
}

function secret(action: SecretAction, value = ""): SecretUpdate {
  return { action, value };
}

function newServer(type: SupportedServerType): ServerEditRequest {
  const configuration: ServerConfigurationInput = {};
  if (type === "SOCKS") Object.assign(configuration, { version: "5", password: secret("replace") });
  if (type === "SS") Object.assign(configuration, { encryptMethod: "aes-256-gcm", password: secret("replace") });
  if (type === "VMess" || type === "VLESS") Object.assign(configuration, {
    userId: secret("replace"),
    alterId: 0,
    encryptMethod: type === "VLESS" ? "none" : "auto",
    transferProtocol: "tcp",
    packetEncoding: "xudp",
    fakeType: "none",
    tlsSecureType: "none",
  });
  if (type === "Trojan") Object.assign(configuration, { password: secret("replace"), tlsSecureType: "tls" });
  if (type === "WireGuard") Object.assign(configuration, {
    localAddresses: "172.16.0.2/32",
    privateKey: secret("replace"),
    preSharedKey: secret("replace"),
    mtu: 1420,
  });
  return { serverId: null, type, remark: "", hostname: "", port: type === "WireGuard" ? 51820 : 0, configuration };
}

function editServer(detail: ServerDetail): ServerEditRequest {
  const configuration: ServerConfigurationInput = {
    username: detail.configuration.username ?? undefined,
    password: secret(detail.configuration.hasPassword ? "keep" : "replace"),
    version: detail.configuration.version ?? undefined,
    remoteHostname: detail.configuration.remoteHostname ?? undefined,
    encryptMethod: detail.configuration.encryptMethod ?? undefined,
    userId: secret(detail.configuration.hasUserId ? "keep" : "replace"),
    alterId: detail.configuration.alterId ?? undefined,
    transferProtocol: detail.configuration.transferProtocol ?? undefined,
    packetEncoding: detail.configuration.packetEncoding ?? undefined,
    fakeType: detail.configuration.fakeType ?? undefined,
    host: detail.configuration.host ?? undefined,
    serverName: detail.configuration.serverName ?? undefined,
    path: detail.configuration.path ?? undefined,
    tlsSecureType: detail.configuration.tlsSecureType ?? undefined,
    useMux: detail.configuration.useMux ?? undefined,
    localAddresses: detail.configuration.localAddresses ?? undefined,
    peerPublicKey: detail.configuration.peerPublicKey ?? undefined,
    privateKey: secret(detail.configuration.hasPrivateKey ? "keep" : "replace"),
    preSharedKey: secret(detail.configuration.hasPreSharedKey ? "keep" : "clear"),
    mtu: detail.configuration.mtu ?? undefined,
  };
  return {
    serverId: detail.id,
    type: detail.type as SupportedServerType,
    remark: detail.remark,
    hostname: detail.hostname,
    port: detail.port,
    configuration,
  };
}

function SecretField({
  label,
  update,
  hasSaved,
  required,
  onChange,
}: {
  label: string;
  update: SecretUpdate | undefined;
  hasSaved: boolean;
  required?: boolean;
  onChange: (update: SecretUpdate) => void;
}) {
  const action = update?.action ?? (hasSaved ? "keep" : "replace");
  return (
    <label className="secret-field">
      <span>{label}</span>
      <div>
        <select aria-label={`${label} action`} value={action} onChange={(event) => onChange(secret(event.target.value as SecretAction))}>
          {hasSaved && <option value="keep">Keep saved</option>}
          <option value="replace">Replace</option>
          {!required && <option value="clear">Clear</option>}
        </select>
        <input
          aria-label={`${label} value`}
          autoComplete="new-password"
          disabled={action !== "replace"}
          onChange={(event) => onChange(secret("replace", event.target.value))}
          placeholder={action === "keep" ? "Saved securely" : action === "clear" ? "Will be removed" : `Enter ${label.toLocaleLowerCase()}`}
          type="password"
          value={action === "replace" ? update?.value ?? "" : ""}
        />
      </div>
    </label>
  );
}

export function ServerLibrary({ snapshot, onSnapshot, onSelectForConnection }: ServerLibraryProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(snapshot.servers[0]?.id ?? null);
  const [detail, setDetail] = useState<ServerDetail | null>(null);
  const [draft, setDraft] = useState<ServerEditRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [serverLink, setServerLink] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ServerDetail | null>(null);
  const locked = snapshot.status.state !== "stopped" && snapshot.status.state !== "failed";
  const filtered = useMemo(() => filterServers(snapshot.servers, query), [snapshot.servers, query]);

  useEffect(() => {
    if (selectedId === null) return;
    if (!snapshot.servers.some((server) => server.id === selectedId)) {
      setSelectedId(snapshot.servers[0]?.id ?? null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError("");
    invoke<ServerDetail>("server_detail", { serverId: selectedId })
      .then((loaded) => {
        if (cancelled) return;
        setDetail(loaded);
        setDraft(loaded.supported ? editServer(loaded) : null);
      })
      .catch((loadError) => !cancelled && setError(errorMessage(loadError)))
      .finally(() => !cancelled && setBusy(false));
    return () => { cancelled = true; };
  }, [selectedId, snapshot.servers]);

  function updateCommon<K extends keyof ServerEditRequest>(key: K, value: ServerEditRequest[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setMessage("");
  }

  function updateConfiguration<K extends keyof ServerConfigurationInput>(key: K, value: ServerConfigurationInput[K]) {
    setDraft((current) => current ? { ...current, configuration: { ...current.configuration, [key]: value } } : current);
    setMessage("");
  }

  function startNew(type: SupportedServerType = "SOCKS") {
    setSelectedId(null);
    setDetail(null);
    setDraft(newServer(type));
    setMessage("");
    setError("");
  }

  async function save() {
    if (!draft || busy || locked) return;
    try {
      setBusy(true); setError(""); setMessage("");
      const saved = await invoke<ServerSaveResult>("save_server", { request: draft });
      onSnapshot(saved.snapshot);
      setSelectedId(saved.server.id);
      setDetail(saved.server);
      setDraft(editServer(saved.server));
      onSelectForConnection(saved.server.id);
      setMessage(draft.serverId === null
        ? "Server created and selected for connection."
        : saved.backupDirectory ? "Server saved atomically after a timestamped backup." : "Server saved atomically.");
    } catch (saveError) { setError(errorMessage(saveError)); }
    finally { setBusy(false); }
  }

  async function duplicate() {
    if (!detail || busy || locked || !detail.supported) return;
    try {
      setBusy(true); setError(""); setMessage("");
      const duplicated = await invoke<ServerSaveResult>("duplicate_server", { serverId: detail.id });
      onSnapshot(duplicated.snapshot);
      setSelectedId(duplicated.server.id);
      onSelectForConnection(duplicated.server.id);
      setMessage("Server duplicated without exposing its saved credentials.");
    } catch (duplicateError) { setError(errorMessage(duplicateError)); }
    finally { setBusy(false); }
  }

  async function importLink() {
    if (!canSubmitServerLink(serverLink, busy, locked)) return;
    const request: ServerLinkImportRequest = { link: serverLink.trim() };
    setServerLink("");
    try {
      setBusy(true); setError(""); setMessage("");
      const imported = await invoke<ServerSaveResult>("import_server_link", { request });
      onSnapshot(imported.snapshot);
      setSelectedId(imported.server.id);
      setDetail(imported.server);
      setDraft(editServer(imported.server));
      onSelectForConnection(imported.server.id);
      setMessage(`${imported.server.type} server imported and selected. The pasted link was cleared.`);
    } catch (importError) {
      setError(`${errorMessage(importError)} The pasted link was cleared.`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleteTarget || busy || locked) return;
    try {
      setBusy(true); setError(""); setMessage("");
      const deleted = await invoke<ServerDeleteResult>("delete_server", { serverId: deleteTarget.id });
      setDeleteTarget(null); setDetail(null); setDraft(null);
      const next = deleted.snapshot.servers[0]?.id ?? null;
      setSelectedId(next); onSnapshot(deleted.snapshot);
      if (next !== null) onSelectForConnection(next);
      setMessage(`${deleted.deletedRemark || deleted.deletedType} was deleted after a durable backup.`);
    } catch (deleteError) { setError(errorMessage(deleteError)); }
    finally { setBusy(false); }
  }

  async function testAll() {
    if (busy || snapshot.status.state === "starting" || snapshot.status.state === "stopping") return;
    try {
      setBusy(true); setError(""); setMessage("");
      const tested = await invoke<ServerLatencyBatchResult>("test_all_server_latencies");
      onSnapshot(await invoke<EngineSnapshot>("engine_snapshot"));
      setMessage(tested.timedOut
        ? `Tested ${tested.results.length} of ${tested.total} servers before the 60-second limit.`
        : `Tested ${tested.results.length} server${tested.results.length === 1 ? "" : "s"}.`);
    } catch (testError) { setError(errorMessage(testError)); }
    finally { setBusy(false); }
  }

  const configuration = draft?.configuration;
  return (
    <section className="server-library-grid" aria-label="Server library and editor">
      <div className="panel server-link-import">
        <div><span className="step-label">Paste share link</span><h2>Import a server</h2><p>VLESS, VMess, Trojan, Shadowsocks, and SOCKS5 links are parsed locally. Unsupported options fail closed; WireGuard remains in the manual form.</p></div>
        <textarea
          aria-label="Server share link"
          autoCapitalize="none"
          autoComplete="off"
          maxLength={MAXIMUM_SERVER_LINK_CHARACTERS}
          onChange={(event) => { setServerLink(event.target.value); setError(""); setMessage(""); }}
          placeholder="vless://…  vmess://…  trojan://…  ss://…  socks5://…"
          rows={2}
          spellCheck={false}
          value={serverLink}
        />
        <button className="primary-action" disabled={!canSubmitServerLink(serverLink, busy, locked)} onClick={importLink} type="button">{busy ? "Importing…" : "Import link"}</button>
      </div>
      <div className="panel server-library-panel">
        <div className="panel-heading"><div><span className="step-label">Server library</span><h2>{snapshot.servers.length} servers</h2></div><div className="mode-heading-actions"><button disabled={busy || snapshot.status.state === "starting" || snapshot.status.state === "stopping"} onClick={() => void testAll()} type="button">{busy ? "Working…" : "Test all"}</button><button onClick={() => startNew()} type="button">+ Add</button></div></div>
        <label className="mode-search"><SearchIcon /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, endpoint, type, or group" /></label>
        <div className="server-list" role="listbox" aria-label="Servers">
          {filtered.map((server) => (
            <button aria-selected={server.id === selectedId} className={server.id === selectedId ? "selected" : ""} key={server.id} onClick={() => setSelectedId(server.id)} role="option" type="button">
              <ServerIcon /><span><strong>{serverLabel(server)}</strong><small>{server.type} · {server.endpoint}</small></span><em className={`latency-badge ${server.latency?.status ?? "untested"}`}>{latencyLabel(server.latency)}</em><i className={server.supported ? "status-ok" : "status-warn"} title={server.supportMessage ?? "Supported"} />
            </button>
          ))}
          {!filtered.length && <p className="mode-empty">No servers match your search.</p>}
        </div>
      </div>

      <div className="panel server-editor">
        <div className="panel-heading">
          <div><span className="step-label">Configuration editor</span><h2>{draft?.remark || detail?.remark || (draft ? "New server" : "Choose a server")}</h2></div>
          {detail && <div className="mode-heading-actions">{detail.supported && <button disabled={busy || locked} onClick={duplicate} type="button">Duplicate</button>}<button className="danger-action compact-danger" disabled={busy || locked} onClick={() => setDeleteTarget(detail)} type="button">Delete</button></div>}
        </div>
        {!draft && !detail && <div className="empty-state"><span><ServerIcon /></span><h3>Select or add a server</h3><p>Connection credentials remain inside the engine after saving.</p></div>}
        {detail && !detail.supported && <div className="helper-warning"><strong>Read-only imported profile</strong><p>{detail.supportMessage}</p><p>NetF will not attempt an unsafe fallback provider.</p></div>}
        {draft && (
          <div className="server-form">
            <label>Server type<select disabled={draft.serverId !== null} value={draft.type} onChange={(event) => startNew(event.target.value as SupportedServerType)}>{serverTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Display name<input maxLength={128} value={draft.remark} onChange={(event) => updateCommon("remark", event.target.value)} placeholder="Optional friendly name" /></label>
            <div className="server-endpoint-fields"><label>Address<input value={draft.hostname} onChange={(event) => updateCommon("hostname", event.target.value)} placeholder="proxy.example.com" /></label><label>Port<input min={1} max={65535} type="number" value={draft.port || ""} onChange={(event) => updateCommon("port", Number(event.target.value))} /></label></div>

            {draft.type === "SOCKS" && <>
              <label>Username<input value={configuration?.username ?? ""} onChange={(event) => updateConfiguration("username", event.target.value)} /></label>
              <SecretField label="Password" update={configuration?.password} hasSaved={detail?.configuration.hasPassword ?? false} onChange={(value) => updateConfiguration("password", value)} />
              <label>Remote address<input value={configuration?.remoteHostname ?? ""} onChange={(event) => updateConfiguration("remoteHostname", event.target.value)} placeholder="Optional destination hint" /></label>
            </>}
            {draft.type === "SS" && <>
              <label>Cipher<select value={configuration?.encryptMethod ?? "aes-256-gcm"} onChange={(event) => updateConfiguration("encryptMethod", event.target.value)}>{shadowsocksMethods.map((method) => <option key={method}>{method}</option>)}</select></label>
              <SecretField required label="Password" update={configuration?.password} hasSaved={detail?.configuration.hasPassword ?? false} onChange={(value) => updateConfiguration("password", value)} />
            </>}
            {(draft.type === "VMess" || draft.type === "VLESS") && <>
              <SecretField required label={draft.type === "VLESS" ? "UUID" : "User ID"} update={configuration?.userId} hasSaved={detail?.configuration.hasUserId ?? false} onChange={(value) => updateConfiguration("userId", value)} />
              {draft.type === "VMess" && <><label>Alter ID<input min={0} type="number" value={configuration?.alterId ?? 0} onChange={(event) => updateConfiguration("alterId", Number(event.target.value))} /></label><label>Encryption<select value={configuration?.encryptMethod ?? "auto"} onChange={(event) => updateConfiguration("encryptMethod", event.target.value)}>{["auto", "none", "aes-128-gcm", "chacha20-poly1305", "zero"].map((value) => <option key={value}>{value}</option>)}</select></label></>}
              <label>Transport<select value={configuration?.transferProtocol ?? "tcp"} onChange={(event) => { const transport = event.target.value; updateConfiguration("transferProtocol", transport); updateConfiguration("fakeType", supportedHeaderTypes(transport)[0]); }}>{["tcp", "ws", "grpc"].map((value) => <option key={value}>{value}</option>)}</select></label>
              <label>Packet encoding<select value={configuration?.packetEncoding ?? "xudp"} onChange={(event) => updateConfiguration("packetEncoding", event.target.value)}>{["none", "packet", "xudp"].map((value) => <option key={value}>{value}</option>)}</select></label>
              <label>Header type<select value={configuration?.fakeType ?? supportedHeaderTypes(configuration?.transferProtocol)[0]} onChange={(event) => updateConfiguration("fakeType", event.target.value)}>{supportedHeaderTypes(configuration?.transferProtocol).map((value) => <option key={value}>{value}</option>)}</select></label>
              <label>Host header<input value={configuration?.host ?? ""} onChange={(event) => updateConfiguration("host", event.target.value)} /></label>
              <label>Server name / SNI<input value={configuration?.serverName ?? ""} onChange={(event) => updateConfiguration("serverName", event.target.value)} /></label>
              <label>Path / service name<input value={configuration?.path ?? ""} onChange={(event) => updateConfiguration("path", event.target.value)} /></label>
              <label>TLS<select value={configuration?.tlsSecureType ?? "none"} onChange={(event) => updateConfiguration("tlsSecureType", event.target.value)}><option value="none">None</option><option value="tls">TLS</option></select></label>
              <label className="toggle-row"><input type="checkbox" checked={configuration?.useMux ?? false} onChange={(event) => updateConfiguration("useMux", event.target.checked)} /><span><strong>Connection multiplexing</strong></span></label>
            </>}
            {draft.type === "Trojan" && <>
              <SecretField required label="Password" update={configuration?.password} hasSaved={detail?.configuration.hasPassword ?? false} onChange={(value) => updateConfiguration("password", value)} />
              <label>Server name / SNI<input value={configuration?.host ?? ""} onChange={(event) => updateConfiguration("host", event.target.value)} /></label>
              <label>TLS<select value={configuration?.tlsSecureType ?? "tls"} onChange={(event) => updateConfiguration("tlsSecureType", event.target.value)}><option value="tls">TLS</option><option value="none">None</option></select></label>
            </>}
            {draft.type === "WireGuard" && <>
              <label>Local addresses<input value={configuration?.localAddresses ?? ""} onChange={(event) => updateConfiguration("localAddresses", event.target.value)} /></label>
              <label>Peer public key<input value={configuration?.peerPublicKey ?? ""} onChange={(event) => updateConfiguration("peerPublicKey", event.target.value)} /></label>
              <SecretField required label="Private key" update={configuration?.privateKey} hasSaved={detail?.configuration.hasPrivateKey ?? false} onChange={(value) => updateConfiguration("privateKey", value)} />
              <SecretField label="Pre-shared key" update={configuration?.preSharedKey} hasSaved={detail?.configuration.hasPreSharedKey ?? false} onChange={(value) => updateConfiguration("preSharedKey", value)} />
              <label>MTU<input min={576} max={9000} type="number" value={configuration?.mtu ?? 1420} onChange={(event) => updateConfiguration("mtu", Number(event.target.value))} /></label>
            </>}
            <div className="mode-editor-actions"><button className="primary-action" disabled={busy || locked || !draft.hostname || !draft.port} onClick={save} type="button">{busy ? "Saving…" : draft.serverId === null ? "Add server" : "Save server"}</button>{locked && <span>Disconnect before managing servers.</span>}</div>
          </div>
        )}
        {error && <div className="error-banner" role="alert">{error}</div>}
        {message && <div className="success-banner" role="status">{message}</div>}
      </div>

      {deleteTarget && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDeleteTarget(null)}><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-server-title"><span className="danger-kicker">Permanent library change</span><h2 id="delete-server-title">Delete “{serverLabel(deleteTarget)}”?</h2><p>NetF creates and flushes a timestamped configuration backup before removal. Profiles that reference this server are removed.</p><div className="dialog-actions"><button autoFocus className="secondary-action" onClick={() => setDeleteTarget(null)} type="button">Cancel</button><button className="danger-action" disabled={busy || locked} onClick={remove} type="button">{busy ? "Deleting…" : "Delete server"}</button></div></div></div>}
    </section>
  );
}

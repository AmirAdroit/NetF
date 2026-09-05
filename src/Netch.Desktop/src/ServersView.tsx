import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ActivityIcon, FolderIcon, ServerIcon } from "./icons";
import { canConnect, canStopEngine, latencyLabel, serverLabel, type EngineSettings, type EngineSnapshot, type ServerLatencyResult } from "./engine";
import { errorMessage } from "./desktop";
import { ModeCombobox } from "./ModeCombobox";
import { ServerLibrary } from "./ServerLibrary";

interface ServersViewProps {
  snapshot: EngineSnapshot;
  selectedServerId: number | null;
  selectedModeId: number | null;
  engineBusy: boolean;
  connectionMayBeActive: boolean;
  error: string;
  message: string;
  previousDataAvailable: boolean;
  onSelectServer: (id: number) => void;
  onSelectMode: (id: number | null) => void;
  onSnapshot: (snapshot: EngineSnapshot) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onImport: () => void;
  onImportPrevious: () => void;
}

export function ServersView({
  snapshot,
  selectedServerId,
  selectedModeId,
  engineBusy,
  connectionMayBeActive,
  error,
  message,
  previousDataAvailable,
  onSelectServer,
  onSelectMode,
  onSnapshot,
  onConnect,
  onDisconnect,
  onImport,
  onImportPrevious,
}: ServersViewProps) {
  const [workspace, setWorkspace] = useState<"connect" | "library">("connect");
  const [testingLatency, setTestingLatency] = useState(false);
  const [latencyError, setLatencyError] = useState("");
  const [liveInterval, setLiveInterval] = useState(-1);
  const selectedServer = snapshot.servers.find((server) => server.id === selectedServerId) ?? null;
  const locked = snapshot.status.state === "connected" || snapshot.status.state === "starting" || snapshot.status.state === "stopping";

  async function testSelected(silent = false) {
    if (selectedServerId === null || testingLatency || snapshot.status.state === "starting" || snapshot.status.state === "stopping") return;
    try {
      setTestingLatency(true);
      if (!silent) setLatencyError("");
      await invoke<ServerLatencyResult>("test_server_latency", { serverId: selectedServerId });
      onSnapshot(await invoke<EngineSnapshot>("engine_snapshot"));
    } catch (testError) {
      if (!silent) setLatencyError(errorMessage(testError));
    } finally {
      setTestingLatency(false);
    }
  }

  useEffect(() => {
    void invoke<EngineSettings>("engine_settings")
      .then((settings) => setLiveInterval(settings.liveLatencyIntervalSeconds))
      .catch(() => setLiveInterval(-1));
  }, [snapshot.apiVersion]);

  useEffect(() => {
    if (snapshot.status.state !== "connected" || selectedServerId === null || liveInterval <= 0) return;
    let disposed = false;
    const refresh = async () => {
      if (disposed) return;
      try {
        if (!disposed) onSnapshot(await invoke<EngineSnapshot>("engine_snapshot"));
      } catch {
        // The engine owns the probe and cancellation; a refresh failure is non-disruptive.
      }
    };
    const firstRefresh = window.setTimeout(() => void refresh(), Math.min(3500, liveInterval * 1000));
    const timer = window.setInterval(() => void refresh(), liveInterval * 1000);
    return () => { disposed = true; window.clearTimeout(firstRefresh); window.clearInterval(timer); };
  }, [liveInterval, onSnapshot, selectedServerId, snapshot.status.state]);

  return (
    <div className="servers-view">
      <section className="modes-toolbar server-toolbar">
        <div>
          <span className="step-label">Servers</span>
          <h2>{workspace === "connect" ? "Connect applications" : "Server library"}</h2>
        </div>
        <div className="modes-workspace-tabs" role="tablist" aria-label="Server workspace">
          <button aria-selected={workspace === "connect"} className={workspace === "connect" ? "active" : ""} onClick={() => setWorkspace("connect")} role="tab" type="button"><ActivityIcon /> Connect</button>
          <button aria-selected={workspace === "library"} className={workspace === "library" ? "active" : ""} onClick={() => setWorkspace("library")} role="tab" type="button"><ServerIcon /> Library</button>
        </div>
        <div className="modes-toolbar-actions">
          {previousDataAvailable && <button className="previous-data-action" disabled={engineBusy || locked} onClick={onImportPrevious} type="button">Import previous NetF data</button>}
          <button disabled={engineBusy || locked} onClick={onImport} type="button"><FolderIcon /> Import configuration</button>
        </div>
      </section>

      {workspace === "connect" ? (
        <section className="panel connect-panel">
          <div className="panel-heading"><div><span className="step-label">Routing profile</span><h2>Choose a server and mode</h2></div><span className={`connection-pill ${snapshot.status.state}`}>{snapshot.status.state}</span></div>
          <div className="connection-fields">
            <label>
              Server
              <select disabled={engineBusy || locked} value={selectedServerId ?? ""} onChange={(event) => onSelectServer(Number(event.target.value))}>
                <option value="" disabled>Choose a server</option>
                {snapshot.servers.map((server) => <option key={server.id} value={server.id}>{server.supported ? "" : "⚠ "}[{server.type}] {serverLabel(server)} · {server.endpoint} · {latencyLabel(server.latency)}</option>)}
              </select>
            </label>
            <ModeCombobox disabled={engineBusy || locked} modes={snapshot.modes} selectedId={selectedModeId} onSelect={onSelectMode} />
          </div>
          {selectedServer && !selectedServer.supported && <div className="helper-warning"><strong>This profile cannot use the packaged runtime</strong><p>{selectedServer.supportMessage}</p><button onClick={() => setWorkspace("library")} type="button">Review in Library</button></div>}
          {selectedServer && <div className={`latency-readout ${selectedServer.latency?.status ?? "untested"}`}><strong>{latencyLabel(selectedServer.latency)}</strong><span>{selectedServer.latency ? `${selectedServer.latency.method.toUpperCase()} endpoint test` : "Endpoint latency has not been tested"}</span></div>}
          {selectedServer?.type === "WireGuard" && <p className="health-explainer">WireGuard uses UDP. A TCP endpoint test may time out even when the tunnel works; select ICMP in Settings when the host permits it.</p>}
          <div className="engine-actions">
            <button className="secondary-action" disabled={engineBusy || testingLatency || selectedServerId === null || snapshot.status.state === "starting" || snapshot.status.state === "stopping"} onClick={() => void testSelected()} type="button">{testingLatency ? "Testing…" : "Test selected"}</button>
            {canStopEngine(snapshot, connectionMayBeActive) ? <button className="stop-action" disabled={engineBusy} onClick={onDisconnect} type="button"><ActivityIcon /> {engineBusy ? "Stopping…" : snapshot.status.state === "failed" ? "Stop engine" : "Disconnect"}</button> : <button className="primary-action" disabled={!canConnect(snapshot, selectedServerId, selectedModeId) || engineBusy} onClick={onConnect} type="button"><ActivityIcon /> {engineBusy ? "Starting…" : "Connect"}</button>}
          </div>
          {latencyError && <div className="error-banner" role="alert">{latencyError}</div>}
        </section>
      ) : (
        <ServerLibrary snapshot={snapshot} onSnapshot={onSnapshot} onSelectForConnection={onSelectServer} />
      )}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {message && <div className="success-banner" role="status">{message}</div>}
    </div>
  );
}

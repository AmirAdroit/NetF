import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ActivityIcon, CopyIcon } from "./icons";
import type { EngineLogResult, EngineSnapshot } from "./engine";
import { enginePresentation, errorMessage, type EngineRuntimeState } from "./desktop";

interface ActivityViewProps {
  snapshot: EngineSnapshot | null;
  engineState: EngineRuntimeState;
  active: boolean;
}

export function ActivityView({ snapshot, engineState, active }: ActivityViewProps) {
  const [logs, setLogs] = useState<EngineLogResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBusy(true);
      setError("");
      setCopied(false);
      setLogs(await invoke<EngineLogResult>("engine_logs", { limit: 250 }));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [active, snapshot, refresh]);

  async function copyLogs() {
    if (!logs) return;
    try {
      await navigator.clipboard.writeText(logs.lines.join("\n"));
      setCopied(true);
      setError("");
    } catch (copyError) {
      setError(`Could not copy sanitized logs: ${errorMessage(copyError)}`);
    }
  }

  return (
    <div className="activity-view">
      <section className="hero-card">
        <div className="hero-copy"><span className="feature-icon"><ActivityIcon /></span><div><h2>Engine activity and sanitized logs</h2><p>Recent engine events refresh every five seconds. Credentials and proxy URIs are redacted before they cross into the UI.</p></div></div>
        <div className="hero-meta"><span>{enginePresentation(engineState.phase).shortLabel}</span><span>{logs?.lines.length ?? 0} lines</span>{logs?.truncated && <span>Tail view</span>}</div>
      </section>
      <section className="panel log-panel">
        <div className="panel-heading">
          <div><span className="step-label">{logs?.source ?? "logging/application.log"}</span><h2>Recent activity</h2></div>
          <div className="log-actions"><button disabled={busy} onClick={() => void refresh()} type="button">{busy ? "Refreshing…" : "Refresh"}</button><button disabled={!logs?.lines.length} onClick={copyLogs} type="button"><CopyIcon /> {copied ? "Copied" : "Copy sanitized logs"}</button></div>
        </div>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <pre className="log-stream" aria-label="Sanitized engine log">{logs?.lines.join("\n") || "No engine log entries yet."}</pre>
        <p className="health-explainer">Logs are bounded to 250 recent lines in this view. Copy the sanitized output when reporting a problem.</p>
      </section>
    </div>
  );
}

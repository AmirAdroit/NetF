import { ActivityIcon, LayersIcon, ServerIcon } from "./icons";
import type { EngineSnapshot } from "./engine";
import { enginePresentation, type EngineRuntimeState } from "./desktop";

type ViewName = "Overview" | "Servers" | "Modes" | "Activity" | "Settings";

interface OverviewViewProps {
  snapshot: EngineSnapshot | null;
  engineState: EngineRuntimeState;
  runtimeVersion: string;
  onNavigate: (view: ViewName) => void;
}

export function OverviewView({ snapshot, engineState, runtimeVersion, onNavigate }: OverviewViewProps) {
  const state = enginePresentation(engineState.phase);
  const origins = snapshot?.modes.reduce(
    (counts, mode) => ({ ...counts, [mode.origin]: counts[mode.origin] + 1 }),
    { "built-in": 0, imported: 0, user: 0 },
  ) ?? { "built-in": 0, imported: 0, user: 0 };
  const unavailableRequired = snapshot?.capabilities.filter((capability) => capability.required && !capability.available) ?? [];
  const unavailableOptional = snapshot?.capabilities.filter((capability) => !capability.required && !capability.available) ?? [];
  const requiredMissingCount = new Set(unavailableRequired.flatMap((capability) => capability.missing)).size;
  const readiness = requiredMissingCount > 0 ? `${requiredMissingCount} missing` : unavailableOptional.length > 0 ? "Limited" : "Ready";

  function showReadiness() {
    document.getElementById("runtime-readiness")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="overview-view">
      <section className={`hero-card overview-hero state-${state.tone}`}>
        <div className="hero-copy">
          <span className="feature-icon state-lightning"><ActivityIcon /></span>
          <div>
            <span className="overview-state-label"><i />{state.label}</span>
            <h2>{engineState.phase === "connected" ? "NetF is routing selected application traffic" : "NetF is ready but not routing traffic"}</h2>
            <p>{engineState.message}</p>
          </div>
        </div>
        <div className="hero-meta"><span>Owned runtime {runtimeVersion || "—"}</span><span>API v{snapshot?.apiVersion ?? "—"}</span></div>
      </section>

      <section className="overview-stat-grid">
        <button className="overview-stat" onClick={() => onNavigate("Servers")} type="button"><ServerIcon /><strong>{snapshot?.servers.length ?? 0}</strong><span>Servers</span></button>
        <button className="overview-stat" onClick={() => onNavigate("Modes")} type="button"><LayersIcon /><strong>{snapshot?.modes.length ?? 0}</strong><span>Modes</span></button>
        <button className={`overview-stat state-${state.tone}`} onClick={() => onNavigate("Activity")} type="button"><ActivityIcon /><strong>{state.shortLabel}</strong><span>Engine state</span></button>
        <button className="overview-stat" onClick={showReadiness} type="button"><ActivityIcon /><strong>{readiness}</strong><span>Runtime readiness</span></button>
      </section>

      <div className="workspace-grid overview-grid">
        <section className="panel" id="runtime-readiness" tabIndex={-1}>
          <div className="panel-heading"><div><span className="step-label">Mode ownership</span><h2>Library composition</h2></div></div>
          <dl className="health-list">
            <div><dt>Built-in templates</dt><dd>{origins["built-in"]}</dd></div>
            <div><dt>Imported modes</dt><dd>{origins.imported}</dd></div>
            <div><dt>User-created modes</dt><dd>{origins.user}</dd></div>
          </dl>
          <button className="secondary-action" onClick={() => onNavigate("Modes")} type="button">Manage modes</button>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><span className="step-label">Runtime capabilities</span><h2>Operational readiness</h2></div></div>
          <div className="capability-list">
            {snapshot?.capabilities.map((capability) => (
              <div key={capability.name}><span className={capability.available ? "status-ok" : capability.required ? "status-bad" : "status-warn"} /> <strong>{capability.name}</strong><small>{capability.available ? "Ready" : `${capability.required ? "Required" : "Optional"} · Missing: ${capability.missing.join(", ")}`}</small></div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

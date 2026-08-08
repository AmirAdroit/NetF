import { ActivityIcon, LayersIcon, ServerIcon, SettingsIcon } from "./icons";
import type { EngineSnapshot } from "./engine";

type ViewName = "Overview" | "Servers" | "Modes" | "Activity" | "Settings";

interface OverviewViewProps {
  snapshot: EngineSnapshot | null;
  runtimeVersion: string;
  onNavigate: (view: ViewName) => void;
}

export function OverviewView({ snapshot, runtimeVersion, onNavigate }: OverviewViewProps) {
  const origins = snapshot?.modes.reduce(
    (counts, mode) => ({ ...counts, [mode.origin]: counts[mode.origin] + 1 }),
    { "built-in": 0, imported: 0, user: 0 },
  ) ?? { "built-in": 0, imported: 0, user: 0 };
  const unavailable = snapshot?.capabilities.filter((capability) => !capability.available) ?? [];

  return (
    <div className="overview-view">
      <section className="hero-card overview-hero">
        <div className="hero-copy">
          <span className="feature-icon"><ActivityIcon /></span>
          <div>
            <h2>{snapshot?.status.state === "connected" ? "Traffic routing is active" : "Engine ready"}</h2>
            <p>{snapshot?.status.message ?? "Preparing the owned compatibility runtime."}</p>
          </div>
        </div>
        <div className="hero-meta"><span>Owned runtime {runtimeVersion || "—"}</span><span>API v{snapshot?.apiVersion ?? "—"}</span></div>
      </section>

      <section className="overview-stat-grid">
        <button className="overview-stat" onClick={() => onNavigate("Servers")} type="button"><ServerIcon /><strong>{snapshot?.servers.length ?? 0}</strong><span>Servers</span></button>
        <button className="overview-stat" onClick={() => onNavigate("Modes")} type="button"><LayersIcon /><strong>{snapshot?.modes.length ?? 0}</strong><span>Modes</span></button>
        <button className="overview-stat" onClick={() => onNavigate("Activity")} type="button"><ActivityIcon /><strong>{snapshot?.status.state ?? "starting"}</strong><span>Engine state</span></button>
        <button className="overview-stat" onClick={() => onNavigate("Settings")} type="button"><SettingsIcon /><strong>{unavailable.length}</strong><span>Unavailable capabilities</span></button>
      </section>

      <div className="workspace-grid overview-grid">
        <section className="panel">
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
              <div key={capability.name}><span className={capability.available ? "status-ok" : "status-warn"} /> <strong>{capability.name}</strong><small>{capability.available ? "Available" : `Missing: ${capability.missing.join(", ")}`}</small></div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

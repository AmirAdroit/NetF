import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ActivityIcon,
  ChevronIcon,
  FolderIcon,
  GridIcon,
  LayersIcon,
  MonitorIcon,
  MoonIcon,
  ServerIcon,
  SettingsIcon,
  SunIcon,
} from "./icons";
import {
  canConnect,
  canStopEngine,
  filterModes,
  modeLabel,
  serverLabel,
  type EngineSnapshot,
  type EngineStatus,
  type LegacyImportResult,
} from "./engine";
import { ActivityView } from "./ActivityView";
import { ModesView } from "./ModesView";
import { OverviewView } from "./OverviewView";
import { SettingsView } from "./SettingsView";
import { BrandMark } from "./BrandMark";
import { StartupView } from "./StartupView";
import { enginePresentation, errorMessage } from "./desktop";
import { useDesktopController } from "./useDesktopController";
import {
  normalizeThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "./theme";

const navItems = [
  { label: "Overview", icon: GridIcon },
  { label: "Servers", icon: ServerIcon },
  { label: "Modes", icon: LayersIcon },
  { label: "Activity", icon: ActivityIcon },
  { label: "Settings", icon: SettingsIcon },
] as const;

type ViewName = (typeof navItems)[number]["label"];

const viewHeadings: Record<ViewName, { eyebrow: string; title: string; badge: string }> = {
  Overview: { eyebrow: "Operational summary", title: "Overview", badge: "Owned runtime" },
  Servers: { eyebrow: "Engine bridge", title: "Connection control", badge: "Compatibility engine" },
  Modes: { eyebrow: "Routing library", title: "Modes", badge: "Atomic mode editing" },
  Activity: { eyebrow: "Diagnostics", title: "Activity and logs", badge: "Sanitized output" },
  Settings: { eyebrow: "Configuration", title: "Settings", badge: "Validated writes" },
};

function App() {
  const desktop = useDesktopController();
  const engineSnapshot = desktop.snapshot;
  const setEngineSnapshot = desktop.setSnapshot;
  const runtimeRoot = desktop.runtime?.runtimeRoot ?? "";
  const runtimeVersion = desktop.runtime?.runtimeVersion ?? "";
  const statusPresentation = enginePresentation(desktop.engine.phase);
  const [activeView, setActiveView] = useState<ViewName>("Overview");
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    normalizeThemePreference(localStorage.getItem(THEME_STORAGE_KEY)),
  );
  const [error, setError] = useState("");
  const [importSummary, setImportSummary] = useState("");
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);
  const [selectedModeId, setSelectedModeId] = useState<number | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [connectionModeQuery, setConnectionModeQuery] = useState("");

  const connectionModes = useMemo(() => {
    const filtered = filterModes(engineSnapshot?.modes ?? [], connectionModeQuery);
    const selected = engineSnapshot?.modes.find((mode) => mode.id === selectedModeId);
    return selected && !filtered.some((mode) => mode.id === selected.id)
      ? [selected, ...filtered]
      : filtered;
  }, [engineSnapshot?.modes, connectionModeQuery, selectedModeId]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activeView]);

  useEffect(() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme() {
      const resolved = resolveTheme(themePreference, systemTheme.matches);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    }

    localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    applyTheme();

    if (themePreference !== "system") return;

    systemTheme.addEventListener("change", applyTheme);
    return () => systemTheme.removeEventListener("change", applyTheme);
  }, [themePreference]);

  useEffect(() => {
    if (!engineSnapshot) return;
    setSelectedServerId((current) => current ?? engineSnapshot.servers[0]?.id ?? null);
    setSelectedModeId((current) => current ?? engineSnapshot.modes[0]?.id ?? null);
  }, [engineSnapshot]);

  async function importLegacyConfiguration() {
    if (engineBusy) return;
    try {
      setEngineBusy(true);
      setError("");
      const imported = await invoke<LegacyImportResult | null>(
        "import_legacy_configuration",
      );
      if (!imported) return;
      setEngineSnapshot(imported.snapshot);
      setSelectedServerId(imported.snapshot.servers[0]?.id ?? null);
      setSelectedModeId(imported.snapshot.modes[0]?.id ?? null);
      setImportSummary(
        `Imported ${imported.snapshot.servers.length} server(s) and ${imported.importedCustomModes} custom mode(s). A rollback backup was created.`,
      );
    } catch (importError) {
      setError(errorMessage(importError));
    } finally {
      setEngineBusy(false);
    }
  }

  async function connectProfile() {
    if (!canConnect(engineSnapshot, selectedServerId, selectedModeId) || engineBusy) return;
    setEngineBusy(true);
    setError("");
    try {
      const status = await invoke<EngineStatus>("connect_profile", {
        serverId: selectedServerId,
        modeId: selectedModeId,
      });
      setEngineSnapshot((current) => (current ? { ...current, status } : current));
    } catch (connectError) {
      setError(errorMessage(connectError));
      setEngineSnapshot((current) =>
        current
          ? {
              ...current,
              status: {
                state: "failed",
                message: "Connection result is uncertain. Stop the engine before retrying.",
              },
            }
          : current,
      );
      await refreshEngine();
    } finally {
      setEngineBusy(false);
    }
  }

  async function disconnectProfile() {
    if (!engineSnapshot || engineBusy) return;
    setEngineBusy(true);
    setError("");
    try {
      const status = await invoke<EngineStatus>("disconnect_profile");
      setEngineSnapshot((current) => (current ? { ...current, status } : current));
    } catch (disconnectError) {
      setError(errorMessage(disconnectError));
    } finally {
      setEngineBusy(false);
    }
  }

  async function refreshEngine() {
    if (!engineSnapshot) return;
    try {
      const snapshot = await invoke<EngineSnapshot>("engine_snapshot");
      setEngineSnapshot(snapshot);
    } catch {
      // Preserve the actionable error from the operation that triggered refresh.
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label="NetF desktop">
          <span className="brand-mark"><BrandMark /></span>
          <span className="brand-copy">
            <strong>NetF</strong>
            <small>Split tunneling for Windows</small>
          </span>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          {navItems.map(({ label, icon: Icon }) => (
            <button
              className={`nav-item ${label === activeView ? "active" : ""}`}
              key={label}
              onClick={() => setActiveView(label)}
              title={label}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className={`sidebar-status state-${statusPresentation.tone}`}>
          <div className="status-heading">
            <span className="status-pulse" />
            {statusPresentation.shortLabel}
          </div>
          <p>
            {desktop.startup.phase === "ready"
              ? desktop.engine.message
              : desktop.startup.message}
          </p>
          <button type="button" onClick={() => setActiveView("Servers")}>
            Open connection view <ChevronIcon />
          </button>
        </div>

        <div className="upstream-credit">
          <span>GPL-3.0 fork of</span>
          <strong>Netch by AmazingDM &amp; contributors</strong>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{viewHeadings[activeView].eyebrow}</p>
            <h1>{viewHeadings[activeView].title}</h1>
          </div>
          <div className="topbar-actions">
            <div className="theme-switcher" aria-label="Color theme">
              {([
                ["system", MonitorIcon, "Use system theme"],
                ["light", SunIcon, "Use light theme"],
                ["dark", MoonIcon, "Use dark theme"],
              ] as const).map(([preference, Icon, label]) => (
                <button
                  aria-label={label}
                  aria-pressed={themePreference === preference}
                  className={themePreference === preference ? "active" : ""}
                  key={preference}
                  onClick={() => setThemePreference(preference)}
                  title={label}
                  type="button"
                >
                  <Icon />
                </button>
              ))}
            </div>
            <div className="preview-badge">
              <span /> {viewHeadings[activeView].badge}
            </div>
          </div>
        </header>

        {desktop.startup.phase !== "ready" ? (
          <StartupView startup={desktop.startup} error={desktop.error} onRetry={() => void desktop.retry()} />
        ) : activeView === "Overview" ? (
          <OverviewView engineState={desktop.engine} snapshot={engineSnapshot} runtimeVersion={runtimeVersion} onNavigate={setActiveView} />
        ) : activeView === "Servers" ? (
          <div className="engine-workspace">
            <section className="hero-card engine-hero">
              <div className="hero-copy">
                <span className="feature-icon"><ServerIcon /></span>
                <div>
                  <h2>Run the proven engine behind the modern desktop</h2>
                  <p>
                    The fork runs its own versioned runtime and verified cores. Import
                    configuration from an older Netch installation without executing any
                    binaries from that directory. Credentials stay inside the .NET engine.
                  </p>
                </div>
              </div>
              <div className="hero-meta">
                <span>Typed API v1</span>
                <span>Fixed command allowlist</span>
                <span>Legacy fallback preserved</span>
              </div>
            </section>

            <div className="workspace-grid engine-grid">
              <section className="panel engine-panel">
                <div className="panel-heading">
                  <div>
                    <span className="step-label">Runtime</span>
                    <h2>{engineSnapshot ? "Profile selection" : "Prepare NetF"}</h2>
                  </div>
                  <span className={`connection-pill ${engineSnapshot?.status.state ?? "detached"}`}>
                    {engineSnapshot?.status.state ?? "detached"}
                  </span>
                </div>

                {!engineSnapshot ? (
                  <div className="attach-runtime">
                    <FolderIcon />
                    <h3>Owned runtime is starting</h3>
                    <p>
                      The app is validating and installing its packaged engine assets.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="runtime-path">
                      <FolderIcon /><span>{runtimeRoot}</span>
                      <button disabled={engineBusy || engineSnapshot.status.state !== "stopped"} onClick={importLegacyConfiguration} type="button">
                        Import
                      </button>
                    </div>

                    <div className="profile-fields">
                      <label>
                        Server
                        <select
                          disabled={engineBusy || engineSnapshot.status.state === "connected"}
                          value={selectedServerId ?? ""}
                          onChange={(event) => setSelectedServerId(Number(event.target.value))}
                        >
                          {engineSnapshot.servers.map((server) => (
                            <option key={server.id} value={server.id}>
                              [{server.type}] [{server.group}] {serverLabel(server)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Mode
                        <input
                          className="mode-select-search"
                          disabled={engineBusy || engineSnapshot.status.state === "connected"}
                          value={connectionModeQuery}
                          onChange={(event) => setConnectionModeQuery(event.target.value)}
                          placeholder="Search modes…"
                        />
                        <select
                          disabled={engineBusy || engineSnapshot.status.state === "connected"}
                          value={selectedModeId ?? ""}
                          onChange={(event) => setSelectedModeId(Number(event.target.value))}
                        >
                          {connectionModes.map((mode) => (
                            <option key={mode.id} value={mode.id}>
                              [{mode.origin}] [{mode.type}] {modeLabel(mode)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="engine-actions">
                      {canStopEngine(engineSnapshot, desktop.engine.active || desktop.engine.phase === "failed") ? (
                        <button className="stop-action" disabled={engineBusy} onClick={disconnectProfile} type="button">
                          <ActivityIcon /> {engineBusy ? "Stopping…" : engineSnapshot.status.state === "failed" ? "Stop engine" : "Disconnect"}
                        </button>
                      ) : (
                        <button
                          className="primary-action"
                          disabled={!canConnect(engineSnapshot, selectedServerId, selectedModeId) || engineBusy}
                          onClick={connectProfile}
                          type="button"
                        >
                          <ActivityIcon /> {engineBusy ? "Starting…" : "Connect"}
                        </button>
                      )}
                    </div>
                  </>
                )}

                {error && <div className="error-banner" role="alert">{error}</div>}
                {importSummary && <div className="success-banner" role="status">{importSummary}</div>}
              </section>

              <aside className="panel health-panel">
                <div className="panel-heading compact">
                  <div><span className="step-label">Engine health</span><h2>Compatibility status</h2></div>
                </div>
                <dl className="health-list">
                  <div><dt>API</dt><dd className="good">{engineSnapshot ? `v${engineSnapshot.apiVersion}` : "Waiting"}</dd></div>
                  <div><dt>Servers</dt><dd>{engineSnapshot?.servers.length ?? 0}</dd></div>
                  <div><dt>Modes</dt><dd>{engineSnapshot?.modes.length ?? 0}</dd></div>
                  <div><dt>Optional helpers missing</dt><dd className={engineSnapshot?.missingHelpers.length ? "bad" : "good"}>{engineSnapshot?.missingHelpers.length ?? "—"}</dd></div>
                  <div><dt>Runtime</dt><dd>{runtimeVersion ? `Owned v${runtimeVersion}` : "—"}</dd></div>
                  <div><dt>Core source</dt><dd>{engineSnapshot ? "Fork package" : "—"}</dd></div>
                  <div><dt>Proxy cores</dt><dd>{engineSnapshot?.proxyCores.join(", ") || "—"}</dd></div>
                </dl>
                {engineSnapshot?.missingHelpers.length ? (
                  <div className="helper-warning">
                    <strong>Some modes are not packaged yet</strong>
                    {engineSnapshot.capabilities
                      .filter((capability) => !capability.available)
                      .map((capability) => (
                        <p key={capability.name}>
                          {capability.name}: {capability.missing.join(", ")}
                        </p>
                      ))}
                  </div>
                ) : (
                  <p className="health-explainer">
                    Connections use only the fork-owned runtime. Import reads legacy
                    configuration and custom modes, but ignores every executable, DLL,
                    driver, and helper in the selected directory.
                  </p>
                )}
              </aside>
            </div>
          </div>
        ) : activeView === "Modes" ? (
          <ModesView
            snapshot={engineSnapshot}
            onSnapshot={(snapshot) => {
              const selectedSource = engineSnapshot?.modes.find((mode) => mode.id === selectedModeId)?.source;
              setEngineSnapshot(snapshot);
              setSelectedModeId(snapshot.modes.find((mode) => mode.source === selectedSource)?.id ?? snapshot.modes[0]?.id ?? null);
            }}
          />
        ) : activeView === "Activity" ? (
          <ActivityView engineState={desktop.engine} snapshot={engineSnapshot} active />
        ) : (
          <SettingsView snapshot={engineSnapshot} active />
        )}
      </main>
    </div>
  );
}

export default App;

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ActivityIcon,
  ChevronIcon,
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
  type EngineSnapshot,
  type EngineStatus,
  type LegacyImportResult,
} from "./engine";
import { ActivityView } from "./ActivityView";
import { ModesView } from "./ModesView";
import { OverviewView } from "./OverviewView";
import { SettingsView } from "./SettingsView";
import { ServersView } from "./ServersView";
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
  Servers: { eyebrow: "Connection workspace", title: "Servers", badge: "NetF engine" },
  Modes: { eyebrow: "Routing library", title: "Modes", badge: "Atomic mode editing" },
  Activity: { eyebrow: "Diagnostics", title: "Activity and logs", badge: "Sanitized output" },
  Settings: { eyebrow: "Configuration", title: "Settings", badge: "Validated writes" },
};

function App() {
  const desktop = useDesktopController();
  const engineSnapshot = desktop.snapshot;
  const setEngineSnapshot = desktop.setSnapshot;
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
  const [previousDataAvailable, setPreviousDataAvailable] = useState(false);

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
    setSelectedServerId((current) => current ?? engineSnapshot.servers.find((server) => server.supported)?.id ?? engineSnapshot.servers[0]?.id ?? null);
    setSelectedModeId((current) => current ?? engineSnapshot.modes[0]?.id ?? null);
  }, [engineSnapshot]);

  useEffect(() => {
    if (desktop.startup.phase !== "ready") return;
    void invoke<boolean>("previous_netf_data_available")
      .then(setPreviousDataAvailable)
      .catch(() => setPreviousDataAvailable(false));
  }, [desktop.startup.phase]);

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
      setSelectedServerId(imported.snapshot.servers.find((server) => server.supported)?.id ?? imported.snapshot.servers[0]?.id ?? null);
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

  async function importPreviousConfiguration() {
    if (engineBusy) return;
    try {
      setEngineBusy(true);
      setError("");
      const imported = await invoke<LegacyImportResult>("import_previous_netf_configuration");
      setEngineSnapshot(imported.snapshot);
      setSelectedServerId(imported.snapshot.servers.find((server) => server.supported)?.id ?? imported.snapshot.servers[0]?.id ?? null);
      setSelectedModeId(imported.snapshot.modes[0]?.id ?? null);
      setPreviousDataAvailable(false);
      setImportSummary(`Imported ${imported.snapshot.servers.length} server(s) and ${imported.importedCustomModes} custom mode(s) from the previous NetF data directory.`);
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

        <button className="upstream-credit" onClick={() => setActiveView("Settings")} type="button">
          <span>NetF 0.2.0</span>
          <strong>About &amp; legal</strong>
        </button>
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
        ) : activeView === "Servers" && engineSnapshot ? (
          <ServersView
            snapshot={engineSnapshot}
            selectedServerId={selectedServerId}
            selectedModeId={selectedModeId}
            engineBusy={engineBusy}
            connectionMayBeActive={desktop.engine.active || desktop.engine.phase === "failed"}
            error={error}
            message={importSummary}
            previousDataAvailable={previousDataAvailable}
            onSelectServer={setSelectedServerId}
            onSelectMode={setSelectedModeId}
            onSnapshot={setEngineSnapshot}
            onConnect={() => void connectProfile()}
            onDisconnect={() => void disconnectProfile()}
            onImport={() => void importLegacyConfiguration()}
            onImportPrevious={() => void importPreviousConfiguration()}
          />
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

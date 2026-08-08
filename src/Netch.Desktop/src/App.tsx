import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ActivityIcon,
  ChevronIcon,
  CopyIcon,
  FolderIcon,
  GridIcon,
  LayersIcon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
  SunIcon,
} from "./icons";
import {
  selectedRules,
  summarizeScan,
  type ScanReport,
} from "./scanner";
import {
  canConnect,
  canStopEngine,
  filterModes,
  modeLabel,
  serverLabel,
  type EngineSnapshot,
  type EngineStatus,
  type LegacyImportResult,
  type RuntimeInfo,
} from "./engine";
import { ActivityView } from "./ActivityView";
import { ModeManager } from "./ModeManager";
import { OverviewView } from "./OverviewView";
import { SettingsView } from "./SettingsView";
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
  const [activeView, setActiveView] = useState<ViewName>("Overview");
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    normalizeThemePreference(localStorage.getItem(THEME_STORAGE_KEY)),
  );
  const [folder, setFolder] = useState("");
  const [maxResults, setMaxResults] = useState(50);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [excludedRules, setExcludedRules] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [engineSnapshot, setEngineSnapshot] = useState<EngineSnapshot | null>(null);
  const [runtimeRoot, setRuntimeRoot] = useState("");
  const [runtimeVersion, setRuntimeVersion] = useState("");
  const [importSummary, setImportSummary] = useState("");
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);
  const [selectedModeId, setSelectedModeId] = useState<number | null>(null);
  const [engineBusy, setEngineBusy] = useState(true);
  const [connectionMayBeActive, setConnectionMayBeActive] = useState(false);
  const [connectionModeQuery, setConnectionModeQuery] = useState("");

  const summary = summarizeScan(report);
  const rules = useMemo(
    () => selectedRules(report, excludedRules),
    [report, excludedRules],
  );
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
    let cancelled = false;

    async function loadOwnedRuntime() {
      try {
        const [runtime, snapshot] = await Promise.all([
          invoke<RuntimeInfo>("runtime_info"),
          invoke<EngineSnapshot>("engine_snapshot"),
        ]);
        if (cancelled) return;
        setRuntimeRoot(runtime.runtimeRoot);
        setRuntimeVersion(runtime.runtimeVersion);
        setEngineSnapshot(snapshot);
        setConnectionMayBeActive(snapshot.status.state !== "stopped");
        setSelectedServerId(snapshot.servers[0]?.id ?? null);
        setSelectedModeId(snapshot.modes[0]?.id ?? null);
      } catch (startupError) {
        if (!cancelled) setError(String(startupError));
      } finally {
        if (!cancelled) setEngineBusy(false);
      }
    }

    void loadOwnedRuntime();
    return () => {
      cancelled = true;
    };
  }, []);

  async function chooseFolder() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setFolder(selected);
        setReport(null);
        setExcludedRules(new Set());
        setError("");
      }
    } catch (dialogError) {
      setError(`Could not open the directory picker: ${String(dialogError)}`);
    }
  }

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
      setConnectionMayBeActive(false);
      setSelectedServerId(imported.snapshot.servers[0]?.id ?? null);
      setSelectedModeId(imported.snapshot.modes[0]?.id ?? null);
      setImportSummary(
        `Imported ${imported.snapshot.servers.length} server(s) and ${imported.importedCustomModes} custom mode(s). A rollback backup was created.`,
      );
    } catch (importError) {
      setError(String(importError));
    } finally {
      setEngineBusy(false);
    }
  }

  async function connectProfile() {
    if (!canConnect(engineSnapshot, selectedServerId, selectedModeId) || engineBusy) return;
    setEngineBusy(true);
    setConnectionMayBeActive(true);
    setError("");
    try {
      const status = await invoke<EngineStatus>("connect_profile", {
        serverId: selectedServerId,
        modeId: selectedModeId,
      });
      setEngineSnapshot((current) => (current ? { ...current, status } : current));
    } catch (connectError) {
      setError(String(connectError));
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
      setConnectionMayBeActive(false);
    } catch (disconnectError) {
      setError(String(disconnectError));
      setConnectionMayBeActive(true);
    } finally {
      setEngineBusy(false);
    }
  }

  async function refreshEngine() {
    if (!engineSnapshot) return;
    try {
      const snapshot = await invoke<EngineSnapshot>("engine_snapshot");
      setEngineSnapshot(snapshot);
      setConnectionMayBeActive(snapshot.status.state !== "stopped");
    } catch {
      // Preserve the actionable error from the operation that triggered refresh.
    }
  }

  async function scan() {
    if (!folder || busy) return;

    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const result = await invoke<ScanReport>("scan_executables", {
        root: folder,
        maxResults,
      });
      setReport(result);
      setExcludedRules(new Set());
    } catch (scanError) {
      setReport(null);
      setError(String(scanError));
    } finally {
      setBusy(false);
    }
  }

  function toggleRule(rule: string) {
    setExcludedRules((current) => {
      const next = new Set(current);
      if (next.has(rule)) next.delete(rule);
      else next.add(rule);
      return next;
    });
    setCopied(false);
  }

  async function copyRules() {
    try {
      await navigator.clipboard.writeText(rules.join("\r\n"));
      setCopied(true);
      setError("");
    } catch (clipboardError) {
      setError(`Could not copy rules: ${String(clipboardError)}`);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label="Netch modern desktop">
          <span className="brand-mark">N</span>
          <span className="brand-copy">
            <strong>Netch</strong>
            <small>modern desktop</small>
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

        <div className="sidebar-status">
          <div className="status-heading">
            <span className="status-pulse" />
            {engineSnapshot ? engineSnapshot.status.state : "Engine detached"}
          </div>
          <p>
            {engineSnapshot
              ? engineSnapshot.status.message
              : "Preparing the fork-owned runtime and verified proxy cores."}
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

        {activeView === "Overview" ? (
          <OverviewView snapshot={engineSnapshot} runtimeVersion={runtimeVersion} onNavigate={setActiveView} />
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
                    <h2>{engineSnapshot ? "Profile selection" : "Attach Netch"}</h2>
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
                      {canStopEngine(engineSnapshot, connectionMayBeActive) ? (
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
          <>

        {engineSnapshot ? (
          <ModeManager snapshot={engineSnapshot} onSnapshot={(snapshot) => {
            const selectedSource = engineSnapshot.modes.find((mode) => mode.id === selectedModeId)?.source;
            setEngineSnapshot(snapshot);
            setSelectedModeId(snapshot.modes.find((mode) => mode.source === selectedSource)?.id ?? snapshot.modes[0]?.id ?? null);
          }} />
        ) : (
          <section className="panel settings-loading"><LayersIcon /><h2>Preparing mode library…</h2></section>
        )}

        <section className="hero-card">
          <div className="hero-copy">
            <span className="feature-icon"><SearchIcon /></span>
            <div>
              <h2>Build routing rules from an application folder</h2>
              <p>
                Scan a directory and its subdirectories, review every executable,
                then copy rules compatible with existing Netch process modes.
              </p>
            </div>
          </div>
          <div className="hero-meta" aria-label="Scanner safety controls">
            <span>Directory links skipped</span>
            <span>Deterministic rules</span>
            <span>Bounded scan</span>
          </div>
        </section>

        <div className="workspace-grid">
          <section className="panel scan-panel">
            <div className="panel-heading">
              <div>
                <span className="step-label">Step 01</span>
                <h2>Choose a directory</h2>
              </div>
              <span className="panel-state">Local only</span>
            </div>

            <label className="field-label" htmlFor="scan-folder">Application directory</label>
            <div className="folder-field">
              <FolderIcon />
              <input
                id="scan-folder"
                readOnly
                value={folder}
                placeholder="Select a game or application directory"
              />
              <button type="button" onClick={chooseFolder}>Browse</button>
            </div>

            <div className="scan-options">
              <label htmlFor="max-results">
                Result safety limit
                <span>Stops before a mistaken whole-drive scan becomes noisy.</span>
              </label>
              <input
                id="max-results"
                type="number"
                min="1"
                max="5000"
                value={maxResults}
                onChange={(event) =>
                  setMaxResults(Math.min(5000, Math.max(1, Number(event.target.value))))
                }
              />
            </div>

            <button
              className="primary-action"
              disabled={!folder || busy}
              onClick={scan}
              type="button"
            >
              <SearchIcon />
              {busy ? "Scanning…" : "Scan for executables"}
            </button>

            {error && <div className="error-banner" role="alert">{error}</div>}

            <div className="trust-note">
              <strong>No files are modified.</strong>
              <span>
                The scanner reads filenames only. It does not start, inspect, or
                trust the executables it finds.
              </span>
            </div>
          </section>

          <aside className="panel health-panel">
            <div className="panel-heading compact">
              <div>
                <span className="step-label">Boundary status</span>
                <h2>Safe by default</h2>
              </div>
            </div>
            <dl className="health-list">
              <div><dt>Engine bridge</dt><dd className="good">Owned runtime</dd></div>
              <div><dt>Administrator access</dt><dd className="muted">Required for engine</dd></div>
              <div><dt>Config writes</dt><dd className="good">Atomic + backup</dd></div>
              <div><dt>Remote content</dt><dd className="good">None</dd></div>
            </dl>
            <p className="health-explainer">
              Mode and settings writes are validated and recoverable. Privileged
              route and DNS recovery still require the documented Windows smoke
              test before an unattended release.
            </p>
          </aside>
        </div>

        <section className="panel results-panel">
          <div className="results-heading">
            <div>
              <span className="step-label">Step 02</span>
              <h2>Review generated rules</h2>
              <p>
                Rules match executable filenames like the legacy scanner. Clear
                anything that should bypass the proxy.
              </p>
            </div>
            <div className="result-stats" aria-label="Scan summary">
              <div><strong>{summary.executableCount}</strong><span>found</span></div>
              <div><strong>{rules.length}</strong><span>selected</span></div>
              <div><strong>{summary.warningCount}</strong><span>warnings</span></div>
            </div>
          </div>

          {report && report.executables.length > 0 ? (
            <>
              <div className="result-list" role="list">
                {report.executables.map((executable) => {
                  const checked = !excludedRules.has(executable.rule);
                  return (
                    <label className="result-row" key={executable.rule} role="listitem">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRule(executable.rule)}
                      />
                      <span className="file-glyph">EXE</span>
                      <span className="file-copy">
                        <strong>{executable.fileName}</strong>
                        <small>{executable.relativePath}</small>
                      </span>
                      <code>{executable.rule}</code>
                    </label>
                  );
                })}
              </div>

              {(report.warnings.length > 0 || report.skippedReparsePoints > 0) && (
                <details className="warning-details">
                  <summary>
                    Scan completed with {report.warnings.length} warning(s) and
                    {` ${report.skippedReparsePoints} `}directory link(s) skipped
                  </summary>
                  {report.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                </details>
              )}

              <div className="results-footer">
                <span>
                  {rules.length} rule{rules.length === 1 ? "" : "s"} ready for a
                  legacy process mode
                </span>
                <button
                  className="secondary-action"
                  disabled={rules.length === 0}
                  onClick={copyRules}
                  type="button"
                >
                  <CopyIcon /> {copied ? "Copied" : "Copy selected rules"}
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <span><SearchIcon /></span>
              <h3>{report ? "No executables found" : "Results will appear here"}</h3>
              <p>
                {report
                  ? "Choose a different application directory or review scan warnings."
                  : "Choose a directory and run the bounded scanner to generate rules."}
              </p>
            </div>
          )}
        </section>
          </>
        ) : activeView === "Activity" ? (
          <ActivityView snapshot={engineSnapshot} active />
        ) : (
          <SettingsView snapshot={engineSnapshot} active />
        )}
      </main>
    </div>
  );
}

export default App;

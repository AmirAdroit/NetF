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
  modeLabel,
  serverLabel,
  type EngineSnapshot,
  type EngineStatus,
} from "./engine";
import {
  normalizeThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "./theme";

const navItems = [
  { label: "Overview", icon: GridIcon, disabled: true },
  { label: "Servers", icon: ServerIcon, disabled: false },
  { label: "Modes", icon: LayersIcon, disabled: false },
  { label: "Activity", icon: ActivityIcon, disabled: true },
  { label: "Settings", icon: SettingsIcon, disabled: true },
];

function App() {
  const [activeView, setActiveView] = useState<"Servers" | "Modes">("Servers");
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
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);
  const [selectedModeId, setSelectedModeId] = useState<number | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [connectionMayBeActive, setConnectionMayBeActive] = useState(false);

  const summary = summarizeScan(report);
  const rules = useMemo(
    () => selectedRules(report, excludedRules),
    [report, excludedRules],
  );

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

  async function attachEngine() {
    if (engineBusy) return;
    try {
      setEngineBusy(true);
      setError("");
      const attachment = await invoke<{
        runtimeRoot: string;
        snapshot: EngineSnapshot;
      } | null>("attach_engine");
      if (!attachment) return;
      const { runtimeRoot: selected, snapshot } = attachment;
      setRuntimeRoot(selected);
      setEngineSnapshot(snapshot);
      setConnectionMayBeActive(snapshot.status.state !== "stopped");
      setSelectedServerId(snapshot.servers[0]?.id ?? null);
      setSelectedModeId(snapshot.modes[0]?.id ?? null);
    } catch (attachError) {
      setError(String(attachError));
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
        <div className="brand" aria-label="Netch modernization preview">
          <span className="brand-mark">N</span>
          <span className="brand-copy">
            <strong>Netch</strong>
            <small>modernization preview</small>
          </span>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          {navItems.map(({ label, icon: Icon, disabled }) => (
            <button
              className={`nav-item ${label === activeView ? "active" : ""}`}
              disabled={disabled}
              key={label}
              onClick={() => !disabled && setActiveView(label as "Servers" | "Modes")}
              title={disabled ? `${label} is coming in a later slice` : label}
            >
              <Icon />
              <span>{label}</span>
              {disabled && <span className="nav-dot" />}
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
              : "Attach a copied or existing Netch runtime to load servers and modes."}
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
            <p className="eyebrow">{activeView === "Servers" ? "Engine bridge" : "Process mode"}</p>
            <h1>{activeView === "Servers" ? "Connection control" : "Executable discovery"}</h1>
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
              <span /> {activeView === "Servers" ? "Compatibility engine" : "Preview · configuration writes disabled"}
            </div>
          </div>
        </header>

        {activeView === "Servers" ? (
          <div className="engine-workspace">
            <section className="hero-card engine-hero">
              <div className="hero-copy">
                <span className="feature-icon"><ServerIcon /></span>
                <div>
                  <h2>Run the proven engine behind the modern desktop</h2>
                  <p>
                    Attach a Netch installation directory containing <code>data</code>,
                    <code> mode</code>, and <code> bin</code>. Credentials stay inside the
                    .NET engine and are never returned to this webview.
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
                    <h3>Select your working Netch directory</h3>
                    <p>
                      Close the old Netch window first. The bridge reads the existing
                      server and mode configuration; it does not rewrite settings while attaching.
                    </p>
                    <button className="primary-action" disabled={engineBusy} onClick={attachEngine} type="button">
                      <FolderIcon /> {engineBusy ? "Attaching…" : "Choose Netch directory"}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="runtime-path">
                      <FolderIcon /><span>{runtimeRoot}</span>
                      <button disabled={engineBusy || engineSnapshot.status.state === "connected"} onClick={attachEngine} type="button">
                        Change
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
                        <select
                          disabled={engineBusy || engineSnapshot.status.state === "connected"}
                          value={selectedModeId ?? ""}
                          onChange={(event) => setSelectedModeId(Number(event.target.value))}
                        >
                          {engineSnapshot.modes.map((mode) => (
                            <option key={mode.id} value={mode.id}>
                              [{mode.type}] {modeLabel(mode)}
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
              </section>

              <aside className="panel health-panel">
                <div className="panel-heading compact">
                  <div><span className="step-label">Engine health</span><h2>Compatibility status</h2></div>
                </div>
                <dl className="health-list">
                  <div><dt>API</dt><dd className="good">{engineSnapshot ? `v${engineSnapshot.apiVersion}` : "Waiting"}</dd></div>
                  <div><dt>Servers</dt><dd>{engineSnapshot?.servers.length ?? 0}</dd></div>
                  <div><dt>Modes</dt><dd>{engineSnapshot?.modes.length ?? 0}</dd></div>
                  <div><dt>Missing helpers</dt><dd className={engineSnapshot?.missingHelpers.length ? "bad" : "good"}>{engineSnapshot?.missingHelpers.length ?? "—"}</dd></div>
                  <div><dt>Core source</dt><dd>{engineSnapshot ? "Attached runtime" : "—"}</dd></div>
                  <div><dt>Proxy cores</dt><dd>{engineSnapshot?.proxyCores.join(", ") || "—"}</dd></div>
                </dl>
                {engineSnapshot?.missingHelpers.length ? (
                  <div className="helper-warning">
                    <strong>Incomplete runtime</strong>
                    <p>{engineSnapshot.missingHelpers.join(", ")}</p>
                  </div>
                ) : (
                  <p className="health-explainer">
                    Attach only a known-good installation. Process, TUN, and sharing modes still require their matching native helpers and administrator access.
                  </p>
                )}
              </aside>
            </div>
          </div>
        ) : (
          <>

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
                This preview reads filenames only. It does not start, inspect, or
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
              <div><dt>Engine bridge</dt><dd className="good">Servers tab</dd></div>
              <div><dt>Administrator access</dt><dd className="muted">Compatibility phase</dd></div>
              <div><dt>Config writes</dt><dd className="good">Disabled</dd></div>
              <div><dt>Remote content</dt><dd className="good">None</dd></div>
            </dl>
            <p className="health-explainer">
              The narrow engine API is connected. Route and DNS recovery tests
              are still required before this preview can replace the legacy
              client for unattended daily use.
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
        )}
      </main>
    </div>
  );
}

export default App;

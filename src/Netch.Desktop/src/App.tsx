import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ActivityIcon,
  ChevronIcon,
  CopyIcon,
  FolderIcon,
  GridIcon,
  LayersIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
} from "./icons";
import {
  selectedRules,
  summarizeScan,
  type ScanReport,
} from "./scanner";

const navItems = [
  { label: "Overview", icon: GridIcon, disabled: true },
  { label: "Servers", icon: ServerIcon, disabled: true },
  { label: "Modes", icon: LayersIcon, disabled: false },
  { label: "Activity", icon: ActivityIcon, disabled: true },
  { label: "Settings", icon: SettingsIcon, disabled: true },
];

function App() {
  const [folder, setFolder] = useState("");
  const [maxResults, setMaxResults] = useState(50);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [excludedRules, setExcludedRules] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const summary = summarizeScan(report);
  const rules = useMemo(
    () => selectedRules(report, excludedRules),
    [report, excludedRules],
  );

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
              className={`nav-item ${label === "Modes" ? "active" : ""}`}
              disabled={disabled}
              key={label}
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
            Compatibility mode
          </div>
          <p>The legacy engine is preserved but not connected to this preview.</p>
          <button type="button" disabled>
            View engine plan <ChevronIcon />
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
            <p className="eyebrow">Process mode</p>
            <h1>Executable discovery</h1>
          </div>
          <div className="preview-badge">
            <span /> Preview · configuration writes disabled
          </div>
        </header>

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
              <div><dt>Engine bridge</dt><dd className="muted">Not connected</dd></div>
              <div><dt>Administrator access</dt><dd className="good">Not requested</dd></div>
              <div><dt>Config writes</dt><dd className="good">Disabled</dd></div>
              <div><dt>Remote content</dt><dd className="good">None</dd></div>
            </dl>
            <p className="health-explainer">
              Privileged networking will be added behind a narrow engine API,
              with rollback and recovery tests before this preview can replace
              the legacy client.
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
      </main>
    </div>
  );
}

export default App;

import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { CopyIcon, FolderIcon, SearchIcon } from "./icons";
import { errorMessage } from "./desktop";
import { selectedRules, summarizeScan, type ScanReport } from "./scanner";

export function ScannerView() {
  const [folder, setFolder] = useState("");
  const [maxResults, setMaxResults] = useState(50);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [excludedRules, setExcludedRules] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const summary = summarizeScan(report);
  const rules = useMemo(() => selectedRules(report, excludedRules), [report, excludedRules]);

  async function chooseFolder() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      setFolder(selected);
      setReport(null);
      setExcludedRules(new Set());
      setError("");
    } catch (dialogError) {
      setError(`Could not open the directory picker: ${errorMessage(dialogError)}`);
    }
  }

  async function scan() {
    if (!folder || busy) return;
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const result = await invoke<ScanReport>("scan_executables", { root: folder, maxResults });
      setReport(result);
      setExcludedRules(new Set());
    } catch (scanError) {
      setReport(null);
      setError(errorMessage(scanError));
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
      setError(`Could not copy rules: ${errorMessage(clipboardError)}`);
    }
  }

  return (
    <div className="scanner-compact-grid">
      <section className="panel scan-panel compact-scan-panel">
        <div className="panel-heading compact">
          <div><span className="step-label">Executable discovery</span><h2>Scan an application folder</h2></div>
          <span className="panel-state">Read-only</span>
        </div>
        <div className="compact-scan-controls">
          <div className="folder-field">
            <FolderIcon />
            <input readOnly value={folder} placeholder="Select a game or application directory" aria-label="Application directory" />
            <button type="button" onClick={chooseFolder}>Browse</button>
          </div>
          <label className="compact-limit">Limit<input type="number" min="1" max="5000" value={maxResults} onChange={(event) => setMaxResults(Math.min(5000, Math.max(1, Number(event.target.value))))} /></label>
          <button className="primary-action" disabled={!folder || busy} onClick={scan} type="button"><SearchIcon />{busy ? "Scanning…" : "Scan"}</button>
        </div>
        <p className="compact-help">Nested directories are scanned deterministically. Directory links are skipped and no files are modified or executed.</p>
        {error && <div className="error-banner" role="alert">{error}</div>}
      </section>

      <section className="panel results-panel compact-results-panel">
        <div className="results-heading compact-results-heading">
          <div><span className="step-label">Generated process rules</span><h2>Review and copy</h2></div>
          <div className="result-stats" aria-label="Scan summary">
            <div><strong>{summary.executableCount}</strong><span>found</span></div>
            <div><strong>{rules.length}</strong><span>selected</span></div>
            <div><strong>{summary.warningCount}</strong><span>warnings</span></div>
          </div>
        </div>
        {report?.executables.length ? (
          <>
            <div className="result-list compact-result-list" role="list">
              {report.executables.map((executable) => (
                <label className="result-row" key={executable.rule} role="listitem">
                  <input type="checkbox" checked={!excludedRules.has(executable.rule)} onChange={() => toggleRule(executable.rule)} />
                  <span className="file-glyph">EXE</span>
                  <span className="file-copy"><strong>{executable.fileName}</strong><small>{executable.relativePath}</small></span>
                  <code>{executable.rule}</code>
                </label>
              ))}
            </div>
            {(report.warnings.length > 0 || report.skippedReparsePoints > 0) && (
              <details className="warning-details"><summary>{report.warnings.length} warning(s); {report.skippedReparsePoints} directory link(s) skipped</summary>{report.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details>
            )}
            <div className="results-footer"><span>{rules.length} rule{rules.length === 1 ? "" : "s"} selected</span><button className="secondary-action" disabled={!rules.length} onClick={copyRules} type="button"><CopyIcon />{copied ? "Copied" : "Copy rules"}</button></div>
          </>
        ) : (
          <div className="empty-state compact-empty"><span><SearchIcon /></span><h3>{report ? "No executables found" : "No scan results yet"}</h3><p>{report ? "Choose a different directory or review scan warnings." : "Choose a folder above to generate deterministic executable-name rules."}</p></div>
        )}
      </section>
    </div>
  );
}

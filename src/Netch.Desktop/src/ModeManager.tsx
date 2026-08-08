import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LayersIcon, SearchIcon } from "./icons";
import {
  filterModes,
  modeLabel,
  modeOriginLabel,
  type EngineSnapshot,
  type ModeDetail,
  type ModeEditRequest,
  type ModeMergeResult,
  type ModeSaveResult,
} from "./engine";

interface ModeManagerProps {
  snapshot: EngineSnapshot;
  onSnapshot: (snapshot: EngineSnapshot) => void;
}

function rulesToText(rules: string[]): string {
  return rules.join("\n");
}

function textToRules(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/\r?\n/)
    .map((rule) => rule.trim())
    .filter((rule) => rule && !seen.has(rule.toLocaleLowerCase()) && seen.add(rule.toLocaleLowerCase()));
}

export function ModeManager({ snapshot, onSnapshot }: ModeManagerProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(snapshot.modes[0]?.id ?? null);
  const [detail, setDetail] = useState<ModeDetail | null>(null);
  const [remark, setRemark] = useState("");
  const [handleText, setHandleText] = useState("");
  const [bypassText, setBypassText] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const filteredModes = useMemo(() => filterModes(snapshot.modes, query), [snapshot.modes, query]);
  const selectedSummary = snapshot.modes.find((mode) => mode.id === selectedId) ?? null;
  const mergeSources = useMemo(
    () => filterModes(snapshot.modes, "").filter((mode) =>
      mode.id !== selectedId && mode.type === detail?.type && mode.type !== "ShareMode"),
    [snapshot.modes, selectedId, detail?.type],
  );
  const connectionLocked = snapshot.status.state !== "stopped" && snapshot.status.state !== "failed";

  useEffect(() => {
    if (selectedId === null && detail?.id === -1) return;
    if (selectedId !== null && snapshot.modes.some((mode) => mode.id === selectedId)) return;
    setSelectedId(snapshot.modes[0]?.id ?? null);
  }, [snapshot.modes, selectedId, detail?.id]);

  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    setBusy(true);
    setError("");
    invoke<ModeDetail>("mode_detail", { modeId: selectedId })
      .then((loaded) => {
        if (cancelled) return;
        setDetail(loaded);
        setRemark(loaded.remark);
        setHandleText(rulesToText(loaded.handle));
        setBypassText(rulesToText(loaded.bypass));
        setMergeSourceId(null);
      })
      .catch((loadError) => !cancelled && setError(String(loadError)))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  function startNew(type: "ProcessMode" | "TunMode") {
    const newMode: ModeDetail = {
      id: -1,
      type,
      remark: "",
      source: "Custom\\User\\New mode.json",
      origin: "user",
      editableInPlace: true,
      handleCount: 0,
      bypassCount: 0,
      handle: [],
      bypass: [],
    };
    setSelectedId(null);
    setDetail(newMode);
    setRemark("");
    setHandleText("");
    setBypassText("");
    setMergeSourceId(null);
    setMessage("");
    setError("");
  }

  async function saveMode() {
    if (!detail || busy || connectionLocked) return;
    const request: ModeEditRequest = {
      modeId: detail.id >= 0 ? detail.id : null,
      type: detail.type as "ProcessMode" | "TunMode",
      remark,
      handle: textToRules(handleText),
      bypass: textToRules(bypassText),
    };
    try {
      setBusy(true);
      setError("");
      setMessage("");
      const saved = await invoke<ModeSaveResult>("save_mode", { request });
      onSnapshot(saved.snapshot);
      setSelectedId(saved.mode.id);
      setDetail(saved.mode);
      setRemark(saved.mode.remark);
      setHandleText(rulesToText(saved.mode.handle));
      setBypassText(rulesToText(saved.mode.bypass));
      setMessage(saved.createdCopy ? "Saved as a user-owned mode; the original remains unchanged." : "Mode saved atomically. A rollback backup was kept.");
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function mergeMode() {
    if (!detail || detail.id < 0 || mergeSourceId === null || busy || connectionLocked) return;
    try {
      setBusy(true);
      setError("");
      setMessage("");
      const merged = await invoke<ModeMergeResult>("merge_modes", {
        sourceModeId: mergeSourceId,
        targetModeId: detail.id,
      });
      onSnapshot(merged.snapshot);
      setSelectedId(merged.mode.id);
      setDetail(merged.mode);
      setRemark(merged.mode.remark);
      setHandleText(rulesToText(merged.mode.handle));
      setBypassText(rulesToText(merged.mode.bypass));
      setMergeSourceId(null);
      setMessage(
        `Merged ${merged.addedHandleRules} handled and ${merged.addedBypassRules} bypass rule(s).${merged.createdCopy ? " The built-in target was saved as a user copy." : ""}`,
      );
    } catch (mergeError) {
      setError(String(mergeError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mode-manager-grid" aria-label="Mode library and editor">
      <div className="panel mode-library">
        <div className="panel-heading">
          <div><span className="step-label">Mode library</span><h2>{snapshot.modes.length} modes</h2></div>
          <div className="mode-create-actions">
            <button type="button" onClick={() => startNew("ProcessMode")}>+ Process</button>
            <button type="button" onClick={() => startNew("TunMode")}>+ TUN</button>
          </div>
        </div>
        <label className="mode-search">
          <SearchIcon />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, path, type, or origin"
          />
        </label>
        <div className="mode-origin-legend">
          <span className="origin-badge built-in">Built-in</span>
          <span className="origin-badge imported">Imported</span>
          <span className="origin-badge user">User</span>
        </div>
        <div className="mode-list" role="listbox" aria-label="Alphabetical modes">
          {filteredModes.map((mode) => (
            <button
              aria-selected={mode.id === selectedId}
              className={mode.id === selectedId ? "selected" : ""}
              key={mode.source}
              onClick={() => setSelectedId(mode.id)}
              role="option"
              type="button"
            >
              <span className={`origin-dot ${mode.origin}`} />
              <span><strong>{modeLabel(mode)}</strong><small>{mode.source}</small></span>
              <span className={`origin-badge ${mode.origin}`}>{modeOriginLabel(mode.origin)}</span>
            </button>
          ))}
          {!filteredModes.length && <p className="mode-empty">No modes match “{query}”.</p>}
        </div>
      </div>

      <div className="panel mode-editor">
        <div className="panel-heading">
          <div>
            <span className="step-label">Configuration editor</span>
            <h2>{detail ? remark || "New mode" : "Choose a mode"}</h2>
          </div>
          {detail && <span className={`origin-badge ${detail.origin}`}>{modeOriginLabel(detail.origin)}</span>}
        </div>

        {!detail ? (
          <div className="empty-state"><span><LayersIcon /></span><h3>Select a mode</h3><p>Inspect, customize, or merge its routing rules.</p></div>
        ) : detail.type === "ShareMode" ? (
          <div className="helper-warning"><strong>Sharing-mode arguments remain read-only</strong><p>Arbitrary sidecar arguments are intentionally not exposed to the webview. Create or edit process and TUN modes here.</p></div>
        ) : (
          <>
            <div className="mode-editor-meta">
              <span>{detail.type === "ProcessMode" ? "Process routing" : "TUN routing"}</span>
              <code>{detail.source}</code>
            </div>
            {!detail.editableInPlace && detail.id >= 0 && (
              <div className="trust-note"><strong>Copy-on-customize</strong><span>Saving creates a user-owned JSON copy so runtime updates cannot overwrite your changes.</span></div>
            )}
            <label className="field-label">
              Mode name
              <input value={remark} maxLength={128} onChange={(event) => setRemark(event.target.value)} />
            </label>
            <div className="rule-editor-grid">
              <label>
                Handled rules <span>{textToRules(handleText).length}</span>
                <textarea value={handleText} onChange={(event) => setHandleText(event.target.value)} spellCheck={false} placeholder="game\\.exe" />
              </label>
              <label>
                Bypass rules <span>{textToRules(bypassText).length}</span>
                <textarea value={bypassText} onChange={(event) => setBypassText(event.target.value)} spellCheck={false} placeholder="!launcher\\.exe" />
              </label>
            </div>
            {detail.id >= 0 && (
              <div className="mode-merge-row">
                <label>
                  Merge another {detail.type === "ProcessMode" ? "process" : "TUN"} mode into this one
                  <select value={mergeSourceId ?? ""} onChange={(event) => setMergeSourceId(event.target.value ? Number(event.target.value) : null)}>
                    <option value="">Choose source mode…</option>
                    {mergeSources.map((mode) => <option key={mode.source} value={mode.id}>{modeLabel(mode)} · {modeOriginLabel(mode.origin)}</option>)}
                  </select>
                </label>
                <button className="secondary-action" disabled={mergeSourceId === null || busy || connectionLocked} onClick={mergeMode} type="button">Merge rules</button>
              </div>
            )}
            <div className="mode-editor-actions">
              <button className="primary-action" disabled={!remark.trim() || busy || connectionLocked} onClick={saveMode} type="button">
                {busy ? "Saving…" : detail.editableInPlace ? "Save mode" : "Save user copy"}
              </button>
              {connectionLocked && <span>Disconnect before editing modes.</span>}
            </div>
          </>
        )}
        {error && <div className="error-banner" role="alert">{error}</div>}
        {message && <div className="success-banner" role="status">{message}</div>}
        {busy && selectedSummary && <span className="panel-state">Loading {modeLabel(selectedSummary)}…</span>}
      </div>
    </section>
  );
}

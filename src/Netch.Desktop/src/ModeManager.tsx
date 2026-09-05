import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LayersIcon, SearchIcon } from "./icons";
import {
  canMutateModes,
  filterModes,
  filterModesByOrigin,
  modeLabel,
  modeOriginLabel,
  type EngineSnapshot,
  type ModeDeleteResult,
  type ModeDetail,
  type ModeEditRequest,
  type ModeMergeResult,
  type ModeOriginFilter,
  type ModeSaveResult,
} from "./engine";
import { errorMessage } from "./desktop";

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
  const [originFilter, setOriginFilter] = useState<ModeOriginFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(snapshot.modes[0]?.id ?? null);
  const [detail, setDetail] = useState<ModeDetail | null>(null);
  const [remark, setRemark] = useState("");
  const [handleText, setHandleText] = useState("");
  const [bypassText, setBypassText] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ModeDetail | null>(null);

  const filteredModes = useMemo(
    () => filterModesByOrigin(snapshot.modes, query, originFilter),
    [snapshot.modes, query, originFilter],
  );
  const originCounts = useMemo(() => snapshot.modes.reduce(
    (counts, mode) => ({ ...counts, [mode.origin]: counts[mode.origin] + 1 }),
    { "built-in": 0, imported: 0, user: 0 },
  ), [snapshot.modes]);
  const selectedSummary = snapshot.modes.find((mode) => mode.id === selectedId) ?? null;
  const mergeSources = useMemo(
    () => filterModes(snapshot.modes, "").filter((mode) =>
      mode.id !== selectedId && mode.type === detail?.type && mode.type !== "ShareMode"),
    [snapshot.modes, selectedId, detail?.type],
  );
  const connectionLocked = !canMutateModes(snapshot);
  const handleRules = useMemo(() => textToRules(handleText), [handleText]);
  const bypassRules = useMemo(() => textToRules(bypassText), [bypassText]);

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
      .catch((loadError) => !cancelled && setError(errorMessage(loadError)))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!deleteTarget) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setDeleteTarget(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [deleteTarget]);

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
      handle: handleRules,
      bypass: bypassRules,
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
      setError(errorMessage(saveError));
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
      setError(errorMessage(mergeError));
    } finally {
      setBusy(false);
    }
  }

  async function deleteMode() {
    if (!deleteTarget || busy || connectionLocked) return;
    try {
      setBusy(true);
      setError("");
      setMessage("");
      const deleted = await invoke<ModeDeleteResult>("delete_mode", { modeId: deleteTarget.id });
      setDeleteTarget(null);
      setDetail(null);
      setSelectedId(deleted.snapshot.modes[0]?.id ?? null);
      onSnapshot(deleted.snapshot);
      setMessage(`${deleted.deletedRemark} was deleted. A durable backup was kept.`);
    } catch (deleteError) {
      setError(errorMessage(deleteError));
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
        <div className="mode-origin-legend" aria-label="Filter modes by origin">
          {([
            ["all", "All", snapshot.modes.length],
            ["built-in", "Built-in", originCounts["built-in"]],
            ["imported", "Imported", originCounts.imported],
            ["user", "User", originCounts.user],
          ] as const).map(([origin, label, count]) => (
            <button
              aria-pressed={originFilter === origin}
              className={`origin-filter ${origin} ${originFilter === origin ? "active" : ""}`}
              key={origin}
              onClick={() => setOriginFilter(originFilter === origin && origin !== "all" ? "all" : origin)}
              type="button"
            >
              {label} <span>{count}</span>
            </button>
          ))}
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
              <span><strong>{modeLabel(mode)}</strong><small>{mode.type === "ProcessMode" ? "Process" : mode.type === "TunMode" ? "TUN" : "Sharing"} · {mode.handleCount + mode.bypassCount} rules</small></span>
              <span className={`origin-badge ${mode.origin}`}>{modeOriginLabel(mode.origin)}</span>
            </button>
          ))}
          {!filteredModes.length && <p className="mode-empty">No modes match the current filters.</p>}
        </div>
      </div>

      <div className="panel mode-editor">
        <div className="panel-heading">
          <div>
            <span className="step-label">Configuration editor</span>
            <h2>{detail ? remark || "New mode" : "Choose a mode"}</h2>
          </div>
          {detail && <div className="mode-heading-actions"><span className={`origin-badge ${detail.origin}`}>{modeOriginLabel(detail.origin)}</span>{detail.id >= 0 && <button className="danger-action compact-danger" disabled={busy || connectionLocked} onClick={() => setDeleteTarget(detail)} type="button">Delete</button>}</div>}
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
                Handled rules <span>{handleRules.length}</span>
                <textarea value={handleText} onChange={(event) => setHandleText(event.target.value)} spellCheck={false} placeholder="game\\.exe" />
              </label>
              <label>
                Bypass rules <span>{bypassRules.length}</span>
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
      {deleteTarget && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDeleteTarget(null)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-mode-title" aria-describedby="delete-mode-description">
            <span className="danger-kicker">Permanent library change</span>
            <h2 id="delete-mode-title">Delete “{deleteTarget.remark}”?</h2>
            <p id="delete-mode-description">NetF will create a flushed timestamped backup first. Built-in deletion persists across runtime updates until its tombstone is removed manually.</p>
            <div className="dialog-actions">
              <button autoFocus className="secondary-action" onClick={() => setDeleteTarget(null)} type="button">Cancel</button>
              <button className="danger-action" disabled={busy || connectionLocked} onClick={deleteMode} type="button">{busy ? "Deleting…" : "Delete mode"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

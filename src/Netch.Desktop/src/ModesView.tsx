import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderIcon, LayersIcon, SearchIcon } from "./icons";
import { errorMessage } from "./desktop";
import type { EngineSnapshot } from "./engine";
import { ModeManager } from "./ModeManager";
import { ScannerView } from "./ScannerView";

interface ModesViewProps {
  snapshot: EngineSnapshot | null;
  onSnapshot: (snapshot: EngineSnapshot) => void;
}

export function ModesView({ snapshot, onSnapshot }: ModesViewProps) {
  const [workspace, setWorkspace] = useState<"library" | "scanner">("library");
  const [error, setError] = useState("");

  async function openModesFolder() {
    try {
      setError("");
      await invoke("open_owned_folder", { folder: "modes" });
    } catch (openError) {
      setError(errorMessage(openError));
    }
  }

  return (
    <div className="modes-workspace">
      <div className="modes-workspace-toolbar">
        <div className="workspace-tabs" role="tablist" aria-label="Modes workspace">
          <button role="tab" aria-selected={workspace === "library"} className={workspace === "library" ? "active" : ""} onClick={() => setWorkspace("library")} type="button"><LayersIcon />Library</button>
          <button role="tab" aria-selected={workspace === "scanner"} className={workspace === "scanner" ? "active" : ""} onClick={() => setWorkspace("scanner")} type="button"><SearchIcon />Scanner</button>
        </div>
        <button className="secondary-action folder-action" onClick={openModesFolder} type="button"><FolderIcon />Open modes folder</button>
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div role="tabpanel">
        {workspace === "library" ? (
          snapshot ? <ModeManager snapshot={snapshot} onSnapshot={onSnapshot} /> : <section className="panel settings-loading"><LayersIcon /><h2>Preparing mode library…</h2></section>
        ) : <ScannerView />}
      </div>
    </div>
  );
}

use crate::core::engine::{EngineSnapshot, EngineStatus, EngineSupervisor};
use crate::core::scanner::{self, ScanReport};
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineAttachment {
    runtime_root: String,
    snapshot: EngineSnapshot,
}

const LEGACY_DEFAULT_MAX_RESULTS: usize = 50;
const ABSOLUTE_MAX_RESULTS: usize = 5_000;

#[tauri::command]
pub async fn scan_executables(
    root: String,
    max_results: Option<usize>,
) -> Result<ScanReport, String> {
    let max_results = max_results
        .unwrap_or(LEGACY_DEFAULT_MAX_RESULTS)
        .clamp(1, ABSOLUTE_MAX_RESULTS);

    tauri::async_runtime::spawn_blocking(move || scanner::scan(root, max_results))
        .await
        .map_err(|error| format!("scanner task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn attach_engine(
    app: AppHandle,
    state: State<'_, Arc<EngineSupervisor>>,
) -> Result<Option<EngineAttachment>, String> {
    let supervisor = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app
            .dialog()
            .file()
            .set_title("Choose a trusted Netch installation")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let runtime_root = selected
            .into_path()
            .map_err(|error| format!("selected runtime path was invalid: {error}"))?;
        let snapshot = supervisor
            .attach(&runtime_root)
            .map_err(|error| error.to_string())?;
        Ok(Some(EngineAttachment {
            runtime_root: runtime_root.display().to_string(),
            snapshot,
        }))
    })
    .await
    .map_err(|error| format!("engine attachment task failed: {error}"))?
}

#[tauri::command]
pub async fn engine_snapshot(
    state: State<'_, Arc<EngineSupervisor>>,
) -> Result<EngineSnapshot, String> {
    let supervisor = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || supervisor.snapshot())
        .await
        .map_err(|error| format!("engine snapshot task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connect_profile(
    server_id: usize,
    mode_id: usize,
    state: State<'_, Arc<EngineSupervisor>>,
) -> Result<EngineStatus, String> {
    let supervisor = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || supervisor.connect(server_id, mode_id))
        .await
        .map_err(|error| format!("engine connection task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn disconnect_profile(
    state: State<'_, Arc<EngineSupervisor>>,
) -> Result<EngineStatus, String> {
    let supervisor = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || supervisor.disconnect())
        .await
        .map_err(|error| format!("engine disconnect task failed: {error}"))?
        .map_err(|error| error.to_string())
}

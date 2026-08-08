use crate::core::engine::{
    EngineLogResult, EngineSettings, EngineSnapshot, EngineStatus, EngineSupervisor,
    LegacyImportResult, ModeDetail, ModeEditRequest, ModeMergeResult, ModeSaveResult,
};
use crate::core::runtime::OwnedRuntime;
use crate::core::scanner::{self, ScanReport};
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    runtime_root: String,
    runtime_version: String,
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
pub fn runtime_info(state: State<'_, OwnedRuntime>) -> RuntimeInfo {
    RuntimeInfo {
        runtime_root: state.root.display().to_string(),
        runtime_version: state.version.clone(),
    }
}

#[tauri::command]
pub async fn import_legacy_configuration(
    app: AppHandle,
    state: State<'_, Arc<EngineSupervisor>>,
) -> Result<Option<LegacyImportResult>, String> {
    let supervisor = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app
            .dialog()
            .file()
            .set_title("Import configuration from an existing Netch installation")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let source = selected
            .into_path()
            .map_err(|error| format!("selected import path was invalid: {error}"))?;
        supervisor
            .import_legacy(source)
            .map(Some)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("legacy import task failed: {error}"))?
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

#[tauri::command]
pub async fn mode_detail(
    mode_id: usize,
    state: State<'_, Arc<EngineSupervisor>>,
) -> Result<ModeDetail, String> {
    let supervisor = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || supervisor.mode_detail(mode_id))
        .await
        .map_err(|error| format!("mode detail task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_mode(
    request: ModeEditRequest,
    state: State<'_, Arc<EngineSupervisor>>,
) -> Result<ModeSaveResult, String> {
    let supervisor = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || supervisor.save_mode(request))
        .await
        .map_err(|error| format!("mode save task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn merge_modes(
    source_mode_id: usize,
    target_mode_id: usize,
    state: State<'_, Arc<EngineSupervisor>>,
) -> Result<ModeMergeResult, String> {
    let supervisor = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        supervisor.merge_modes(source_mode_id, target_mode_id)
    })
    .await
    .map_err(|error| format!("mode merge task failed: {error}"))?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn engine_logs(
    limit: Option<usize>,
    state: State<'_, Arc<EngineSupervisor>>,
) -> Result<EngineLogResult, String> {
    let supervisor = Arc::clone(state.inner());
    let limit = limit.unwrap_or(200).clamp(1, 500);
    tauri::async_runtime::spawn_blocking(move || supervisor.logs(limit))
        .await
        .map_err(|error| format!("engine log task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn engine_settings(
    state: State<'_, Arc<EngineSupervisor>>,
) -> Result<EngineSettings, String> {
    let supervisor = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || supervisor.settings())
        .await
        .map_err(|error| format!("engine settings task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_engine_settings(
    settings: EngineSettings,
    state: State<'_, Arc<EngineSupervisor>>,
) -> Result<EngineSettings, String> {
    let supervisor = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || supervisor.update_settings(settings))
        .await
        .map_err(|error| format!("engine settings update task failed: {error}"))?
        .map_err(|error| error.to_string())
}

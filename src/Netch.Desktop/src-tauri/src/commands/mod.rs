use crate::core::desktop::{
    DesktopController, DesktopError, EngineRuntimeState, OwnedFolder, RuntimeInfo, StartupSnapshot,
};
use crate::core::engine::{
    EngineLogResult, EngineSettings, EngineSnapshot, EngineStatus, LegacyImportResult,
    ModeDeleteResult, ModeDetail, ModeEditRequest, ModeMergeResult, ModeSaveResult,
};
use crate::core::scanner::{self, ScanReport};
use crate::core::settings::{DesktopSettings, DesktopStartupStatus};
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

const LEGACY_DEFAULT_MAX_RESULTS: usize = 50;
const ABSOLUTE_MAX_RESULTS: usize = 5_000;

fn task_error(context: &str, error: impl std::fmt::Display) -> DesktopError {
    DesktopError::new(
        "desktop_task_failed",
        format!("{context} task failed: {error}"),
        true,
    )
}

#[tauri::command]
pub async fn scan_executables(
    root: String,
    max_results: Option<usize>,
) -> Result<ScanReport, DesktopError> {
    let max_results = max_results
        .unwrap_or(LEGACY_DEFAULT_MAX_RESULTS)
        .clamp(1, ABSOLUTE_MAX_RESULTS);
    tauri::async_runtime::spawn_blocking(move || scanner::scan(root, max_results))
        .await
        .map_err(|error| task_error("scanner", error))?
        .map_err(|error| DesktopError::new("scan_failed", error.to_string(), true))
}

#[tauri::command]
pub fn desktop_startup_status_snapshot(
    state: State<'_, Arc<DesktopController>>,
) -> StartupSnapshot {
    state.startup()
}

#[tauri::command]
pub fn engine_runtime_state(state: State<'_, Arc<DesktopController>>) -> EngineRuntimeState {
    state.engine_state()
}

#[tauri::command]
pub fn retry_desktop_startup(
    app: AppHandle,
    state: State<'_, Arc<DesktopController>>,
) -> StartupSnapshot {
    state.start(app);
    state.startup()
}

#[tauri::command]
pub fn runtime_info(state: State<'_, Arc<DesktopController>>) -> Result<RuntimeInfo, DesktopError> {
    state.runtime_info()
}

#[tauri::command]
pub async fn open_owned_folder(
    folder: OwnedFolder,
    state: State<'_, Arc<DesktopController>>,
) -> Result<(), DesktopError> {
    let controller = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || controller.open_owned_folder(folder))
        .await
        .map_err(|error| task_error("folder open", error))?
}

#[tauri::command]
pub async fn import_legacy_configuration(
    app: AppHandle,
    state: State<'_, Arc<DesktopController>>,
) -> Result<Option<LegacyImportResult>, DesktopError> {
    let controller = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app
            .dialog()
            .file()
            .set_title("Import configuration from an existing Netch installation")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let source = selected.into_path().map_err(|error| {
            DesktopError::new(
                "import_path_invalid",
                format!("Selected import path was invalid: {error}"),
                false,
            )
        })?;
        controller
            .ready_backend()?
            .import_legacy(&source)
            .map(Some)
            .map_err(DesktopError::from)
    })
    .await
    .map_err(|error| task_error("legacy import", error))?
}

#[tauri::command]
pub async fn engine_snapshot(
    app: AppHandle,
    state: State<'_, Arc<DesktopController>>,
) -> Result<EngineSnapshot, DesktopError> {
    let controller = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = controller
            .ready_backend()?
            .snapshot()
            .map_err(DesktopError::from)?;
        controller.publish_engine_status(&app, snapshot.status.clone());
        Ok(snapshot)
    })
    .await
    .map_err(|error| task_error("engine snapshot", error))?
}

#[tauri::command]
pub async fn connect_profile(
    app: AppHandle,
    server_id: usize,
    mode_id: usize,
    state: State<'_, Arc<DesktopController>>,
) -> Result<EngineStatus, DesktopError> {
    let controller = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || controller.connect(&app, server_id, mode_id))
        .await
        .map_err(|error| task_error("engine connection", error))?
}

#[tauri::command]
pub async fn disconnect_profile(
    app: AppHandle,
    state: State<'_, Arc<DesktopController>>,
) -> Result<EngineStatus, DesktopError> {
    let controller = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || controller.disconnect(&app))
        .await
        .map_err(|error| task_error("engine disconnect", error))?
}

#[tauri::command]
pub async fn mode_detail(
    mode_id: usize,
    state: State<'_, Arc<DesktopController>>,
) -> Result<ModeDetail, DesktopError> {
    let controller = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .ready_backend()?
            .mode_detail(mode_id)
            .map_err(DesktopError::from)
    })
    .await
    .map_err(|error| task_error("mode detail", error))?
}

#[tauri::command]
pub async fn save_mode(
    request: ModeEditRequest,
    state: State<'_, Arc<DesktopController>>,
) -> Result<ModeSaveResult, DesktopError> {
    let controller = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .ready_backend()?
            .save_mode(request)
            .map_err(DesktopError::from)
    })
    .await
    .map_err(|error| task_error("mode save", error))?
}

#[tauri::command]
pub async fn merge_modes(
    source_mode_id: usize,
    target_mode_id: usize,
    state: State<'_, Arc<DesktopController>>,
) -> Result<ModeMergeResult, DesktopError> {
    let controller = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .ready_backend()?
            .merge_modes(source_mode_id, target_mode_id)
            .map_err(DesktopError::from)
    })
    .await
    .map_err(|error| task_error("mode merge", error))?
}

#[tauri::command]
pub async fn delete_mode(
    mode_id: usize,
    state: State<'_, Arc<DesktopController>>,
) -> Result<ModeDeleteResult, DesktopError> {
    let controller = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .ready_backend()?
            .delete_mode(mode_id)
            .map_err(DesktopError::from)
    })
    .await
    .map_err(|error| task_error("mode deletion", error))?
}

#[tauri::command]
pub async fn engine_logs(
    limit: Option<usize>,
    state: State<'_, Arc<DesktopController>>,
) -> Result<EngineLogResult, DesktopError> {
    let controller = Arc::clone(state.inner());
    let limit = limit.unwrap_or(200).clamp(1, 500);
    tauri::async_runtime::spawn_blocking(move || controller.combined_logs(limit))
        .await
        .map_err(|error| task_error("log read", error))?
}

#[tauri::command]
pub async fn engine_settings(
    state: State<'_, Arc<DesktopController>>,
) -> Result<EngineSettings, DesktopError> {
    let controller = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .ready_backend()?
            .settings()
            .map_err(DesktopError::from)
    })
    .await
    .map_err(|error| task_error("engine settings", error))?
}

#[tauri::command]
pub async fn update_engine_settings(
    settings: EngineSettings,
    state: State<'_, Arc<DesktopController>>,
) -> Result<EngineSettings, DesktopError> {
    let controller = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .ready_backend()?
            .update_settings(settings)
            .map_err(DesktopError::from)
    })
    .await
    .map_err(|error| task_error("engine settings update", error))?
}

#[tauri::command]
pub fn desktop_settings(
    state: State<'_, Arc<DesktopController>>,
) -> Result<DesktopSettings, DesktopError> {
    state.desktop_settings()
}

#[tauri::command]
pub async fn desktop_autostart_status(
    state: State<'_, Arc<DesktopController>>,
) -> Result<DesktopStartupStatus, DesktopError> {
    let controller = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || controller.desktop_startup_status())
        .await
        .map_err(|error| task_error("desktop auto-start status", error))?
}

#[tauri::command]
pub async fn update_desktop_settings(
    settings: DesktopSettings,
    state: State<'_, Arc<DesktopController>>,
) -> Result<DesktopSettings, DesktopError> {
    let controller = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || controller.update_desktop_settings(settings))
        .await
        .map_err(|error| task_error("desktop settings update", error))?
}

mod commands;
mod core;

use crate::core::engine::EngineSupervisor;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(EngineSupervisor::default()))
        .invoke_handler(tauri::generate_handler![
            commands::scan_executables,
            commands::attach_engine,
            commands::engine_snapshot,
            commands::connect_profile,
            commands::disconnect_profile
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Netch desktop preview");
}

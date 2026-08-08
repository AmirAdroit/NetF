mod commands;
mod core;

use crate::core::engine::EngineSupervisor;
use crate::core::runtime::OwnedRuntime;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let runtime = OwnedRuntime::prepare(app.handle())?;
            let supervisor = Arc::new(EngineSupervisor::default());
            supervisor.attach(&runtime.root)?;
            app.manage(runtime);
            app.manage(supervisor);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_executables,
            commands::runtime_info,
            commands::import_legacy_configuration,
            commands::engine_snapshot,
            commands::connect_profile,
            commands::disconnect_profile
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Netch desktop preview");
}

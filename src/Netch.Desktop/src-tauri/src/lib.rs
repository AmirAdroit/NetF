mod commands;
mod core;
mod tray;

use crate::core::desktop::{DesktopController, spawn_health_monitor};
use crate::core::settings::CloseBehavior;
use std::sync::Arc;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _working_directory| {
                tray::show_main_window(app);
            },
        ))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let settings_path = app
                .path()
                .app_local_data_dir()?
                .join("desktop-settings.json");
            let controller = DesktopController::new(settings_path);
            app.manage(Arc::clone(&controller));
            tray::install(app.handle())?;
            tray::update(app.handle(), &controller.engine_state());

            let auto_started = std::env::args_os().any(|argument| argument == "--autostart");
            if !auto_started {
                tray::show_main_window(app.handle());
            } else {
                controller.log("Launched by Windows auto-start; main window remains hidden");
            }

            controller.start(app.handle().clone());
            spawn_health_monitor(app.handle().clone(), &controller);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let controller = window.state::<Arc<DesktopController>>();
                match controller
                    .desktop_settings()
                    .map(|settings| settings.close_behavior)
                {
                    Ok(CloseBehavior::Exit) => tray::request_exit(window.app_handle()),
                    _ => {
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_executables,
            commands::desktop_startup_status_snapshot,
            commands::engine_runtime_state,
            commands::retry_desktop_startup,
            commands::runtime_info,
            commands::open_owned_folder,
            commands::import_legacy_configuration,
            commands::previous_netf_data_available,
            commands::import_previous_netf_configuration,
            commands::server_detail,
            commands::save_server,
            commands::import_server_link,
            commands::duplicate_server,
            commands::delete_server,
            commands::test_server_latency,
            commands::test_all_server_latencies,
            commands::engine_snapshot,
            commands::connect_profile,
            commands::disconnect_profile,
            commands::mode_detail,
            commands::save_mode,
            commands::merge_modes,
            commands::delete_mode,
            commands::engine_logs,
            commands::engine_settings,
            commands::update_engine_settings,
            commands::desktop_settings,
            commands::desktop_autostart_status,
            commands::update_desktop_settings
        ])
        .run(tauri::generate_context!())
        .expect("failed to run NetF desktop");
}

mod commands;
mod core;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![commands::scan_executables])
        .run(tauri::generate_context!())
        .expect("failed to run Netch desktop preview");
}

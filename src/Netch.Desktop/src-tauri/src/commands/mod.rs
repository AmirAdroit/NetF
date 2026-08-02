use crate::core::scanner::{self, ScanReport};

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

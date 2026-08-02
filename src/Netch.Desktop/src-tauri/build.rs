fn main() {
    let mut windows = tauri_build::WindowsAttributes::new();
    if std::env::var_os("CARGO_FEATURE_ELEVATED").is_some() {
        windows = windows.app_manifest(include_str!("app.manifest"));
    }
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
}

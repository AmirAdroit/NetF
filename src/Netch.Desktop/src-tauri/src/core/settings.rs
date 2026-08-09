use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use thiserror::Error;

const SETTINGS_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopSettings {
    pub schema_version: u32,
    pub run_at_windows_login: bool,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            run_at_windows_login: false,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStartupStatus {
    pub enabled: bool,
    pub matches_current_executable: bool,
    pub task_name: String,
    pub registered_executable: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("Could not read NetF desktop settings: {0}")]
    Read(String),
    #[error("NetF desktop settings are invalid: {0}")]
    Invalid(String),
    #[error("Could not save NetF desktop settings: {0}")]
    Write(String),
    #[error("The desktop settings lock was poisoned")]
    Poisoned,
}

pub struct SettingsStore {
    path: PathBuf,
    value: Mutex<DesktopSettings>,
}

impl SettingsStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            value: Mutex::new(DesktopSettings::default()),
        }
    }

    pub fn load(&self) -> Result<DesktopSettings, SettingsError> {
        let loaded = if self.path.exists() {
            let bytes =
                fs::read(&self.path).map_err(|error| SettingsError::Read(error.to_string()))?;
            let parsed: DesktopSettings = serde_json::from_slice(&bytes)
                .map_err(|error| SettingsError::Invalid(error.to_string()))?;
            validate(&parsed)?;
            parsed
        } else {
            DesktopSettings::default()
        };
        *self.value.lock().map_err(|_| SettingsError::Poisoned)? = loaded.clone();
        Ok(loaded)
    }

    pub fn get(&self) -> Result<DesktopSettings, SettingsError> {
        self.value
            .lock()
            .map(|value| value.clone())
            .map_err(|_| SettingsError::Poisoned)
    }

    pub fn save(&self, settings: DesktopSettings) -> Result<DesktopSettings, SettingsError> {
        validate(&settings)?;
        let bytes = serde_json::to_vec_pretty(&settings)
            .map_err(|error| SettingsError::Write(error.to_string()))?;
        atomic_write(&self.path, &bytes)?;
        *self.value.lock().map_err(|_| SettingsError::Poisoned)? = settings.clone();
        Ok(settings)
    }

    #[cfg(test)]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

fn validate(settings: &DesktopSettings) -> Result<(), SettingsError> {
    if settings.schema_version != SETTINGS_SCHEMA_VERSION {
        return Err(SettingsError::Invalid(format!(
            "unsupported schema version {}",
            settings.schema_version
        )));
    }
    Ok(())
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), SettingsError> {
    let parent = path
        .parent()
        .ok_or_else(|| SettingsError::Write("settings path had no parent directory".into()))?;
    fs::create_dir_all(parent).map_err(|error| SettingsError::Write(error.to_string()))?;
    let temporary = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let mut file =
        File::create(&temporary).map_err(|error| SettingsError::Write(error.to_string()))?;
    file.write_all(contents)
        .and_then(|_| file.sync_all())
        .map_err(|error| SettingsError::Write(error.to_string()))?;
    atomic_replace(&temporary, path)
}

#[cfg(windows)]
fn atomic_replace(temporary: &Path, destination: &Path) -> Result<(), SettingsError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let succeeded = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if succeeded == 0 {
        return Err(SettingsError::Write(format!(
            "atomic replace failed: {}",
            io::Error::last_os_error()
        )));
    }
    Ok(())
}

#[cfg(not(windows))]
fn atomic_replace(temporary: &Path, destination: &Path) -> Result<(), SettingsError> {
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| SettingsError::Write(error.to_string()))?;
    }
    fs::rename(temporary, destination).map_err(|error| SettingsError::Write(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn desktop_settings_are_atomic_and_default_to_no_autostart() {
        let directory = tempdir().unwrap();
        let store = SettingsStore::new(directory.path().join("desktop-settings.json"));
        assert!(!store.load().unwrap().run_at_windows_login);
        let saved = store
            .save(DesktopSettings {
                run_at_windows_login: true,
                ..DesktopSettings::default()
            })
            .unwrap();
        assert!(saved.run_at_windows_login);
        assert!(store.path().is_file());
        assert_eq!(store.load().unwrap(), saved);
    }
}

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};
use thiserror::Error;

const MANIFEST_NAME: &str = "runtime-manifest.json";
const MANIFEST_SCHEMA_VERSION: u32 = 1;
const MAXIMUM_MANIFEST_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone)]
pub struct OwnedRuntime {
    pub root: PathBuf,
    pub version: String,
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("Could not resolve the desktop runtime path: {0}")]
    Path(String),
    #[error("The packaged runtime is invalid: {0}")]
    InvalidPackage(String),
    #[error("Could not install the owned runtime: {0}")]
    Install(String),
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeManifest {
    schema_version: u32,
    runtime_version: String,
    files: Vec<RuntimeFile>,
}

#[derive(Debug, Deserialize, Serialize)]
struct RuntimeFile {
    path: String,
    length: u64,
    sha256: String,
}

impl OwnedRuntime {
    pub fn prepare(app: &AppHandle) -> Result<Self, RuntimeError> {
        let source = locate_template(app)?;
        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|error| RuntimeError::Path(error.to_string()))?
            .join("runtime");
        install_template(&source, &root)
    }
}

fn locate_template(app: &AppHandle) -> Result<PathBuf, RuntimeError> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|error| RuntimeError::Path(error.to_string()))?
        .join("runtime-template");
    if packaged.join(MANIFEST_NAME).is_file() {
        return Ok(packaged);
    }

    #[cfg(debug_assertions)]
    {
        let current =
            std::env::current_dir().map_err(|error| RuntimeError::Path(error.to_string()))?;
        for candidate in [
            current.join("runtime-template"),
            current.join("src-tauri/runtime-template"),
        ] {
            if candidate.join(MANIFEST_NAME).is_file() {
                return Ok(candidate);
            }
        }
    }

    Err(RuntimeError::InvalidPackage(format!(
        "{} is missing; run npm run prepare:runtime",
        packaged.display()
    )))
}

fn install_template(source: &Path, root: &Path) -> Result<OwnedRuntime, RuntimeError> {
    let manifest_path = source.join(MANIFEST_NAME);
    let manifest_metadata = fs::metadata(&manifest_path)
        .map_err(|error| RuntimeError::InvalidPackage(error.to_string()))?;
    if manifest_metadata.len() > MAXIMUM_MANIFEST_BYTES {
        return Err(RuntimeError::InvalidPackage(
            "runtime manifest exceeded 1 MiB".into(),
        ));
    }
    let manifest: RuntimeManifest = serde_json::from_reader(
        File::open(&manifest_path)
            .map_err(|error| RuntimeError::InvalidPackage(error.to_string()))?,
    )
    .map_err(|error| RuntimeError::InvalidPackage(error.to_string()))?;
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err(RuntimeError::InvalidPackage(format!(
            "unsupported manifest schema {}",
            manifest.schema_version
        )));
    }
    if manifest.runtime_version.trim().is_empty() {
        return Err(RuntimeError::InvalidPackage(
            "runtime version was empty".into(),
        ));
    }

    reject_reparse_point(root)?;
    fs::create_dir_all(root).map_err(|error| RuntimeError::Install(error.to_string()))?;
    for directory in ["data", "mode/Custom", "logging", "licenses"] {
        let path = root.join(directory);
        reject_reparse_point(&path)?;
        fs::create_dir_all(&path).map_err(|error| RuntimeError::Install(error.to_string()))?;
    }

    for entry in &manifest.files {
        let relative = validate_relative_path(&entry.path)?;
        let packaged_file = source.join(&relative);
        let metadata = fs::metadata(&packaged_file)
            .map_err(|error| RuntimeError::InvalidPackage(error.to_string()))?;
        if !metadata.is_file() || metadata.len() != entry.length {
            return Err(RuntimeError::InvalidPackage(format!(
                "{} has an unexpected type or length",
                entry.path
            )));
        }
        if hash_file(&packaged_file)
            .map_err(|error| RuntimeError::InvalidPackage(error.to_string()))?
            != entry.sha256
        {
            return Err(RuntimeError::InvalidPackage(format!(
                "{} failed SHA-256 verification",
                entry.path
            )));
        }

        let destination = root.join(&relative);
        reject_reparse_point(&destination)?;
        if destination.is_file()
            && fs::metadata(&destination).map(|item| item.len()).ok() == Some(entry.length)
            && hash_file(&destination).ok().as_deref() == Some(entry.sha256.as_str())
        {
            continue;
        }
        install_file(&packaged_file, &destination)?;
    }

    let installed_manifest = root.join(MANIFEST_NAME);
    install_file(&manifest_path, &installed_manifest)?;
    let settings = root.join("data/settings.json");
    if !settings.exists() {
        atomic_write(&settings, b"{}\n")?;
    }

    Ok(OwnedRuntime {
        root: root.to_path_buf(),
        version: manifest.runtime_version,
    })
}

fn validate_relative_path(value: &str) -> Result<PathBuf, RuntimeError> {
    let path = Path::new(value);
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(RuntimeError::InvalidPackage(format!(
            "unsafe runtime path: {value}"
        )));
    }
    Ok(path.to_path_buf())
}

fn install_file(source: &Path, destination: &Path) -> Result<(), RuntimeError> {
    let parent = destination
        .parent()
        .ok_or_else(|| RuntimeError::Install("runtime file had no parent directory".into()))?;
    reject_reparse_point(parent)?;
    fs::create_dir_all(parent).map_err(|error| RuntimeError::Install(error.to_string()))?;
    let temporary = temporary_path(destination);
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(|error| RuntimeError::Install(error.to_string()))?;
    }
    fs::copy(source, &temporary).map_err(|error| RuntimeError::Install(error.to_string()))?;
    File::options()
        .write(true)
        .open(&temporary)
        .and_then(|file| file.sync_all())
        .map_err(|error| RuntimeError::Install(error.to_string()))?;
    atomic_replace(&temporary, destination)
}

fn atomic_write(destination: &Path, contents: &[u8]) -> Result<(), RuntimeError> {
    let parent = destination
        .parent()
        .ok_or_else(|| RuntimeError::Install("runtime file had no parent directory".into()))?;
    reject_reparse_point(parent)?;
    fs::create_dir_all(parent).map_err(|error| RuntimeError::Install(error.to_string()))?;
    let temporary = temporary_path(destination);
    let mut file =
        File::create(&temporary).map_err(|error| RuntimeError::Install(error.to_string()))?;
    file.write_all(contents)
        .and_then(|_| file.sync_all())
        .map_err(|error| RuntimeError::Install(error.to_string()))?;
    atomic_replace(&temporary, destination)
}

fn temporary_path(destination: &Path) -> PathBuf {
    let mut name = destination.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".{}.tmp", std::process::id()));
    destination.with_file_name(name)
}

fn hash_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex::encode(digest.finalize()))
}

fn reject_reparse_point(path: &Path) -> Result<(), RuntimeError> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if let Ok(metadata) = fs::symlink_metadata(candidate)
            && is_reparse_point(&metadata)
        {
            return Err(RuntimeError::Install(format!(
                "owned runtime path contains a filesystem reparse point: {}",
                candidate.display()
            )));
        }
        current = candidate.parent();
    }
    Ok(())
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes()
        & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
        != 0
}

#[cfg(not(windows))]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(windows)]
fn atomic_replace(temporary: &Path, destination: &Path) -> Result<(), RuntimeError> {
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
        return Err(RuntimeError::Install(format!(
            "atomic replace {} -> {} failed: {}",
            temporary.display(),
            destination.display(),
            io::Error::last_os_error()
        )));
    }
    Ok(())
}

#[cfg(not(windows))]
fn atomic_replace(temporary: &Path, destination: &Path) -> Result<(), RuntimeError> {
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| RuntimeError::Install(error.to_string()))?;
    }
    fs::rename(temporary, destination).map_err(|error| RuntimeError::Install(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write_template_file(root: &Path, relative: &str, contents: &[u8]) -> RuntimeFile {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, contents).unwrap();
        RuntimeFile {
            path: relative.into(),
            length: contents.len() as u64,
            sha256: hash_file(&path).unwrap(),
        }
    }

    fn write_manifest(root: &Path, files: Vec<RuntimeFile>) {
        let manifest = RuntimeManifest {
            schema_version: 1,
            runtime_version: "test-1".into(),
            files,
        };
        fs::write(
            root.join(MANIFEST_NAME),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn install_verifies_assets_and_preserves_mutable_user_data() {
        let source = tempdir().unwrap();
        let destination = tempdir().unwrap();
        let files = vec![
            write_template_file(source.path(), "bin/xray.exe", b"verified core"),
            write_template_file(source.path(), "mode/Global.json", b"packaged mode"),
        ];
        write_manifest(source.path(), files);
        fs::create_dir_all(destination.path().join("data")).unwrap();
        fs::write(
            destination.path().join("data/settings.json"),
            b"user settings",
        )
        .unwrap();

        let installed = install_template(source.path(), destination.path()).unwrap();

        assert_eq!(installed.version, "test-1");
        assert_eq!(
            fs::read(destination.path().join("bin/xray.exe")).unwrap(),
            b"verified core"
        );
        assert_eq!(
            fs::read(destination.path().join("data/settings.json")).unwrap(),
            b"user settings"
        );
    }

    #[test]
    fn install_rejects_manifest_traversal() {
        let source = tempdir().unwrap();
        let destination = tempdir().unwrap();
        write_manifest(
            source.path(),
            vec![RuntimeFile {
                path: "../escape.exe".into(),
                length: 0,
                sha256: hex::encode(Sha256::digest([])),
            }],
        );

        assert!(matches!(
            install_template(source.path(), destination.path()),
            Err(RuntimeError::InvalidPackage(_))
        ));
    }
}

use super::backend::{BackendInfo, EngineBackend, NetchCompatibilityBackend};
use super::engine::{EngineError, EngineLogResult, EngineStatus};
use super::runtime::OwnedRuntime;
use super::settings::{DesktopSettings, DesktopStartupStatus, SettingsError, SettingsStore};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::os::windows::fs::MetadataExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const DESKTOP_LOG_LIMIT: usize = 500;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OwnedFolder {
    Modes,
    AppData,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StartupPhase {
    Waiting,
    LoadingSettings,
    PreparingRuntime,
    StartingEngine,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartupSnapshot {
    pub phase: StartupPhase,
    pub message: String,
    pub elapsed_ms: u64,
    pub retryable: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EnginePhase {
    Stopped,
    Starting,
    Connected,
    Stopping,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EngineRuntimeState {
    pub phase: EnginePhase,
    pub active: bool,
    pub message: String,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub runtime_root: String,
    pub runtime_version: String,
    pub backend: Option<BackendInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl DesktopError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable,
        }
    }
}

impl From<EngineError> for DesktopError {
    fn from(error: EngineError) -> Self {
        let (code, retryable) = match &error {
            EngineError::InvalidRuntime(_) => ("invalid_runtime", false),
            EngineError::HostUnavailable(_) => ("engine_host_unavailable", true),
            EngineError::Start(_) => ("engine_start_failed", true),
            EngineError::Stopped(_) => ("engine_stopped", true),
            EngineError::Protocol(_) => ("engine_protocol_failed", true),
            EngineError::Rejected { code, .. } => (code.as_str(), true),
            EngineError::NotAttached => ("engine_not_ready", true),
            EngineError::ActiveRuntime => ("engine_active", false),
        };
        Self::new(code, error.to_string(), retryable)
    }
}

impl From<SettingsError> for DesktopError {
    fn from(error: SettingsError) -> Self {
        Self::new("desktop_settings_failed", error.to_string(), true)
    }
}

struct DesktopState {
    startup: StartupSnapshot,
    engine: EngineRuntimeState,
    runtime: Option<OwnedRuntime>,
}

pub struct DesktopController {
    backend: Arc<dyn EngineBackend>,
    settings: SettingsStore,
    state: Mutex<DesktopState>,
    logs: Mutex<VecDeque<String>>,
    initializing: AtomicBool,
    shutting_down: AtomicBool,
    health_probe_count: AtomicU64,
    health_probe_total_ms: AtomicU64,
    health_probe_max_ms: AtomicU64,
}

impl DesktopController {
    pub fn new(settings_path: PathBuf) -> Arc<Self> {
        Self::with_backend(
            settings_path,
            Arc::new(NetchCompatibilityBackend::default()),
        )
    }

    fn with_backend(settings_path: PathBuf, backend: Arc<dyn EngineBackend>) -> Arc<Self> {
        Arc::new(Self {
            backend,
            settings: SettingsStore::new(settings_path),
            state: Mutex::new(DesktopState {
                startup: StartupSnapshot {
                    phase: StartupPhase::Waiting,
                    message: "Waiting for desktop initialization".into(),
                    elapsed_ms: 0,
                    retryable: false,
                },
                engine: EngineRuntimeState {
                    phase: EnginePhase::Unknown,
                    active: false,
                    message: "Engine status is not known yet".into(),
                    updated_at_ms: now_ms(),
                },
                runtime: None,
            }),
            logs: Mutex::new(VecDeque::new()),
            initializing: AtomicBool::new(false),
            shutting_down: AtomicBool::new(false),
            health_probe_count: AtomicU64::new(0),
            health_probe_total_ms: AtomicU64::new(0),
            health_probe_max_ms: AtomicU64::new(0),
        })
    }

    pub fn start(self: &Arc<Self>, app: AppHandle) -> bool {
        if self
            .initializing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return false;
        }
        self.shutting_down.store(false, Ordering::Release);
        let controller = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || controller.initialize(app));
        true
    }

    fn initialize(self: &Arc<Self>, app: AppHandle) {
        let started = Instant::now();
        self.transition_startup(
            &app,
            StartupPhase::LoadingSettings,
            "Loading validated desktop settings",
            started,
            false,
        );
        let settings_started = Instant::now();
        let desktop_settings = match self.settings.load() {
            Ok(settings) => settings,
            Err(error) => {
                self.log(format!("Desktop settings were not loaded: {error}"));
                DesktopSettings::default()
            }
        };
        self.log(format!(
            "Startup timing: settings-load={} ms",
            settings_started.elapsed().as_millis()
        ));

        self.transition_startup(
            &app,
            StartupPhase::PreparingRuntime,
            "Verifying and preparing the owned runtime",
            started,
            false,
        );
        let runtime_started = Instant::now();
        let runtime = match OwnedRuntime::prepare(&app) {
            Ok(runtime) => runtime,
            Err(error) => {
                self.fail_startup(&app, started, error.to_string());
                return;
            }
        };
        self.log(format!(
            "Startup timing: runtime-verification-install={} ms; version={}",
            runtime_started.elapsed().as_millis(),
            runtime.version
        ));

        self.transition_startup(
            &app,
            StartupPhase::StartingEngine,
            "Starting and validating the compatibility backend",
            started,
            false,
        );
        let attachment = match self.backend.attach(&runtime.root) {
            Ok(attachment) => attachment,
            Err(error) => {
                self.fail_startup(&app, started, error.to_string());
                return;
            }
        };
        self.log(format!(
            "Startup timing: engine-spawn={} ms handshake={} ms snapshot={} ms",
            attachment.spawn_ms, attachment.handshake_ms, attachment.snapshot_ms
        ));

        if desktop_settings.run_at_windows_login {
            match current_executable().and_then(|path| {
                self.backend
                    .configure_desktop_startup(&path, true)
                    .map_err(DesktopError::from)
            }) {
                Ok(_) => self.log("Windows auto-start registration verified"),
                Err(error) => self.log(format!(
                    "Windows auto-start registration needs attention: {}",
                    error.message
                )),
            }
        }

        if let Ok(mut state) = self.state.lock() {
            state.runtime = Some(runtime);
        }
        self.publish_engine_status(&app, attachment.snapshot.status);
        self.transition_startup(&app, StartupPhase::Ready, "NetF is ready", started, false);
        self.log(format!(
            "Startup timing: total={} ms; backend={} {}",
            started.elapsed().as_millis(),
            attachment.info.display_name,
            attachment.info.version
        ));
        self.initializing.store(false, Ordering::Release);
    }

    fn fail_startup(&self, app: &AppHandle, started: Instant, message: String) {
        self.log(format!("Desktop initialization failed: {message}"));
        self.transition_engine(app, EnginePhase::Failed, false, message.clone());
        self.transition_startup(app, StartupPhase::Failed, &message, started, true);
        self.initializing.store(false, Ordering::Release);
    }

    fn transition_startup(
        &self,
        app: &AppHandle,
        phase: StartupPhase,
        message: &str,
        started: Instant,
        retryable: bool,
    ) {
        let snapshot = StartupSnapshot {
            phase,
            message: message.into(),
            elapsed_ms: started.elapsed().as_millis().try_into().unwrap_or(u64::MAX),
            retryable,
        };
        if let Ok(mut state) = self.state.lock() {
            state.startup = snapshot.clone();
        }
        let _ = app.emit("desktop-startup-changed", &snapshot);
    }

    pub fn startup(&self) -> StartupSnapshot {
        self.state
            .lock()
            .map(|state| state.startup.clone())
            .unwrap_or(StartupSnapshot {
                phase: StartupPhase::Failed,
                message: "Desktop state lock was poisoned".into(),
                elapsed_ms: 0,
                retryable: true,
            })
    }

    pub fn engine_state(&self) -> EngineRuntimeState {
        self.state
            .lock()
            .map(|state| state.engine.clone())
            .unwrap_or(EngineRuntimeState {
                phase: EnginePhase::Failed,
                active: false,
                message: "Desktop state lock was poisoned".into(),
                updated_at_ms: now_ms(),
            })
    }

    pub fn runtime_info(&self) -> Result<RuntimeInfo, DesktopError> {
        let state = self.state.lock().map_err(|_| {
            DesktopError::new(
                "desktop_state_failed",
                "Desktop state lock was poisoned",
                true,
            )
        })?;
        let runtime = state
            .runtime
            .as_ref()
            .ok_or_else(|| self.not_ready_error())?;
        Ok(RuntimeInfo {
            runtime_root: runtime.root.display().to_string(),
            runtime_version: runtime.version.clone(),
            backend: self.backend.info(),
        })
    }

    pub fn open_owned_folder(&self, folder: OwnedFolder) -> Result<(), DesktopError> {
        let runtime_root = {
            let state = self.state.lock().map_err(|_| {
                DesktopError::new(
                    "desktop_state_failed",
                    "Desktop state lock was poisoned",
                    true,
                )
            })?;
            state.runtime.as_ref().map(|runtime| runtime.root.clone())
        }
        .ok_or_else(|| self.not_ready_error())?;
        let target = resolve_owned_folder(&runtime_root, folder)?;
        Command::new("explorer.exe")
            .arg(&target)
            .spawn()
            .map_err(|error| {
                DesktopError::new(
                    "open_folder_failed",
                    format!("Could not open the NetF folder: {error}"),
                    true,
                )
            })?;
        Ok(())
    }

    pub fn ready_backend(&self) -> Result<&dyn EngineBackend, DesktopError> {
        if self.startup().phase != StartupPhase::Ready {
            return Err(self.not_ready_error());
        }
        Ok(self.backend.as_ref())
    }

    fn not_ready_error(&self) -> DesktopError {
        let startup = self.startup();
        DesktopError::new(
            "engine_not_ready",
            format!("NetF is not ready: {}", startup.message),
            startup.retryable,
        )
    }

    pub fn publish_engine_status(&self, app: &AppHandle, status: EngineStatus) {
        let phase = engine_phase(&status.state);
        let active = matches!(
            phase,
            EnginePhase::Starting | EnginePhase::Connected | EnginePhase::Stopping
        );
        self.transition_engine(app, phase, active, status.message);
    }

    pub fn transition_engine(
        &self,
        app: &AppHandle,
        phase: EnginePhase,
        active: bool,
        message: impl Into<String>,
    ) {
        let message = message.into();
        let snapshot = EngineRuntimeState {
            phase,
            active,
            message,
            updated_at_ms: now_ms(),
        };
        let mut previous_phase = None;
        let changed = if let Ok(mut state) = self.state.lock() {
            if state.engine.phase == snapshot.phase
                && state.engine.active == snapshot.active
                && state.engine.message == snapshot.message
            {
                false
            } else {
                previous_phase = Some(state.engine.phase);
                state.engine = snapshot.clone();
                true
            }
        } else {
            false
        };
        if changed {
            if let Some(previous) = previous_phase {
                self.log(format!(
                    "Engine state transition: {previous:?} -> {phase:?}"
                ));
            }
            let _ = app.emit("engine-status-changed", &snapshot);
            crate::tray::update(app, &snapshot);
        }
    }

    pub fn connect(
        &self,
        app: &AppHandle,
        server_id: usize,
        mode_id: usize,
    ) -> Result<EngineStatus, DesktopError> {
        self.transition_engine(
            app,
            EnginePhase::Starting,
            true,
            "Validating and starting profile",
        );
        match self.ready_backend()?.connect(server_id, mode_id) {
            Ok(status) => {
                self.publish_engine_status(app, status.clone());
                Ok(status)
            }
            Err(error) => {
                let error = DesktopError::from(error);
                self.log(format!(
                    "Engine cleanup failed during disconnect: {}",
                    error.code
                ));
                self.transition_engine(app, EnginePhase::Failed, true, error.message.clone());
                Err(error)
            }
        }
    }

    pub fn disconnect(&self, app: &AppHandle) -> Result<EngineStatus, DesktopError> {
        self.transition_engine(
            app,
            EnginePhase::Stopping,
            true,
            "Stopping profile and restoring network state",
        );
        match self.ready_backend()?.disconnect() {
            Ok(status) => {
                self.publish_engine_status(app, status.clone());
                Ok(status)
            }
            Err(error) => {
                let error = DesktopError::from(error);
                self.transition_engine(app, EnginePhase::Failed, true, error.message.clone());
                Err(error)
            }
        }
    }

    pub fn poll_health(&self, app: &AppHandle) {
        if self.startup().phase != StartupPhase::Ready || self.shutting_down.load(Ordering::Acquire)
        {
            return;
        }
        let started = Instant::now();
        match self.backend.try_status() {
            Ok(Some(status)) => self.publish_engine_status(app, status),
            Ok(None) => {}
            Err(error) => {
                let error = DesktopError::from(error);
                self.log(format!("Engine health probe failed: {}", error.code));
                self.transition_engine(app, EnginePhase::Failed, true, error.message);
            }
        }
        let elapsed: u64 = started.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
        let count = self.health_probe_count.fetch_add(1, Ordering::Relaxed) + 1;
        let total = self
            .health_probe_total_ms
            .fetch_add(elapsed, Ordering::Relaxed)
            + elapsed;
        self.health_probe_max_ms
            .fetch_max(elapsed, Ordering::Relaxed);
        if count.is_multiple_of(20) {
            self.log(format!(
                "Health probe timing: count={count} total={total} ms average={} ms max={} ms",
                total / count,
                self.health_probe_max_ms.load(Ordering::Relaxed)
            ));
        }
    }

    pub fn shutdown(&self, app: &AppHandle) -> Result<(), DesktopError> {
        let state = self.engine_state();
        if self.startup().phase == StartupPhase::Ready && state.phase != EnginePhase::Stopped {
            self.disconnect(app)?;
        }
        if let Err(error) = self.backend.shutdown() {
            let error = DesktopError::from(error);
            self.log(format!(
                "Engine cleanup failed during shutdown: {}",
                error.code
            ));
            return Err(error);
        }
        self.shutting_down.store(true, Ordering::Release);
        self.transition_engine(app, EnginePhase::Stopped, false, "Stopped");
        Ok(())
    }

    pub fn desktop_settings(&self) -> Result<DesktopSettings, DesktopError> {
        self.settings.get().map_err(DesktopError::from)
    }

    pub fn desktop_startup_status(&self) -> Result<DesktopStartupStatus, DesktopError> {
        let executable = current_executable()?;
        self.ready_backend()?
            .desktop_startup_status(&executable)
            .map_err(DesktopError::from)
    }

    pub fn update_desktop_settings(
        &self,
        settings: DesktopSettings,
    ) -> Result<DesktopSettings, DesktopError> {
        let previous = self.settings.get()?;
        let executable = current_executable()?;
        self.ready_backend()?
            .configure_desktop_startup(&executable, settings.run_at_windows_login)?;
        match self.settings.save(settings.clone()) {
            Ok(saved) => Ok(saved),
            Err(error) => {
                let _ = self
                    .backend
                    .configure_desktop_startup(&executable, previous.run_at_windows_login);
                Err(DesktopError::from(error))
            }
        }
    }

    pub fn combined_logs(&self, limit: usize) -> Result<EngineLogResult, DesktopError> {
        let mut lines: Vec<String> = self
            .logs
            .lock()
            .map(|logs| logs.iter().cloned().collect())
            .unwrap_or_default();
        if self.startup().phase == StartupPhase::Ready
            && let Ok(engine) = self.backend.logs(limit)
        {
            lines.extend(engine.lines);
        }
        let truncated = lines.len() > limit;
        if truncated {
            lines = lines.split_off(lines.len() - limit);
        }
        Ok(EngineLogResult {
            lines,
            truncated,
            source: "NetF desktop and compatibility engine".into(),
        })
    }

    pub fn log(&self, message: impl Into<String>) {
        if let Ok(mut logs) = self.logs.lock() {
            logs.push_back(format!("[NetF] {}", message.into()));
            while logs.len() > DESKTOP_LOG_LIMIT {
                logs.pop_front();
            }
        }
    }
}

pub fn spawn_health_monitor(app: AppHandle, controller: &Arc<DesktopController>) {
    let weak = Arc::downgrade(controller);
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let Some(controller) = weak.upgrade() else {
                break;
            };
            if controller.shutting_down.load(Ordering::Acquire) {
                break;
            }
            controller.poll_health(&app);
        }
    });
}

fn engine_phase(value: &str) -> EnginePhase {
    match value.to_ascii_lowercase().as_str() {
        "stopped" => EnginePhase::Stopped,
        "starting" => EnginePhase::Starting,
        "connected" => EnginePhase::Connected,
        "stopping" => EnginePhase::Stopping,
        "failed" => EnginePhase::Failed,
        _ => EnginePhase::Unknown,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis().try_into().unwrap_or(u64::MAX))
        .unwrap_or_default()
}

fn current_executable() -> Result<PathBuf, DesktopError> {
    let path = std::env::current_exe().map_err(|error| {
        DesktopError::new(
            "executable_path_failed",
            format!("Could not resolve the NetF executable: {error}"),
            true,
        )
    })?;
    path.canonicalize().map_err(|error| {
        DesktopError::new(
            "executable_path_failed",
            format!("Could not verify the NetF executable: {error}"),
            true,
        )
    })
}

fn resolve_owned_folder(
    runtime_root: &std::path::Path,
    folder: OwnedFolder,
) -> Result<PathBuf, DesktopError> {
    let app_data_candidate = runtime_root.parent().ok_or_else(|| {
        DesktopError::new(
            "open_folder_failed",
            "The NetF app-data folder was unavailable.",
            false,
        )
    })?;
    let target_candidate = match folder {
        OwnedFolder::Modes => runtime_root.join("mode").join("Custom"),
        OwnedFolder::AppData => app_data_candidate.to_path_buf(),
    };
    let boundary_candidate = match folder {
        OwnedFolder::Modes => runtime_root,
        OwnedFolder::AppData => app_data_candidate,
    };
    reject_reparse_chain(&target_candidate, boundary_candidate)?;

    let runtime = fs::canonicalize(runtime_root).map_err(|error| {
        DesktopError::new(
            "open_folder_failed",
            format!("Could not verify the NetF runtime folder: {error}"),
            true,
        )
    })?;
    let target = fs::canonicalize(&target_candidate).map_err(|error| {
        DesktopError::new(
            "open_folder_failed",
            format!("Could not verify the NetF folder: {error}"),
            true,
        )
    })?;

    let app_data = runtime.parent().ok_or_else(|| {
        DesktopError::new(
            "open_folder_failed",
            "The NetF app-data folder was unavailable.",
            false,
        )
    })?;
    if target != app_data && !target.starts_with(&runtime) {
        return Err(DesktopError::new(
            "open_folder_denied",
            "The requested folder is outside NetF-owned app data.",
            false,
        ));
    }
    Ok(target)
}

fn reject_reparse_chain(
    target: &std::path::Path,
    boundary: &std::path::Path,
) -> Result<(), DesktopError> {
    let mut current = target;
    loop {
        let metadata = fs::symlink_metadata(current).map_err(|error| {
            DesktopError::new(
                "open_folder_failed",
                format!("Could not inspect the NetF folder: {error}"),
                true,
            )
        })?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(DesktopError::new(
                "open_folder_denied",
                "The NetF folder contains a filesystem reparse point.",
                false,
            ));
        }
        if current == boundary {
            break;
        }
        current = current.parent().ok_or_else(|| {
            DesktopError::new(
                "open_folder_denied",
                "The NetF folder escaped its owned directory.",
                false,
            )
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn maps_unknown_engine_states_without_claiming_the_tunnel_is_stopped() {
        assert_eq!(engine_phase("connected"), EnginePhase::Connected);
        assert_eq!(engine_phase("unexpected"), EnginePhase::Unknown);
    }

    #[test]
    fn fixed_folder_resolver_exposes_only_modes_and_app_data() {
        let directory = tempdir().expect("temporary directory");
        let runtime = directory.path().join("runtime");
        fs::create_dir_all(runtime.join("mode/Custom")).expect("mode directory");

        assert_eq!(
            resolve_owned_folder(&runtime, OwnedFolder::Modes).unwrap(),
            fs::canonicalize(runtime.join("mode/Custom")).unwrap()
        );
        assert_eq!(
            resolve_owned_folder(&runtime, OwnedFolder::AppData).unwrap(),
            fs::canonicalize(directory.path()).unwrap()
        );
        assert!(serde_json::from_str::<OwnedFolder>(r#""arbitrary""#).is_err());
    }
}

use super::engine::{
    EngineAttachment, EngineError, EngineLogResult, EngineSettings, EngineSnapshot, EngineStatus,
    EngineSupervisor, LegacyImportResult, ModeDeleteResult, ModeDetail, ModeEditRequest,
    ModeMergeResult, ModeSaveResult,
};
use super::settings::DesktopStartupStatus;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

pub const SUPPORTED_ENGINE_API_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackendInfo {
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub api_version: u32,
    pub capabilities: Vec<String>,
    pub components: Vec<BackendComponent>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackendComponent {
    pub name: String,
    pub version: String,
}

pub trait EngineBackend: Send + Sync {
    fn attach(&self, runtime_root: &Path) -> Result<EngineAttachment, EngineError>;
    fn info(&self) -> Option<BackendInfo>;
    fn snapshot(&self) -> Result<EngineSnapshot, EngineError>;
    fn try_status(&self) -> Result<Option<EngineStatus>, EngineError>;
    fn connect(&self, server_id: usize, mode_id: usize) -> Result<EngineStatus, EngineError>;
    fn disconnect(&self) -> Result<EngineStatus, EngineError>;
    fn shutdown(&self) -> Result<(), EngineError>;
    fn import_legacy(&self, source_root: &Path) -> Result<LegacyImportResult, EngineError>;
    fn mode_detail(&self, mode_id: usize) -> Result<ModeDetail, EngineError>;
    fn save_mode(&self, request: ModeEditRequest) -> Result<ModeSaveResult, EngineError>;
    fn merge_modes(
        &self,
        source_mode_id: usize,
        target_mode_id: usize,
    ) -> Result<ModeMergeResult, EngineError>;
    fn delete_mode(&self, mode_id: usize) -> Result<ModeDeleteResult, EngineError>;
    fn logs(&self, limit: usize) -> Result<EngineLogResult, EngineError>;
    fn settings(&self) -> Result<EngineSettings, EngineError>;
    fn update_settings(&self, settings: EngineSettings) -> Result<EngineSettings, EngineError>;
    fn desktop_startup_status(
        &self,
        executable_path: &Path,
    ) -> Result<DesktopStartupStatus, EngineError>;
    fn configure_desktop_startup(
        &self,
        executable_path: &Path,
        enabled: bool,
    ) -> Result<DesktopStartupStatus, EngineError>;
}

#[derive(Default)]
pub struct NetchCompatibilityBackend {
    supervisor: EngineSupervisor,
    info: Mutex<Option<BackendInfo>>,
}

impl EngineBackend for NetchCompatibilityBackend {
    fn attach(&self, runtime_root: &Path) -> Result<EngineAttachment, EngineError> {
        let attachment = self.supervisor.attach(runtime_root)?;
        *self
            .info
            .lock()
            .map_err(|_| EngineError::Protocol("backend info lock was poisoned".into()))? =
            Some(attachment.info.clone());
        Ok(attachment)
    }

    fn info(&self) -> Option<BackendInfo> {
        self.info.lock().ok().and_then(|info| info.clone())
    }

    fn snapshot(&self) -> Result<EngineSnapshot, EngineError> {
        self.supervisor.snapshot()
    }

    fn try_status(&self) -> Result<Option<EngineStatus>, EngineError> {
        self.supervisor.try_status()
    }

    fn connect(&self, server_id: usize, mode_id: usize) -> Result<EngineStatus, EngineError> {
        self.supervisor.connect(server_id, mode_id)
    }

    fn disconnect(&self) -> Result<EngineStatus, EngineError> {
        self.supervisor.disconnect()
    }

    fn shutdown(&self) -> Result<(), EngineError> {
        self.supervisor.shutdown()
    }

    fn import_legacy(&self, source_root: &Path) -> Result<LegacyImportResult, EngineError> {
        self.supervisor.import_legacy(source_root)
    }

    fn mode_detail(&self, mode_id: usize) -> Result<ModeDetail, EngineError> {
        self.supervisor.mode_detail(mode_id)
    }

    fn save_mode(&self, request: ModeEditRequest) -> Result<ModeSaveResult, EngineError> {
        self.supervisor.save_mode(request)
    }

    fn merge_modes(
        &self,
        source_mode_id: usize,
        target_mode_id: usize,
    ) -> Result<ModeMergeResult, EngineError> {
        self.supervisor.merge_modes(source_mode_id, target_mode_id)
    }

    fn delete_mode(&self, mode_id: usize) -> Result<ModeDeleteResult, EngineError> {
        self.supervisor.delete_mode(mode_id)
    }

    fn logs(&self, limit: usize) -> Result<EngineLogResult, EngineError> {
        self.supervisor.logs(limit)
    }

    fn settings(&self) -> Result<EngineSettings, EngineError> {
        self.supervisor.settings()
    }

    fn update_settings(&self, settings: EngineSettings) -> Result<EngineSettings, EngineError> {
        self.supervisor.update_settings(settings)
    }

    fn desktop_startup_status(
        &self,
        executable_path: &Path,
    ) -> Result<DesktopStartupStatus, EngineError> {
        self.supervisor.desktop_startup_status(executable_path)
    }

    fn configure_desktop_startup(
        &self,
        executable_path: &Path,
        enabled: bool,
    ) -> Result<DesktopStartupStatus, EngineError> {
        self.supervisor
            .configure_desktop_startup(executable_path, enabled)
    }
}

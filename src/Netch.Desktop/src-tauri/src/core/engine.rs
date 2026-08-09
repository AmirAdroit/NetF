use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use thiserror::Error;

use super::backend::{BackendComponent, BackendInfo, SUPPORTED_ENGINE_API_VERSION};
use super::settings::DesktopStartupStatus;

const MAXIMUM_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAXIMUM_STALE_RESPONSES: usize = 64;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub state: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSummary {
    pub id: usize,
    #[serde(rename = "type")]
    pub server_type: String,
    pub remark: String,
    pub group: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeSummary {
    pub id: usize,
    #[serde(rename = "type")]
    pub mode_type: String,
    pub remark: String,
    pub source: String,
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub editable_in_place: bool,
    #[serde(default)]
    pub handle_count: usize,
    #[serde(default)]
    pub bypass_count: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeDetail {
    pub id: usize,
    #[serde(rename = "type")]
    pub mode_type: String,
    pub remark: String,
    pub source: String,
    pub origin: String,
    pub editable_in_place: bool,
    pub handle: Vec<String>,
    pub bypass: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeEditRequest {
    pub mode_id: Option<usize>,
    #[serde(rename = "type")]
    pub mode_type: String,
    pub remark: String,
    pub handle: Vec<String>,
    pub bypass: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeSaveResult {
    pub mode: ModeDetail,
    pub created_copy: bool,
    pub snapshot: EngineSnapshot,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeMergeResult {
    pub mode: ModeDetail,
    pub added_handle_rules: usize,
    pub added_bypass_rules: usize,
    pub created_copy: bool,
    pub snapshot: EngineSnapshot,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineLogResult {
    pub lines: Vec<String>,
    pub truncated: bool,
    pub source: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineSettings {
    pub local_address: String,
    pub socks5_local_port: u16,
    pub http_local_port: u16,
    pub request_timeout: i32,
    pub server_tcp_ping: bool,
    pub filter_tcp: bool,
    pub filter_udp: bool,
    pub filter_dns: bool,
    pub handle_only_dns: bool,
    pub dns_proxy: bool,
    pub dns_host: String,
    pub filter_icmp: bool,
    pub icmp_delay: i32,
    pub allow_insecure: bool,
    pub use_mux: bool,
    pub xray_cone: bool,
    pub tcp_fast_open: bool,
}

#[derive(Debug, Clone)]
pub struct EngineAttachment {
    pub info: BackendInfo,
    pub snapshot: EngineSnapshot,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineSnapshot {
    pub api_version: u32,
    pub status: EngineStatus,
    pub servers: Vec<ServerSummary>,
    pub modes: Vec<ModeSummary>,
    pub missing_helpers: Vec<String>,
    #[serde(default)]
    pub capabilities: Vec<RuntimeCapability>,
    #[serde(default)]
    pub core_source: String,
    #[serde(default)]
    pub proxy_cores: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapability {
    pub name: String,
    pub available: bool,
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportResult {
    pub imported_custom_modes: usize,
    pub backup_directory: String,
    pub snapshot: EngineSnapshot,
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("The selected directory is not a Netch runtime: {0}")]
    InvalidRuntime(String),
    #[error("The Netch engine host is not prepared: {0}")]
    HostUnavailable(String),
    #[error("Could not start the Netch engine host: {0}")]
    Start(String),
    #[error("The Netch engine host stopped unexpectedly{0}")]
    Stopped(String),
    #[error("The Netch engine protocol failed: {0}")]
    Protocol(String),
    #[error("The Netch engine rejected the request: {code}: {message}")]
    Rejected { code: String, message: String },
    #[error("Attach a Netch runtime before using the engine.")]
    NotAttached,
    #[error("Disconnect the active profile before changing the attached runtime.")]
    ActiveRuntime,
}

#[derive(Default)]
pub struct EngineSupervisor {
    process: Mutex<Option<EngineProcess>>,
}

impl EngineSupervisor {
    pub fn attach(&self, runtime_root: impl AsRef<Path>) -> Result<EngineAttachment, EngineError> {
        let runtime_root = validate_runtime(runtime_root.as_ref())?;
        let host_path = locate_engine_host()?;

        let mut current = self
            .process
            .lock()
            .map_err(|_| EngineError::Protocol("engine supervisor lock was poisoned".into()))?;
        if let Some(previous) = current.as_mut() {
            match previous.request::<EngineStatus>("status", json!({})) {
                Ok(status) if status.state != "stopped" && status.state != "failed" => {
                    return Err(EngineError::ActiveRuntime);
                }
                Ok(_) | Err(EngineError::Stopped(_)) | Err(EngineError::Protocol(_)) => {}
                Err(error) => return Err(error),
            }
        }

        if let Some(mut previous) = current.take() {
            previous.shutdown();
        }

        let mut process = EngineProcess::start(&host_path, &runtime_root)?;
        let hello: HelloResponse = process.request("hello", json!({}))?;
        if hello.api_version != SUPPORTED_ENGINE_API_VERSION {
            return Err(EngineError::Protocol(format!(
                "unsupported engine API version {}; NetF supports version {}",
                hello.api_version, SUPPORTED_ENGINE_API_VERSION
            )));
        }
        for capability in ["snapshot", "status", "connect", "disconnect", "shutdown"] {
            if !hello.supports.iter().any(|item| item == capability) {
                return Err(EngineError::Protocol(format!(
                    "engine handshake omitted required capability {capability}"
                )));
            }
        }
        let snapshot = process.request("snapshot", json!({}))?;

        let info = BackendInfo {
            id: hello.backend_id,
            display_name: hello.display_name,
            version: hello.backend_version,
            api_version: hello.api_version,
            capabilities: hello.supports,
            components: hello.components,
        };

        *current = Some(process);
        Ok(EngineAttachment { info, snapshot })
    }

    pub fn try_status(&self) -> Result<Option<EngineStatus>, EngineError> {
        let Ok(mut current) = self.process.try_lock() else {
            return Ok(None);
        };
        current
            .as_mut()
            .ok_or(EngineError::NotAttached)
            .and_then(|process| process.request("status", json!({})))
            .map(Some)
    }

    pub fn snapshot(&self) -> Result<EngineSnapshot, EngineError> {
        self.with_process(|process| process.request("snapshot", json!({})))
    }

    pub fn connect(&self, server_id: usize, mode_id: usize) -> Result<EngineStatus, EngineError> {
        self.with_process(|process| {
            process.request(
                "connect",
                json!({ "serverId": server_id, "modeId": mode_id }),
            )
        })
    }

    pub fn disconnect(&self) -> Result<EngineStatus, EngineError> {
        self.with_process(|process| process.request("disconnect", json!({})))
    }

    pub fn import_legacy(
        &self,
        source_root: impl AsRef<Path>,
    ) -> Result<LegacyImportResult, EngineError> {
        let source_root = fs::canonicalize(source_root.as_ref())
            .map_err(|error| EngineError::InvalidRuntime(error.to_string()))?;
        self.with_process(|process| {
            let status: EngineStatus = process.request("status", json!({}))?;
            if status.state != "stopped" && status.state != "failed" {
                return Err(EngineError::ActiveRuntime);
            }
            process.request(
                "importLegacy",
                json!({ "sourceRoot": source_root.display().to_string() }),
            )
        })
    }

    pub fn mode_detail(&self, mode_id: usize) -> Result<ModeDetail, EngineError> {
        self.with_process(|process| process.request("modeDetail", json!({ "modeId": mode_id })))
    }

    pub fn save_mode(&self, request: ModeEditRequest) -> Result<ModeSaveResult, EngineError> {
        let value = serde_json::to_value(request)
            .map_err(|error| EngineError::Protocol(error.to_string()))?;
        self.with_process(|process| process.request("saveMode", value))
    }

    pub fn merge_modes(
        &self,
        source_mode_id: usize,
        target_mode_id: usize,
    ) -> Result<ModeMergeResult, EngineError> {
        self.with_process(|process| {
            process.request(
                "mergeMode",
                json!({ "sourceModeId": source_mode_id, "targetModeId": target_mode_id }),
            )
        })
    }

    pub fn logs(&self, limit: usize) -> Result<EngineLogResult, EngineError> {
        self.with_process(|process| process.request("logs", json!({ "limit": limit })))
    }

    pub fn settings(&self) -> Result<EngineSettings, EngineError> {
        self.with_process(|process| process.request("settings", json!({})))
    }

    pub fn update_settings(&self, settings: EngineSettings) -> Result<EngineSettings, EngineError> {
        let value = serde_json::to_value(settings)
            .map_err(|error| EngineError::Protocol(error.to_string()))?;
        self.with_process(|process| process.request("updateSettings", value))
    }

    pub fn desktop_startup_status(
        &self,
        executable_path: &Path,
    ) -> Result<DesktopStartupStatus, EngineError> {
        self.with_process(|process| {
            process.request(
                "desktopStartupStatus",
                json!({ "executablePath": executable_path.display().to_string() }),
            )
        })
    }

    pub fn configure_desktop_startup(
        &self,
        executable_path: &Path,
        enabled: bool,
    ) -> Result<DesktopStartupStatus, EngineError> {
        self.with_process(|process| {
            process.request(
                "configureDesktopStartup",
                json!({
                    "executablePath": executable_path.display().to_string(),
                    "enabled": enabled
                }),
            )
        })
    }

    pub fn shutdown(&self) -> Result<(), EngineError> {
        let mut current = self
            .process
            .lock()
            .map_err(|_| EngineError::Protocol("engine supervisor lock was poisoned".into()))?;
        if let Some(mut process) = current.take() {
            process.shutdown();
        }
        Ok(())
    }

    fn with_process<T>(
        &self,
        action: impl FnOnce(&mut EngineProcess) -> Result<T, EngineError>,
    ) -> Result<T, EngineError> {
        let mut current = self
            .process
            .lock()
            .map_err(|_| EngineError::Protocol("engine supervisor lock was poisoned".into()))?;
        action(current.as_mut().ok_or(EngineError::NotAttached)?)
    }
}

impl Drop for EngineSupervisor {
    fn drop(&mut self) {
        if let Ok(process) = self.process.get_mut()
            && let Some(mut process) = process.take()
        {
            process.shutdown();
        }
    }
}

struct EngineProcess {
    child: Child,
    stdin: ChildStdin,
    responses: Receiver<ProtocolEvent>,
    stderr: Arc<Mutex<String>>,
    next_id: u64,
}

enum ProtocolEvent {
    Response(WireResponse),
    Closed,
    Failed(String),
}

impl EngineProcess {
    fn start(host_path: &Path, runtime_root: &Path) -> Result<Self, EngineError> {
        let mut child = Command::new(host_path)
            .arg("--runtime-root")
            .arg(runtime_root)
            .arg("--runtime-kind")
            .arg("owned-runtime")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| EngineError::Start(error.to_string()))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| EngineError::Start("stdin pipe was unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| EngineError::Start("stdout pipe was unavailable".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| EngineError::Start("stderr pipe was unavailable".into()))?;
        let stderr_text = Arc::new(Mutex::new(String::new()));
        let stderr_target = Arc::clone(&stderr_text);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut buffer = String::new();
            if reader.read_to_string(&mut buffer).is_ok()
                && let Ok(mut target) = stderr_target.lock()
            {
                *target = buffer.chars().take(4096).collect();
            }
        });
        let responses = spawn_protocol_reader(stdout);

        Ok(Self {
            child,
            stdin,
            responses,
            stderr: stderr_text,
            next_id: 1,
        })
    }

    fn request<T: DeserializeOwned>(
        &mut self,
        method: &str,
        parameters: Value,
    ) -> Result<T, EngineError> {
        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        let request = json!({ "id": id, "method": method, "parameters": parameters });
        serde_json::to_writer(&mut self.stdin, &request)
            .map_err(|error| EngineError::Protocol(error.to_string()))?;
        self.stdin
            .write_all(b"\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| EngineError::Stopped(format!(": {error}")))?;

        let timeout = request_timeout(method);
        let deadline = Instant::now() + timeout;
        let mut stale_responses = 0;
        let response = loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(EngineError::Protocol(format!(
                    "engine did not respond to {method} within {} seconds",
                    timeout.as_secs()
                )));
            }

            match self.responses.recv_timeout(remaining) {
                Ok(ProtocolEvent::Response(response)) if response.id == id => break response,
                Ok(ProtocolEvent::Response(_)) => {
                    stale_responses += 1;
                    if stale_responses > MAXIMUM_STALE_RESPONSES {
                        return Err(EngineError::Protocol(
                            "engine produced too many stale protocol responses".into(),
                        ));
                    }
                }
                Ok(ProtocolEvent::Closed) => return Err(self.stopped_error("")),
                Ok(ProtocolEvent::Failed(error)) => {
                    return Err(EngineError::Protocol(format!(
                        "engine response stream failed: {error}"
                    )));
                }
                Err(RecvTimeoutError::Timeout) => {
                    return Err(EngineError::Protocol(format!(
                        "engine did not respond to {method} within {} seconds",
                        timeout.as_secs()
                    )));
                }
                Err(RecvTimeoutError::Disconnected) => return Err(self.stopped_error("")),
            }
        };
        if !response.ok {
            let error = response.error.unwrap_or(WireError {
                code: "unknown".into(),
                message: "The engine returned an unspecified error.".into(),
            });
            return Err(EngineError::Rejected {
                code: error.code,
                message: error.message,
            });
        }

        serde_json::from_value(
            response
                .result
                .ok_or_else(|| EngineError::Protocol("response result was missing".into()))?,
        )
        .map_err(|error| EngineError::Protocol(format!("invalid response shape: {error}")))
    }

    fn stopped_error(&self, prefix: &str) -> EngineError {
        let diagnostic = self
            .stderr
            .lock()
            .map(|value| value.trim().to_owned())
            .unwrap_or_default();
        let suffix = if diagnostic.is_empty() {
            prefix.to_owned()
        } else {
            format!("{prefix}: {diagnostic}")
        };
        EngineError::Stopped(suffix)
    }

    fn shutdown(&mut self) {
        if self.child.try_wait().ok().flatten().is_some() {
            return;
        }
        let _: Result<EngineStatus, _> = self.request("shutdown", json!({}));
        for _ in 0..300 {
            if self.child.try_wait().ok().flatten().is_some() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn spawn_protocol_reader(stdout: ChildStdout) -> Receiver<ProtocolEvent> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            let read = reader
                .by_ref()
                .take(MAXIMUM_RESPONSE_BYTES as u64 + 1)
                .read_line(&mut line);
            match read {
                Ok(0) => {
                    let _ = sender.send(ProtocolEvent::Closed);
                    break;
                }
                Ok(bytes) if bytes > MAXIMUM_RESPONSE_BYTES => {
                    let _ = sender.send(ProtocolEvent::Failed(
                        "engine response exceeded 4 MiB".into(),
                    ));
                    break;
                }
                Ok(_) => {
                    // Native legacy DLLs and helper processes can write status text to the
                    // inherited stdout handle. Only complete, typed protocol envelopes are
                    // forwarded; all other lines are intentionally discarded.
                    if let Some(response) = parse_protocol_line(&line)
                        && sender.send(ProtocolEvent::Response(response)).is_err()
                    {
                        break;
                    }
                }
                Err(error) => {
                    let _ = sender.send(ProtocolEvent::Failed(error.to_string()));
                    break;
                }
            }
        }
    });
    receiver
}

fn parse_protocol_line(line: &str) -> Option<WireResponse> {
    serde_json::from_str(line).ok()
}

fn request_timeout(method: &str) -> Duration {
    match method {
        "connect" | "importLegacy" => Duration::from_secs(60),
        "saveMode" | "mergeMode" | "updateSettings" | "configureDesktopStartup" => {
            Duration::from_secs(30)
        }
        "disconnect" | "shutdown" => Duration::from_secs(30),
        _ => Duration::from_secs(10),
    }
}

impl Drop for EngineProcess {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelloResponse {
    api_version: u32,
    backend_id: String,
    display_name: String,
    backend_version: String,
    supports: Vec<String>,
    #[serde(default)]
    components: Vec<BackendComponent>,
}

#[derive(Debug, Deserialize)]
struct WireResponse {
    id: u64,
    ok: bool,
    result: Option<Value>,
    error: Option<WireError>,
}

#[derive(Debug, Deserialize)]
struct WireError {
    code: String,
    message: String,
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(not(windows))]
const CREATE_NO_WINDOW: u32 = 0;

fn validate_runtime(path: &Path) -> Result<PathBuf, EngineError> {
    let root =
        fs::canonicalize(path).map_err(|error| EngineError::InvalidRuntime(error.to_string()))?;
    for relative in ["data/settings.json", "mode", "bin"] {
        let candidate = root.join(relative);
        if !candidate.exists() {
            return Err(EngineError::InvalidRuntime(format!(
                "{} is missing",
                candidate.display()
            )));
        }
    }
    if !root.join("data/settings.json").is_file()
        || !root.join("mode").is_dir()
        || !root.join("bin").is_dir()
    {
        return Err(EngineError::InvalidRuntime(
            "settings.json, mode, and bin have unexpected file types".into(),
        ));
    }
    Ok(root)
}

fn locate_engine_host() -> Result<PathBuf, EngineError> {
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("NETCH_ENGINE_HOST_PATH") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }

    let beside_app = std::env::current_exe().ok().and_then(|path| {
        path.parent()
            .map(|parent| parent.join("netch-engine-host.exe"))
    });
    let development = std::env::current_dir()
        .ok()
        .map(|path| path.join("src-tauri/binaries/netch-engine-host.exe"));
    let cargo_development = std::env::current_dir()
        .ok()
        .map(|path| path.join("binaries/netch-engine-host.exe"));

    beside_app
        .into_iter()
        .chain(development)
        .chain(cargo_development)
        .find(|path| path.is_file())
        .ok_or_else(|| EngineError::HostUnavailable("run npm run prepare:engine".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn runtime_validation_requires_only_the_read_only_attachment_shape() {
        let directory = tempdir().expect("temporary directory");
        fs::create_dir_all(directory.path().join("data")).expect("data directory");
        fs::create_dir_all(directory.path().join("mode")).expect("mode directory");
        fs::create_dir_all(directory.path().join("bin")).expect("bin directory");
        fs::write(directory.path().join("data/settings.json"), "{}").expect("settings fixture");

        let validated = validate_runtime(directory.path()).expect("valid runtime");
        assert_eq!(validated, fs::canonicalize(directory.path()).unwrap());
    }

    #[test]
    fn runtime_validation_rejects_an_arbitrary_directory() {
        let directory = tempdir().expect("temporary directory");
        assert!(matches!(
            validate_runtime(directory.path()),
            Err(EngineError::InvalidRuntime(_))
        ));
    }

    #[test]
    #[cfg(windows)]
    fn supervisor_completes_a_real_host_handshake_and_snapshot() {
        let directory = tempdir().expect("temporary directory");
        fs::create_dir_all(directory.path().join("data")).expect("data directory");
        fs::create_dir_all(directory.path().join("mode")).expect("mode directory");
        fs::create_dir_all(directory.path().join("bin")).expect("bin directory");
        fs::write(directory.path().join("data/settings.json"), "{}").expect("settings fixture");

        let supervisor = EngineSupervisor::default();
        let attachment = supervisor
            .attach(directory.path())
            .expect("engine snapshot");
        let snapshot = attachment.snapshot;

        assert_eq!(attachment.info.id, "netch-compat");
        assert_eq!(attachment.info.api_version, 1);
        assert_eq!(snapshot.api_version, 1);
        assert_eq!(snapshot.status.state, "stopped");
        assert!(snapshot.servers.is_empty());
        assert!(snapshot.modes.is_empty());
        assert_eq!(snapshot.core_source, "owned-runtime");
        assert_eq!(snapshot.proxy_cores, ["direct SOCKS"]);
        assert!(
            snapshot
                .capabilities
                .iter()
                .any(|capability| capability.name == "Process routing")
        );
    }

    #[test]
    #[cfg(windows)]
    fn supervisor_can_reattach_after_the_host_crashes() {
        let directory = tempdir().expect("temporary directory");
        fs::create_dir_all(directory.path().join("data")).expect("data directory");
        fs::create_dir_all(directory.path().join("mode")).expect("mode directory");
        fs::create_dir_all(directory.path().join("bin")).expect("bin directory");
        fs::write(directory.path().join("data/settings.json"), "{}").expect("settings fixture");

        let supervisor = EngineSupervisor::default();
        supervisor
            .attach(directory.path())
            .expect("first attachment");
        {
            let mut process = supervisor.process.lock().unwrap();
            let process = process.as_mut().expect("running host");
            process.child.kill().expect("kill host");
            process.child.wait().expect("wait for host");
        }

        let recovered = supervisor
            .attach(directory.path())
            .expect("recovered attachment");
        assert_eq!(recovered.snapshot.status.state, "stopped");
        assert_eq!(recovered.info.id, "netch-compat");
    }

    #[test]
    fn native_stdout_noise_is_not_treated_as_a_protocol_response() {
        assert!(parse_protocol_line("[Redirector] started\n").is_none());

        let response = parse_protocol_line(
            r#"{"id":7,"ok":true,"result":{"state":"connected"},"error":null}"#,
        )
        .expect("valid protocol response");
        assert_eq!(response.id, 7);
    }

    #[test]
    #[cfg(windows)]
    fn owned_engine_imports_only_legacy_configuration_and_custom_modes() {
        let owned = tempdir().expect("owned runtime");
        fs::create_dir_all(owned.path().join("data")).unwrap();
        fs::create_dir_all(owned.path().join("mode/Custom")).unwrap();
        fs::create_dir_all(owned.path().join("bin")).unwrap();
        fs::write(owned.path().join("data/settings.json"), "{}").unwrap();

        let legacy = tempdir().expect("legacy import source");
        fs::create_dir_all(legacy.path().join("data")).unwrap();
        fs::create_dir_all(legacy.path().join("mode/Custom")).unwrap();
        fs::write(legacy.path().join("data/settings.json"), "{}").unwrap();
        fs::write(
            legacy.path().join("mode/Custom/Imported.json"),
            r#"{
              "type": "ProcessMode",
              "remark": { "en-US": "Imported game" },
              "handle": ["game\\.exe"],
              "bypass": []
            }"#,
        )
        .unwrap();
        fs::create_dir_all(legacy.path().join("bin")).unwrap();
        fs::write(legacy.path().join("bin/untrusted.exe"), "must not copy").unwrap();

        let supervisor = EngineSupervisor::default();
        supervisor.attach(owned.path()).expect("owned engine");
        let imported = supervisor
            .import_legacy(legacy.path())
            .expect("validated import");

        assert_eq!(imported.imported_custom_modes, 1);
        assert_eq!(imported.snapshot.modes.len(), 1);
        assert!(owned.path().join("data/settings.json.bak").is_file());
        assert!(
            owned
                .path()
                .join("mode/Custom/Imported/Imported.json")
                .is_file()
        );
        assert!(!owned.path().join("bin/untrusted.exe").exists());
        assert_eq!(imported.snapshot.modes[0].origin, "imported");
    }

    #[test]
    #[cfg(windows)]
    fn built_in_mode_merge_creates_an_atomic_user_owned_copy() {
        let owned = tempdir().expect("owned runtime");
        fs::create_dir_all(owned.path().join("data")).unwrap();
        fs::create_dir_all(owned.path().join("mode")).unwrap();
        fs::create_dir_all(owned.path().join("bin")).unwrap();
        fs::write(owned.path().join("data/settings.json"), "{}").unwrap();
        fs::write(
            owned.path().join("mode/Alpha.json"),
            r#"{
              "type": "ProcessMode",
              "remark": { "en": "Alpha" },
              "handle": ["alpha\\.exe", "common\\.exe"],
              "bypass": []
            }"#,
        )
        .unwrap();
        fs::write(
            owned.path().join("mode/Beta.json"),
            r#"{
              "type": "ProcessMode",
              "remark": { "en": "Beta" },
              "handle": ["common\\.exe"],
              "bypass": []
            }"#,
        )
        .unwrap();

        let supervisor = EngineSupervisor::default();
        let snapshot = supervisor
            .attach(owned.path())
            .expect("owned engine")
            .snapshot;
        let source_id = snapshot
            .modes
            .iter()
            .find(|mode_| mode_.remark == "Alpha")
            .unwrap()
            .id;
        let target_id = snapshot
            .modes
            .iter()
            .find(|mode_| mode_.remark == "Beta")
            .unwrap()
            .id;

        let merged = supervisor
            .merge_modes(source_id, target_id)
            .expect("mode merge");

        assert!(merged.created_copy);
        assert_eq!(merged.added_handle_rules, 1);
        assert_eq!(merged.mode.origin, "user");
        assert_eq!(merged.mode.handle.len(), 2);
        assert!(owned.path().join("mode/Custom/User/Beta.json").is_file());
    }
}

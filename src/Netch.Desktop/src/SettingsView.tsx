import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingsIcon } from "./icons";
import type { EngineSettings, EngineSnapshot } from "./engine";
import { errorMessage, type DesktopSettings, type DesktopStartupStatus } from "./desktop";

interface SettingsViewProps {
  snapshot: EngineSnapshot | null;
  active: boolean;
}

export function SettingsView({ snapshot, active }: SettingsViewProps) {
  const [settings, setSettings] = useState<EngineSettings | null>(null);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings | null>(null);
  const [startupStatus, setStartupStatus] = useState<DesktopStartupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const locked = snapshot?.status.state !== "stopped" && snapshot?.status.state !== "failed";

  useEffect(() => {
    if (!active || !snapshot) return;
    let cancelled = false;
    setBusy(true);
    Promise.all([
      invoke<EngineSettings>("engine_settings"),
      invoke<DesktopSettings>("desktop_settings"),
      invoke<DesktopStartupStatus>("desktop_autostart_status"),
    ])
      .then(([engine, desktop, startup]) => {
        if (cancelled) return;
        setSettings(engine);
        setDesktopSettings(desktop);
        setStartupStatus(startup);
      })
      .catch((loadError) => !cancelled && setError(errorMessage(loadError)))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [active, snapshot?.apiVersion]);

  function update<K extends keyof EngineSettings>(key: K, value: EngineSettings[K]) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
    setMessage("");
  }

  async function save() {
    if (!settings || busy || locked) return;
    try {
      setBusy(true);
      setError("");
      setMessage("");
      setSettings(await invoke<EngineSettings>("update_engine_settings", { settings }));
      setMessage("Settings saved atomically. The previous settings file is available as rollback backup.");
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function setRunAtWindowsLogin(enabled: boolean) {
    if (!desktopSettings || busy) return;
    const previous = desktopSettings;
    const next = { ...desktopSettings, runAtWindowsLogin: enabled };
    setDesktopSettings(next);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await invoke<DesktopSettings>("update_desktop_settings", { settings: next });
      setDesktopSettings(saved);
      setStartupStatus(await invoke<DesktopStartupStatus>("desktop_autostart_status"));
      setMessage(enabled
        ? "Windows auto-start is registered and verified. NetF will start in the tray without connecting."
        : "Windows auto-start was removed.");
    } catch (saveError) {
      setDesktopSettings(previous);
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function openAppDataFolder() {
    try {
      setError("");
      await invoke("open_owned_folder", { folder: "appData" });
    } catch (openError) {
      setError(errorMessage(openError));
    }
  }

  if (!settings) {
    return <section className="panel settings-loading"><SettingsIcon /><h2>{busy ? "Loading settings…" : "Settings unavailable"}</h2>{error && <div className="error-banner">{error}</div>}</section>;
  }

  return (
    <div className="settings-view">
      <section className="hero-card">
        <div className="hero-copy"><span className="feature-icon"><SettingsIcon /></span><div><h2>Engine and routing settings</h2><p>Changes are validated, written to a temporary file, re-read, backed up, and atomically replaced.</p></div></div>
        <div className="hero-meta"><span>{locked ? "Disconnect to edit" : "Ready to edit"}</span><span>Rollback backup</span></div>
      </section>

      <div className="settings-grid">
        <section className="panel settings-section desktop-settings-section">
          <div className="panel-heading compact"><div><span className="step-label">Desktop lifecycle</span><h2>Windows sign-in</h2></div></div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={desktopSettings?.runAtWindowsLogin ?? false}
              disabled={busy || !desktopSettings}
              onChange={(event) => void setRunAtWindowsLogin(event.target.checked)}
            />
            <span><strong>Start NetF when Windows starts</strong><small>Uses a verified per-user Scheduled Task with highest privileges. Starts quietly in the tray and never connects automatically.</small></span>
          </label>
          <div className={`startup-registration ${startupStatus?.enabled && startupStatus.matchesCurrentExecutable ? "verified" : "inactive"}`}>
            <span />
            {startupStatus?.enabled
              ? startupStatus.matchesCurrentExecutable ? "Scheduled Task verified" : "Scheduled Task needs repair"
              : "Disabled"}
          </div>
          <button className="secondary-action settings-folder-action" onClick={openAppDataFolder} type="button">Open app data folder</button>
        </section>

        <section className="panel settings-section">
          <div className="panel-heading compact"><div><span className="step-label">Local proxy</span><h2>Listener and health checks</h2></div></div>
          <div className="settings-fields">
            <label>Bind address<input value={settings.localAddress} onChange={(event) => update("localAddress", event.target.value)} /></label>
            <label>SOCKS5 port<input type="number" min={1} max={65535} value={settings.socks5LocalPort} onChange={(event) => update("socks5LocalPort", Number(event.target.value))} /></label>
            <label>HTTP port<input type="number" min={1} max={65535} value={settings.httpLocalPort} onChange={(event) => update("httpLocalPort", Number(event.target.value))} /></label>
            <label>Request timeout (ms)<input type="number" min={1000} max={120000} step={500} value={settings.requestTimeout} onChange={(event) => update("requestTimeout", Number(event.target.value))} /></label>
          </div>
          <label className="toggle-row"><input type="checkbox" checked={settings.serverTcpPing} onChange={(event) => update("serverTcpPing", event.target.checked)} /><span><strong>Use TCP for server checks</strong><small>More representative than ICMP when providers filter ping.</small></span></label>
        </section>

        <section className="panel settings-section">
          <div className="panel-heading compact"><div><span className="step-label">Process routing</span><h2>Redirector defaults</h2></div></div>
          <div className="toggle-grid">
            {([
              ["filterTcp", "Filter TCP"],
              ["filterUdp", "Filter UDP"],
              ["filterDns", "Filter DNS"],
              ["handleOnlyDns", "Handle only matched DNS"],
              ["dnsProxy", "Proxy DNS"],
              ["filterIcmp", "Filter ICMP"],
            ] as const).map(([key, label]) => (
              <label className="toggle-row" key={key}><input type="checkbox" checked={settings[key]} onChange={(event) => update(key, event.target.checked)} /><span><strong>{label}</strong></span></label>
            ))}
          </div>
          <div className="settings-fields">
            <label>DNS endpoint<input value={settings.dnsHost} onChange={(event) => update("dnsHost", event.target.value)} placeholder="1.1.1.1:53" /></label>
            <label>ICMP delay (ms)<input type="number" min={0} max={10000} value={settings.icmpDelay} onChange={(event) => update("icmpDelay", Number(event.target.value))} /></label>
          </div>
        </section>

        <section className="panel settings-section">
          <div className="panel-heading compact"><div><span className="step-label">Xray</span><h2>Core behavior</h2></div></div>
          <div className="toggle-grid">
            <label className="toggle-row warning-toggle"><input type="checkbox" checked={settings.allowInsecure} onChange={(event) => update("allowInsecure", event.target.checked)} /><span><strong>Allow insecure TLS</strong><small>Disables certificate verification. Leave off unless a specific trusted profile requires it.</small></span></label>
            <label className="toggle-row"><input type="checkbox" checked={settings.useMux} onChange={(event) => update("useMux", event.target.checked)} /><span><strong>Connection multiplexing</strong></span></label>
            <label className="toggle-row"><input type="checkbox" checked={settings.xrayCone} onChange={(event) => update("xrayCone", event.target.checked)} /><span><strong>Xray cone behavior</strong></span></label>
            <label className="toggle-row"><input type="checkbox" checked={settings.tcpFastOpen} onChange={(event) => update("tcpFastOpen", event.target.checked)} /><span><strong>TCP Fast Open</strong></span></label>
          </div>
        </section>
      </div>

      <div className="settings-savebar">
        <div>{error && <div className="error-banner" role="alert">{error}</div>}{message && <div className="success-banner" role="status">{message}</div>}</div>
        <button className="primary-action" disabled={busy || locked} onClick={save} type="button">{busy ? "Saving…" : "Save settings"}</button>
      </div>
    </div>
  );
}

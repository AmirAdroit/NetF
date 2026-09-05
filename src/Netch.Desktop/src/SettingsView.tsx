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

  async function setCloseBehavior(closeBehavior: DesktopSettings["closeBehavior"]) {
    if (!desktopSettings || busy) return;
    const previous = desktopSettings;
    const next = { ...desktopSettings, closeBehavior };
    setDesktopSettings(next);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await invoke<DesktopSettings>("update_desktop_settings", { settings: next });
      setDesktopSettings(saved);
      setMessage(closeBehavior === "exit"
        ? "Closing the window will now disconnect safely, restore networking, and exit."
        : "Closing the window will now keep NetF running in the notification area.");
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
          <fieldset className="close-behavior" disabled={busy || !desktopSettings}>
            <legend>When the window is closed</legend>
            <label><input type="radio" name="close-behavior" checked={desktopSettings?.closeBehavior === "hideToTray"} onChange={() => void setCloseBehavior("hideToTray")} /><span><strong>Hide to tray</strong><small>Keep NetF and any active tunnel running.</small></span></label>
            <label><input type="radio" name="close-behavior" checked={desktopSettings?.closeBehavior === "exit"} onChange={() => void setCloseBehavior("exit")} /><span><strong>Disconnect and exit</strong><small>Uses the same cleanup path as Exit in the tray menu. NetF stays open if cleanup fails.</small></span></label>
          </fieldset>
          <div className={`startup-registration ${startupStatus?.enabled && startupStatus.matchesCurrentExecutable ? "verified" : "inactive"}`}>
            <span />
            {startupStatus?.enabled
              ? startupStatus.matchesCurrentExecutable ? "Scheduled Task verified" : "Scheduled Task needs repair"
              : "Disabled"}
          </div>
          {startupStatus?.enabled && !startupStatus.matchesCurrentExecutable && (
            <div className="startup-repair-actions">
              <p>{startupStatus.message ?? "The existing task points to a different installation."}</p>
              <button className="primary-action" disabled={busy} onClick={() => void setRunAtWindowsLogin(true)} type="button">Repair for this installation</button>
              <button className="danger-action" disabled={busy} onClick={() => void setRunAtWindowsLogin(false)} type="button">Remove</button>
            </div>
          )}
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
          <div className="settings-fields latency-settings">
            <label>Connected-server live test (seconds)<input type="number" min={-1} max={3600} value={settings.liveLatencyIntervalSeconds} onChange={(event) => update("liveLatencyIntervalSeconds", Number(event.target.value))} /><small>Use -1 or 0 to disable. Enabled range: 1–3600. Tests DNS and endpoint reachability, not proxy authentication.</small></label>
          </div>
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
              ["filterParent", "Handle child processes"],
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

        <section className="panel settings-section tun-settings-section">
          <div className="panel-heading compact"><div><span className="step-label">TUN routing</span><h2>Adapter and DNS</h2></div></div>
          <div className="settings-fields settings-fields-three">
            <label>Adapter IPv4 address<input value={settings.tunAddress} onChange={(event) => update("tunAddress", event.target.value)} placeholder="10.0.0.2" /></label>
            <label>Netmask<input value={settings.tunNetmask} onChange={(event) => update("tunNetmask", event.target.value)} placeholder="255.255.255.0" /></label>
            <label>Gateway<input value={settings.tunGateway} onChange={(event) => update("tunGateway", event.target.value)} placeholder="10.0.0.1" /></label>
          </div>
          <div className="toggle-grid tun-dns-grid">
            <label className="toggle-row"><input type="checkbox" checked={settings.tunUseCustomDns} onChange={(event) => update("tunUseCustomDns", event.target.checked)} /><span><strong>Use custom TUN DNS</strong><small>Overrides the adapter DNS with the literal IPv4 address below.</small></span></label>
            <label className="toggle-row"><input type="checkbox" checked={settings.tunProxyDns} disabled={!settings.tunUseCustomDns} onChange={(event) => update("tunProxyDns", event.target.checked)} /><span><strong>Proxy custom DNS</strong><small>Requires custom TUN DNS to be enabled.</small></span></label>
          </div>
          <div className="settings-fields">
            <label>DNS server<input disabled={!settings.tunUseCustomDns} value={settings.tunDns} onChange={(event) => update("tunDns", event.target.value)} placeholder="1.1.1.1" /></label>
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
      <details className="panel legal-details">
        <summary>About &amp; legal</summary>
        <p>NetF is an independent GPL-3.0 split-tunneling application derived from Netch. It is not an official Netch release. Copyright and license notices for upstream authors and bundled components are included with the application and source repository.</p>
      </details>
    </div>
  );
}

# NetF troubleshooting

## Startup appears stalled

NetF reports Settings, Runtime, and Engine phases instead of blocking the
window. Open **Activity** after startup and copy the sanitized log; stage timings
separate slow runtime verification from an engine handshake failure. **Retry
startup** replaces a stopped or crashed engine host, but never an active tunnel.

## Red or unknown state

Do not assume traffic is safely disconnected. A red tray icon or **ATTENTION
REQUIRED** means NetF could not prove engine state. Restore the window, open
Activity, and attempt **Disconnect**. If cleanup fails, use the VM recovery
checks in `docs/windows-smoke-test.md` before reconnecting.

## The window disappeared

The default X-button behavior hides NetF to the Windows notification area.
Click the NetF icon to restore it. Settings can change close behavior to
**Disconnect and exit**. That option uses the tray Exit cleanup path; if cleanup
fails, NetF restores the window and reports the failure instead of disappearing.
Windows controls whether the icon is directly visible or inside hidden icons.

## A latency test times out or disagrees with the connection

Latency tests resolve the saved endpoint and run three TCP or ICMP probes. They
do not authenticate Xray credentials or send traffic through the tunnel. A DNS
failure means the endpoint name did not resolve within the bound. A timeout can
also mean the provider filters probes. WireGuard is UDP-only, so TCP may time
out even when WireGuard works; use ICMP if the endpoint permits it. Connection
success and real application traffic remain the authoritative smoke test.

Live testing is disabled at `-1` or legacy `0`. Values `1..3600` test only the
connected server. Disconnect/Exit cancels the monitor. If badges stop updating,
refresh Servers and inspect Activity for an engine-state or cleanup error.

## Auto-start does not run

Open Settings and inspect the registration indicator. NetF uses the per-user
**NetF Startup** task with a logon trigger, highest run level, the installed
executable, and fixed `--autostart` argument. A task that points to a moved or
older portable build exposes **Repair for this installation** and **Remove**.
Repair overwrites and verifies only that fixed task. Device-path prefixes,
quotes, case, and the current Windows SID are normalized during verification.
Auto-start intentionally stays in the tray and does not connect.

## A server is read-only or cannot connect

Imported SSR, SSH, SOCKS4a, plugin-based Shadowsocks, XTLS, and unsupported
transport/cipher profiles remain visible so they can be reviewed or deleted,
but they fail closed because the corresponding provider is not packaged. Create
a supported SOCKS5, Shadowsocks, VMess, VLESS, Trojan, or WireGuard entry in
**Servers → Library**, or import a compatible configuration. NetF never falls
back to an old executable outside its verified runtime.

## A pasted server link is rejected

**Servers → Library → Import link** accepts one `vless://`, `vmess://`,
`trojan://`, `ss://`, `socks5://`, or `socks://` URI while the engine is stopped
or failed. NetF rejects multiple lines, links above 8,192 characters, duplicate
or unknown query options, unsupported transports/TLS modes, Reality/XTLS,
Shadowsocks plugins, and invalid credentials or endpoints. The paste box clears
after every attempt by design. Add WireGuard manually because there is no single
interoperable URI format that NetF can safely infer. Never include a rejected
link in Activity copies, screenshots, or public bug reports because the URI may
contain a password, UUID, or key.

## Previous NetF data is not offered

The one-click action appears only when the fixed previous directory contains
both `runtime\data\settings.json` and `runtime\mode`. It does not require or
copy an old `bin` directory. The generic **Import configuration** action remains
available for other valid directories. Import is allowed only while stopped or
failed and leaves the previous directory untouched.

## No console window or console output

This is expected. Both debug and release desktop executables use the Windows
GUI subsystem, and the compatibility host is spawned without a console. Use
Activity logs for diagnostics.

## Reporting a problem

Include the NetF version, startup phase, state label, server type, mode type,
Runtime readiness details, and copied sanitized Activity log. Never publish raw
settings, subscription URLs, credentials, UUIDs, private keys, or unredacted
engine command lines.

## Recovering a deleted server

Confirmed deletion creates `data\deleted-server-backups\<UTC timestamp>\settings.json`
before modifying the active configuration, and the ordinary atomic write keeps
`settings.json.bak`. Exit NetF, preserve the current data directory, validate the
desired backup, then use the generic import workflow or restore it in a disposable
copy first. Do not replace settings while the engine is connected.

## A deleted built-in mode returned

Current builds store built-in deletions in
`data/deleted-modes.json` and apply them before mode loading. Use **Modes → Open
modes folder** and **Settings → Open app data folder** rather than guessing the
runtime path. If the tombstone file is missing or invalid, do not edit it while
NetF is running; preserve the file and sanitized Activity log for diagnosis.
Deleted files are backed up under `data/deleted-mode-backups/<UTC timestamp>/`.

To intentionally restore a built-in, close NetF, back up the app-data directory,
remove only that relative entry from the tombstone with valid schema/versioned
JSON, then let runtime preparation restore the packaged template. Never replace
the whole data directory or delete the only backup.

## Startup or idle performance investigation

Activity contains credential-free timing lines for startup stages and aggregate
health probes. With NetF manually started and stopped, run
`src\Netch.Desktop\scripts\measure-performance.ps1 -SampleSeconds 600` to
capture process count, memory, and idle CPU without changing engine state.

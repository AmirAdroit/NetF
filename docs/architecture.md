# Architecture

## Decision summary

Use **Tauri 2** for the new Windows desktop presentation layer, but migrate by
behavioral slices instead of rewriting the networking engine in one step.

This decision is based on the current repository, not on Tauri fashion:

- the valuable networking behavior already exists in C# and native C++;
- the application is Windows-specific and requires administrator operations;
- the current engine has direct WinForms dependencies that first need seams;
- Tauri provides a small native host, WebView2 UI, typed commands, events, and a
  capability allowlist;
- a full Rust rewrite before regression coverage would likely reintroduce bugs
  in route, DNS, process-filter, shutdown, and recovery paths.

## Current system

```text
WinForms forms
  | calls and is called by
Global static state + controllers + services
  | P/Invoke / child processes
Redirector.bin, RouteHelper.bin, tun2socks, aiodns, xray and other helpers
  | privileged Windows APIs
NetFilter driver, Wintun, routes, DNS, firewall, processes
```

The main architectural problem is not WinForms by itself. It is bidirectional
coupling: engine and utility classes call `Global.MainForm` for status, dialogs,
notifications, log windows, and state. A new UI cannot safely reuse the engine
until those calls become events or interfaces.

## Target system

```text
Tauri / React UI (currently elevated for parity; unprivileged target state)
  |
  | versioned, typed commands; state and log event channels
  v
Desktop controller and replaceable EngineBackend (Rust)
  |
  | bounded JSON-line IPC over supervised child stdio during migration
  v
NetF engine host (`netf-engine-host.exe`, inherited .NET migration bridge)
  |
  | FFI and supervised sidecars
  v
Native helpers and Windows networking primitives
```

The compatibility desktop currently runs the whole application elevated for
parity with upstream. Its Rust adapter starts one fixed, bundled engine host;
the webview receives no shell API and cannot supply the host executable or
runtime path. Rust verifies a packaged SHA-256 manifest and installs the owned
runtime into private local application data. Packaged built-in assets are
upgradeable while mutable settings and custom modes are preserved.

A native folder picker may select a configuration directory only for import.
The one-click previous-data action resolves the fixed prior NetF path in Rust;
React supplies no path. The engine validates and transactionally imports settings
and custom modes, creates a rollback backup, and never copies or executes source
binaries, logs, caches, WebView data, or geo assets.
Native/helper stdout is treated as untrusted noise and filtered before typed
protocol envelopes reach command handling. Requests have operation-specific
response deadlines so a damaged helper cannot block the UI indefinitely.
Runtime installation and the first engine handshake run on a blocking worker,
never in Tauri setup. A typed startup state machine reports settings, runtime,
engine, ready, and failed phases. A serialized health monitor probes the engine
every three seconds and skips a tick while another request owns the supervisor.
The target security model separates the normal UI from a small
privileged broker. The broker must authenticate its local client, use a named
pipe ACL restricted to the interactive user and service identity, and expose
specific operations rather than arbitrary commands.

## Component responsibilities

### React UI

- render connection, server, mode, scan, logs, and settings state;
- validate for immediate user feedback, without being the authority;
- never hold raw proxy credentials longer than necessary;
- invoke only allowlisted Tauri commands;
- remain usable at common DPI and keyboard-only navigation settings.

### Tauri adapter

- validate all command input at the trust boundary;
- own folder/file dialogs;
- translate engine events into typed frontend events/channels;
- supervise engine lifetime and enforce protocol/version compatibility;
- expose no unrestricted shell or filesystem API to JavaScript.
- own window/tray lifecycle, single-instance behavior, and authoritative state;
- keep Windows desktop settings separate from engine settings.

### Engine backend boundary

`EngineBackend` is the desktop-facing interface. The current
`EngineHostBackend` validates the `netf-engine` identity, API version, required
capabilities, backend version, and component versions before publishing Ready.
Future engines must implement this boundary instead of adding provider-specific
behavior to React or Tauri command handlers.

### Engine

- own authoritative application state and state transitions;
- load, validate, migrate, back up, and atomically save configuration;
- supervise protocol cores and native helpers;
- perform start/stop/rollback as transactions;
- emit structured status, health, bandwidth, and diagnostic events;
- redact secrets before logging or returning diagnostics.

### Privileged broker (target)

- install/update/remove approved drivers;
- make and roll back route, DNS, firewall, adapter, and service changes;
- reject unknown operations and untrusted clients;
- record enough state to recover after crashes or forced termination.

## Engine API shape

The versioned IPC contract currently implements:

- `hello`, `snapshot`, generic folder import, and fixed previous-NetF-data import;
- `connect(server_id, mode_id)` and `disconnect`;
- `serverDetail`, `saveServer`, `importServerLink`, `duplicateServer`, and `deleteServer` for typed,
  stopped-state server operations. Details expose only secret-presence booleans;
  secret values never cross into Rust or React;
- `modeDetail`, `saveMode`, `mergeMode`, and `deleteMode` for typed mode operations;
- `settings` and `updateSettings` for the allowlisted operational subset;
- `testServerLatency(serverId)` and `testAllServerLatencies` for bounded,
  credential-free DNS plus TCP/ICMP endpoint reachability;
- `desktopStartupStatus` and `configureDesktopStartup` for one fixed, verified
  per-user Windows Scheduled Task;
- `logs` for the bounded, redacted application-log tail.

`openOwnedFolder` is a Rust/Tauri desktop command rather than an engine method.
It accepts only the `modes` or `appData` enum and resolves the path from the
owned runtime. Mode deletion accepts an integer ID, never a path, and is allowed
only while stopped/failed. It flushes a timestamped backup before deletion;
built-in relative paths are stored in an atomic schema-versioned tombstone file
and applied before mode loading on every startup.

Startup logs record settings, runtime verification/install, engine spawn,
handshake, initial snapshot, and total duration. State transitions, generic
cleanup failures, unexpected health failures, and aggregate serialized
three-second probe timings are recorded without profile data or credentials.

Endpoint latency is not an Xray authentication or end-to-end proxy check. The
frontend supplies only a server ID. EngineHost resolves the stored endpoint,
runs three one-second probes after a bounded DNS lookup, serializes manual/all
tests, and caps all-server concurrency. When `StartedPingInterval` is enabled,
EngineHost monitors only the connected server and cancels its token before
disconnect, shutdown, server replacement, or process exit. React only refreshes
and renders the structured result.

The Rust/Tauri layer mirrors these as narrow typed commands and selects the
generic import folder natively. `importServerLink` accepts one bounded string,
but parses it only in the .NET authority through `ServerShareLinkService`; the
legacy bulk parser is not used because it logs failures and recognizes provider
shapes outside the packaged runtime. The parser is offline, rejects unknown or
duplicate options, validates the resulting typed server through the same save
path, and returns only credential-free server detail. Planned operations include subscription
management, typed event streaming, bandwidth, and structured
diagnostics export. Neither layer exposes arbitrary file paths, executables,
shell commands, helper arguments, or raw credentials to the webview.

The Tauri product identifier is `io.github.amiradroit.netf`, so 0.2.0 starts in
a clean local-data directory. The old `org.netchfork.preview` directory is read
only after explicit opt-in and remains untouched as a rollback source.

Desktop settings schema 2 adds `hideToTray`/`exit` close behavior and migrates
schema 1 atomically. Both window-close Exit and tray Exit call one single-flight
controller shutdown path. A disconnect or host-shutdown failure clears the exit
guard, restores the window, reports the failure, and does not claim cleanup.

Connection state is an explicit state machine:

```text
stopped -> validating -> starting -> connected -> stopping -> stopped
                       \-> failed ----^          \-> recovery -> stopped
```

Every start phase must register its compensating cleanup before proceeding to
the next phase. A crash-recovery record must describe system mutations that may
need reversal on the next launch.

## Configuration compatibility

The old settings and mode files are an external interface. Migration rules:

1. Never deserialize and overwrite in place.
2. Copy the original to a timestamped backup.
3. Parse into a versioned compatibility model.
4. Validate required values and preserve unknown fields where possible.
5. Write a temporary file in the same directory.
6. Flush, re-read, and validate it.
7. Atomically replace the destination.
8. Provide an explicit rollback path.

The process-mode scanner's compatibility contract is documented in its Rust
module and tests. In particular, rules remain C++-regex-compatible escaped
executable filenames rather than glob patterns.

## Why not immediately port everything to Rust?

A Rust engine could ultimately reduce the packaged runtime footprint and align
well with Tauri, but language choice does not remove the dangerous parts:
Windows driver lifecycle, native ABI behavior, process matching, route rollback,
DNS recovery, proxy-core compatibility, and configuration migration. Porting
those without an executable specification would trade old, understood risk for
new, poorly measured risk.

Port a component only when:

- its existing behavior has contract/integration tests;
- the replacement has an operational or security benefit;
- rollback and failure behavior are defined;
- Windows integration tests demonstrate parity.

## Supported platform direction

The UI technology is portable, but the engine is Windows-specific. Do not claim
macOS or Linux support until process routing, privilege separation, DNS, route,
firewall, packaging, and integration tests exist for those platforms. A useful
near-term form of broader support is protocol/config extensibility on current
Windows, not a superficial cross-platform window.

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
Tauri / React UI (unprivileged target state)
  |
  | versioned, typed commands; state and log event channels
  v
Desktop adapter (Rust)
  |
  | narrow authenticated local IPC during migration
  v
Netch engine/broker (.NET migration bridge)
  |
  | FFI and supervised sidecars
  v
Native helpers and Windows networking primitives
```

Initially, running the whole application elevated may be necessary for parity
with upstream. The target security model separates the normal UI from a small
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

The IPC contract should be versioned from its first implementation. Candidate
operations:

- `get_capabilities`, `get_status`, `subscribe_events`;
- `list_servers`, `test_server`, `upsert_server`, `delete_server`;
- `list_modes`, `scan_executables`, `validate_mode`, `upsert_mode`;
- `connect(profile)`, `disconnect(reason)`;
- `get_settings`, `update_settings`;
- `export_diagnostics(redaction_level)`.

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


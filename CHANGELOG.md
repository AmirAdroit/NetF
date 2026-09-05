# Changelog

All notable fork-specific changes are documented here. Upstream Netch history
before this fork remains available through Git and the existing tags.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and public releases should use semantic versioning once the fork has a distinct
name and compatibility policy.

## [Unreleased]

## [0.2.0] - Local review candidate

### Added

- Compact Servers **Connect / Library** workspaces with searchable manual create,
  edit, duplicate, and confirmed-delete flows for SOCKS5, Xray-compatible
  Shadowsocks, VMess, VLESS, Trojan, and WireGuard.
- Typed server-detail and mutation APIs across React, Tauri/Rust, `EngineBackend`,
  and the .NET host. Saved passwords, UUIDs, and private/pre-shared keys remain
  inside the engine and use Keep saved/Replace/Clear mutation controls.
- Offline single-link import for standard VLESS, VMess, Trojan, Shadowsocks, and
  SOCKS5 URIs through a bounded typed command and strict .NET authority parser.
  Pasted links are cleared after every attempt and never returned or logged.
- Provider and endpoint validation for ports, hostnames/IPs, UUIDs, Shadowsocks
  ciphers and 2022 keys, Xray transport/header/TLS combinations, and WireGuard
  CIDRs/32-byte Base64 keys.
- Accessible searchable connection-mode combobox with visible result counts,
  keyboard selection, clear/Escape behavior, and explicit no-results state.
- All/Built-in/Imported/User mode-origin filter chips with counts and composed
  text filtering while preserving editor selection and unsaved text.
- Fixed-path, opt-in previous-NetF-data discovery/import that accepts no webview
  path and imports only validated settings and custom modes.
- Explicit Windows auto-start repair/remove actions for a stale `NetF Startup` task.
- Selected-server and bounded-concurrency library latency tests with three TCP
  or ICMP endpoint probes, structured credential-free results, and live testing
  of only the connected server at the compatible configured interval.
- Supported settings parity for child-process routing, TUN adapter IPv4/netmask/
  gateway, TUN custom/proxied DNS, endpoint test method, and live interval.
- Versioned desktop close behavior with safe schema-v1 migration: hide to tray
  or reuse the exact disconnect/cleanup-and-exit path.
- .NET server lifecycle/secret/durability tests, Windows path/SID matcher tests,
  strict Rust protocol and previous-path tests, real host CRUD IPC coverage, and
  frontend filter/selection/provider-combination tests.

### Changed

- Adopted standalone product identity `io.github.amiradroit.netf`, backend identity
  `netf-engine`, and sidecar name `netf-engine-host.exe`. The previous application
  data directory remains untouched as an optional rollback/import source.
- Replaced misleading unavailable-helper counts with required/optional Runtime
  readiness and direct in-page navigation to readiness details.
- Restricted imported unsupported SSR, SSH, legacy transport, XTLS, SOCKS4a,
  plugin, and cipher shapes to read-only review/deletion; connection and
  duplication fail closed without an unowned fallback.
- Removed normal operational fork/compatibility wording; required upstream
  attribution remains in About & legal, licenses, notices, and documentation.
- Adjusted responsive breakpoints for the fixed sidebar and verified no horizontal
  overflow at the supported 920×660 minimum window.

### Fixed

- Normalize Task Scheduler `\\?\` device paths, quotes, case, and equivalent
  absolute paths; verify principals using the current Windows SID. This fixes
  false “Registration differs from the current NetF installation” results.
- Disabled Connect whenever the mode query no longer represents a valid selected
  mode or the selected imported server is unsupported.
- Cancel live endpoint probes before disconnect and shutdown, serialize manual
  tests to prevent overlap, and keep NetF open if cleanup fails during close.

## [0.1.0] - 2026-08-11

### Added

- Tauri 2, React, and TypeScript desktop preview workspace.
- Hardened, legacy-compatible executable discovery command and Rust unit tests.
- Review-and-copy interface for generated process-mode rules.
- Persisted system, light, and dark appearance modes.
- Modern desktop CI checks for TypeScript and Rust.
- Checksum-pinned Xray `v26.3.27` provider manifest, build script, license
  packaging, config validation fixtures, and loopback traffic tests.
- UI-independent engine status observer seam.
- Atomic JSON persistence helper with backup and failure-preservation tests.
- Self-contained .NET 10 headless engine host with a bounded, versioned,
  allowlisted JSON-line protocol.
- Rust engine supervisor, native-only runtime picker, server/mode summaries,
  and modern connect/disconnect controls.
- Real Rust-to-.NET sidecar handshake/snapshot integration test.
- Searchable, alphabetically sorted mode management with built-in/imported/user
  ownership markers, Process/TUN editing, copy-on-customize, and compatible-mode
  rule merging.
- Functional Overview, Activity, and Settings views with runtime readiness,
  sanitized bounded logs, and validated engine configuration.
- Development-only Tauri IPC fixture for browser-level UI and responsive-layout
  regression checks.
- Architecture, security, compatibility, roadmap, and agent documentation.
- Compact Library/Scanner Modes workspaces, Midnight Cobalt light/dark tokens,
  and fixed native actions for the modes and app-data directories.
- Confirmed deletion for built-in/imported/user modes with typed IPC, durable
  backups, startup tombstones, path/reparse validation, and restart coverage.
- Credential-free startup, handshake, state-transition, cleanup, and aggregate
  health-probe timing logs plus a read-only process/artifact sampler.

### Changed

- Replaced the upstream placeholder README with an accurate fork status and
  development guide while preserving explicit upstream credit.
- Removed generated TypeScript build metadata from version control.
- Migrated the WinForms compatibility application and tests to .NET 10 LTS.
- Updated MSTest, the .NET test host, and Coverlet to current releases.
- Replaced the deprecated managed SHA-1 provider while preserving the existing
  deterministic UUID mapping.
- Select Xray only for traffic-tested profile shapes; retain `v2ray-sn.exe` as
  a fail-closed fallback for SSR, SSH, legacy transports, XTLS, SOCKS4a, plugin
  configurations, and unsupported Shadowsocks ciphers.
- Made mode loading and pcap logging usable without constructing WinForms while
  retaining the legacy presentation path.
- Replace attached-runtime execution with a checksum-manifested, fork-owned
  runtime in private application data. Compile first-party native helpers and
  package the pinned Xray core as build inputs.
- Treat an existing Netch directory only as an import source. Validate and back
  up settings/custom modes while refusing to copy legacy executables or helpers.
- Report owned-runtime version, proxy cores, and per-mode helper capabilities in
  the modern UI. Direct SOCKS profiles do not launch a proxy core.
- Import legacy custom modes into a distinct `Custom/Imported` directory while
  preserving modern `Custom/User` modes, and classify older root custom files as
  imported for compatibility.
- Keep all mode summaries case-insensitively alphabetized across the engine,
  Rust adapter, and UI.
- Stop distributing Xray geo databases and inactive aiodns configuration in the
  modern application-only split-tunneling runtime; keep pinned source caches.
- Prepare one target-triple EngineHost sidecar instead of two identical copies.

### Fixed

- Restored current GitHub Actions compatibility and made legacy provider builds
  deterministic by pinning their declared Go toolchain and avoiding unbounded
  dependency upgrades. Legacy Netch release packaging is now manual-only so it
  cannot collide with NetF releases.
- Ignore legacy native DLL/helper stdout noise in the supervised engine
  protocol, bound response waits, and keep Stop available when a connection
  result is uncertain. This prevents a helper log line from wedging Connect and
  Disconnect with an `invalid response JSON` error.
- Correct TUN text-template inclusion so included rules populate the destination
  mode instead of attempting to append the mode to itself.
- Reset page scroll on navigation so shorter Overview, Activity, and Settings
  views never open at a stale position inherited from Modes.

### Security

- Restricted the preview webview to core Tauri permissions and folder-open
  dialogs; no shell or frontend filesystem capability is granted.
- Skipped filesystem reparse points during scans and bounded unique results.
- Removed remote font and asset loading from the desktop preview.
- Verify the Xray archive SHA-256 before extraction and package its license
  beside release artifacts.
- Validate and flush settings before atomic replacement; preserve the previous
  settings as a rollback backup.
- Prevent the elevated webview from supplying a runtime/helper path: the trusted
  Rust command obtains the path from a native folder picker and validates the
  expected runtime shape.
- Apply administrator elevation only to real Tauri app builds, keeping Rust
  test executables unelevated.
- Validate rule counts, lengths, names, paths, ports, addresses, and state before
  mode/settings writes; back up and atomically replace every modified file.
- Bound log reads and redact proxy URIs, credentials, UUIDs, tokens, private
  keys, and authorization values before returning diagnostics to the webview.

### Known limitations

- The remaining legacy helper and driver provenance still requires a full
  distribution audit.
- Current Xray validation covers TCP traffic; UDP, forced-termination cleanup,
  route/DNS rollback, and clean-VM testing remain release gates.
- The modern engine bridge can request real connections, but privileged Windows
  mode parity is not yet certified outside disposable test environments.
- Share-mode helper arguments remain deliberately read-only, and settings expose
  a safe operational subset rather than every legacy option.

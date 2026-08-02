# Modernization roadmap

This roadmap favors a continuously usable fork over a long-lived rewrite
branch. Each phase has a measurable exit condition.

## Phase 0 — Baseline and provenance

Status: **in progress**

- Preserve upstream history and GPL/NOTICE attribution.
- Inventory features from the last stable `1.9.7` tag and the unfinished 2.0
  line.
- Reproduce a legacy build in a pinned Windows build environment.
- Record hashes, versions, source repositories, and licenses for every bundled
  binary and driver.
- Establish clean-machine smoke tests for install, connect, disconnect, crash
  recovery, and uninstall.

Exit criteria:

- a documented, repeatable baseline build;
- a feature/compatibility matrix;
- no unknown binary in a release artifact;
- known-good configuration samples with secrets removed.

## Phase 1 — Modern shell and first vertical slice

Status: **in progress**

- Add Tauri 2 + React/TypeScript workspace.
- Add a modern, keyboard-accessible shell and design tokens.
- Implement the executable scanner behind a typed Rust command.
- Preserve legacy regex rule output and add edge-case tests.
- Keep the UI explicitly labeled as a preview while the engine is disconnected.

Exit criteria:

- frontend checks and Rust tests pass in CI;
- scanning large/inaccessible trees does not hang or loop;
- a scanned result can be reviewed and copied as legacy-compatible rules;
- no broad filesystem or shell capability is granted to the webview.

## Phase 2 — Headless engine boundary

Status: **in progress; first attach/snapshot/connect slice implemented**

- Replace `Global.MainForm` calls in controllers/services with typed events and
  interfaces.
- Move configuration, server, mode, subscription, and connection orchestration
  into UI-independent projects.
- Maintain the now-upgraded .NET 10 LTS bridge behind compatibility tests.
- Expand the implemented versioned child-stdio IPC and Tauri lifecycle
  supervisor with events and recovery records.
- Add mode read/write with backup, validation, atomic replacement, and rollback.

Exit criteria:

- the engine starts and stops a profile without WinForms loaded;
- the WinForms and Tauri UIs can drive the same engine contract during
  transition;
- configuration round-trip tests preserve all supported values;
- forced termination leaves either no system mutation or recoverable state.

## Phase 3 — Core feature parity

- Servers, subscriptions, share links, profiles, latency tests, and updates.
- Process mode, TUN mode, sharing mode, DNS behavior, bandwidth, tray behavior,
  autostart, logs, and localization.
- Import from a legacy install with preview and rollback.
- Structured diagnostics and redaction.

Exit criteria:

- the feature matrix has no unexplained regression from the chosen baseline;
- integration tests cover connect/disconnect and failure at every startup stage;
- users can migrate a copied configuration and revert safely;
- a release candidate survives a clean Windows VM test matrix.

## Phase 4 — Privilege and supply-chain hardening

- Split normal UI from a minimal privileged broker.
- Authenticate local IPC and restrict named-pipe ACLs.
- Pin and verify third-party source and artifacts.
- Generate SBOM and license inventory.
- Sign release artifacts; design a signed update manifest with rollback.
- Add dependency, secret, static, and artifact scanning to CI.

Exit criteria:

- normal UI does not require elevation;
- frontend compromise cannot invoke an arbitrary program or path;
- release contents are reproducible enough to explain every file;
- update authenticity and downgrade policy are tested.

## Phase 5 — Selective engine replacement

Evaluate each .NET bridge component for retention or Rust replacement. Prefer a
port only when it simplifies packaging, removes an unsupported dependency,
improves safety, or materially improves recovery/observability.

Exit criteria:

- no dual-runtime cost remains without a documented reason;
- parity and recovery tests pass for every replaced component;
- performance and package-size claims are measured, not assumed.

## First backlog after the scanner slice

1. Expand the baseline feature matrix from `1.9.7` and current `main`.
2. Expand redacted fixtures from the current protocol set to every settings,
   server, transport, and mode shape.
3. Finish extracting status/notification callbacks from `MainController`, `NFController`,
   `TUNController`, `PcapController`, `ModeService`, and `Bandwidth`.
4. Specify `engine-api-v1` messages and connection state transitions.
5. Add read-only server/mode listing in the Tauri preview.
6. Add safe draft saving, then explicit import/export before in-place migration.

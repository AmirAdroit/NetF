# Changelog

All notable fork-specific changes are documented here. Upstream Netch history
before this fork remains available through Git and the existing tags.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and public releases should use semantic versioning once the fork has a distinct
name and compatibility policy.

## [Unreleased]

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
- Architecture, security, compatibility, roadmap, and agent documentation.

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

### Security

- Restricted the preview webview to core Tauri permissions and folder-open
  dialogs; no shell or frontend filesystem capability is granted.
- Skipped filesystem reparse points during scans and bounded unique results.
- Removed remote font and asset loading from the desktop preview.
- Verify the Xray archive SHA-256 before extraction and package its license
  beside release artifacts.
- Validate and flush settings before atomic replacement; preserve the previous
  settings as a rollback backup.

### Known limitations

- The modern UI is not connected to the routing engine and cannot replace the
  legacy client yet.
- The remaining legacy helper and driver provenance still requires a full
  distribution audit.
- Current Xray validation covers TCP traffic; UDP, forced-termination cleanup,
  route/DNS rollback, and clean-VM testing remain release gates.

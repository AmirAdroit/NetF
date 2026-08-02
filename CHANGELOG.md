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
- Modern desktop CI checks for TypeScript and Rust.
- Architecture, security, compatibility, roadmap, and agent documentation.

### Changed

- Replaced the upstream placeholder README with an accurate fork status and
  development guide while preserving explicit upstream credit.

### Security

- Restricted the preview webview to core Tauri permissions and folder-open
  dialogs; no shell or frontend filesystem capability is granted.
- Skipped filesystem reparse points during scans and bounded unique results.
- Removed remote font and asset loading from the desktop preview.

### Known limitations

- The modern UI is not connected to the routing engine and cannot replace the
  legacy client yet.
- Legacy .NET targets and bundled binary provenance still require remediation.


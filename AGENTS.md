# Repository instructions

## Purpose

This repository modernizes the GPL-3.0 Netch Windows proxy client while
preserving compatibility and clearly crediting upstream. The current WinForms
application is the behavioral baseline; `src/Netch.Desktop` is the new Tauri 2
desktop workspace.

## Non-negotiable rules

- Preserve `LICENSE`, `Netch/NOTICE.txt`, upstream authorship, and fork
  attribution.
- Do not claim the fork is an official Netch release.
- Do not remove a legacy feature until a tested replacement exists.
- Do not directly edit a user's only configuration. Back up, validate, write a
  temporary file, and atomically replace.
- Do not expose a general shell command, unrestricted filesystem access, or
  arbitrary sidecar arguments to the webview.
- Treat driver installation, route changes, firewall changes, DNS changes, and
  credential handling as security-critical code.
- Keep UI code free of administrator and networking implementation details.
- Keep Tauri commands small, typed, validated, and delegated to testable Rust
  modules.
- Avoid new bundled binaries unless their source, license, version, checksum,
  and update procedure are documented.

## Architecture boundaries

- `src/Netch.Desktop/src/`: React presentation and client-side view state only.
- `src/Netch.Desktop/src-tauri/src/commands/`: narrow IPC command adapters.
- `src/Netch.Desktop/src-tauri/src/core/`: UI-independent, unit-tested logic.
- `Netch/Forms/`: legacy presentation; new domain logic must not be added here.
- `Netch/Controllers/`, `Netch/Services/`, `Netch/Interop/`: legacy engine code;
  remove `Global.MainForm` coupling before exposing it through a headless API.
- `Redirector/` and `RouteHelper/`: native ABI boundary; change only with ABI
  tests and Windows integration testing.

## Commands

Modern frontend:

```powershell
cd src\Netch.Desktop
npm run check
npm run test
npm run build
```

Modern Rust adapter:

```powershell
cd src\Netch.Desktop\src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Legacy release build:

```powershell
.\build.ps1 -Configuration Release -OutputPath release
```

## Definition of done

- Behavior is covered by unit tests; networking changes also have a documented
  Windows integration test.
- Frontend type-check, frontend tests, Rust format/lint/tests, and affected
  legacy tests pass.
- Errors are actionable and do not leak credentials.
- Security, migration, operational, and compatibility effects are documented.
- README and relevant docs reflect changed commands or architecture.
- A user can roll back without manually repairing routes, DNS, firewall rules,
  services, or configuration files.

## Known constraints

- The checkout's `main` is the unfinished 2.0 line; tag `1.9.7` is its direct
  ancestor and should be used for behavioral comparisons.
- The legacy application targets EOL .NET 6 and tests target EOL .NET 5.
- Several engine classes directly call WinForms through `Global.MainForm`.
- The existing test suite does not provide meaningful regression coverage.
- Bundled/prebuilt networking components need a full provenance and licensing
  audit before public distribution.


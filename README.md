# Netch modernization fork

> **Status: early modernization work.** This repository is a fork of
> [Netch](https://github.com/netchx/netch), originally created by AmazingDM and
> its contributors. It is not an official Netch release and is not yet a
> replacement for a known-good Netch installation.

Netch is a lightweight Windows proxy client with process-aware routing, TUN
routing, network sharing, multiple proxy protocols, and reusable mode files.
This fork exists to preserve those useful behaviors while making the project
maintainable, testable, secure, and pleasant to use on current Windows systems.

The modernization is incremental. The existing WinForms application and native
networking components remain the compatibility baseline while a Tauri 2 desktop
shell and a UI-independent engine boundary are developed alongside them.

## What works today

- The original .NET 6/WinForms application and C++ helpers are preserved.
- Existing `Storage/mode` files remain the compatibility format.
- A new Tauri desktop workspace lives in `src/Netch.Desktop`.
- The first modern vertical slice scans a directory tree for Windows
  executables and emits rules compatible with legacy process-mode files.
- The new scanner has deterministic output, skips directory links/reparse
  points, reports inaccessible paths, and enforces a configurable result limit.
- The preview follows the Windows theme by default and also supports persisted
  light or dark appearance overrides.

The modern desktop is currently a **functional preview**, not a complete proxy
client. Starting/stopping routes and editing production configuration will be
connected only after the privileged engine API is separated from WinForms.

## Architecture

```text
Modern desktop (Tauri 2 + React/TypeScript)
        |
        | typed Tauri commands and events
        v
Rust desktop adapter / compatibility API
        |
        | staged engine boundary
        v
Existing .NET orchestration + C++/driver helpers
```

The target is not a permanent stack of two application runtimes. The .NET
engine boundary is a migration bridge: preserve behavior first, measure parity,
then decide component-by-component whether a Rust port reduces risk and
maintenance cost.

See [architecture](docs/architecture.md), the
[compatibility matrix](docs/compatibility.md), the
[modernization roadmap](docs/modernization-roadmap.md), and
[security notes](docs/security.md) before changing networking or privilege code.

## Repository layout

| Path | Purpose |
| --- | --- |
| `Netch/` | Existing .NET 6 WinForms application |
| `Redirector/` | Native process-traffic redirector |
| `RouteHelper/` | Native Windows route helper |
| `Other/` | Third-party/core component build scripts |
| `Storage/` | Runtime assets, translations, and mode definitions |
| `Tests/` | Existing legacy tests (currently minimal) |
| `src/Netch.Desktop/` | New Tauri 2 desktop UI and Rust adapter |
| `docs/` | Architecture, migration, security, and operational context |

## Prerequisites

### Modern desktop preview

- Windows 10 or later
- Microsoft C++ Build Tools with **Desktop development with C++**
- Microsoft Edge WebView2 Runtime
- Rust stable toolchain
- Node.js 22 LTS or newer

```powershell
cd src\Netch.Desktop
npm install
npm run tauri dev
```

Run frontend checks without opening a desktop window:

```powershell
cd src\Netch.Desktop
npm run check
npm run test
```

Run Rust tests:

```powershell
cd src\Netch.Desktop\src-tauri
cargo test
```

### Legacy application

The legacy build needs Visual Studio C++ build tools, the .NET SDK matching the
project, Go, Rust, and the third-party native build dependencies described by
the existing scripts. `build.ps1` downloads and compiles runtime components;
review it before running it in a trusted environment.

```powershell
.\build.ps1 -Configuration Release -OutputPath release
```

The legacy project targets unsupported .NET 6 and the test project targets
unsupported .NET 5. Upgrading them is a planned compatibility change, not a
blind target-framework edit.

## Configuration compatibility

Legacy settings are stored under `data/settings.json`; mode definitions live
under `mode/` in a release and under `Storage/mode/` in this repository. Do not
point early preview builds at the only copy of a real configuration. Migration
code must create a backup and use atomic replacement.

The new scanner emits the same kind of C++ regex fragments as the old scanner:
it uses executable filenames such as `game\.exe`, not absolute paths. A future
mode editor will make filename-only and path-specific matching explicit.

## Security and distribution

Netch performs administrator-level networking changes and loads native code and
a kernel driver. Treat release engineering as security-sensitive:

- do not download unsigned mutable binaries at runtime;
- pin source versions and verify hashes during builds;
- keep the webview capability allowlist narrow;
- never expose arbitrary shell execution to frontend code;
- redact proxy credentials from logs and diagnostics;
- sign release executables, helpers, and drivers where applicable.

See [docs/security.md](docs/security.md) for the current threat model and known
gaps.

## Attribution and license

This fork remains licensed under **GNU GPL v3**. Preserve `LICENSE`,
`Netch/NOTICE.txt`, copyright notices, and source availability when distributing
modified binaries. New code in this repository is distributed under the same
GPL-3.0 license unless a file explicitly states otherwise.

The name and branding for the fork are intentionally still a working title.
Before the first public release, choose distinct branding that does not imply
endorsement by the original Netch maintainers while keeping prominent credit to
the upstream project.

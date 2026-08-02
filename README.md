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

- The WinForms compatibility application now targets .NET 10 LTS; its C++
  helpers and native behavior remain preserved.
- Existing `Storage/mode` files remain the compatibility format.
- A new Tauri desktop workspace lives in `src/Netch.Desktop`.
- The first modern vertical slice scans a directory tree for Windows
  executables and emits rules compatible with legacy process-mode files.
- The new scanner has deterministic output, skips directory links/reparse
  points, reports inaccessible paths, and enforces a configurable result limit.
- The preview follows the Windows theme by default and also supports persisted
  light or dark appearance overrides.
- Existing compatible SOCKS5, Shadowsocks, VMess, VLESS, Trojan, and WireGuard
  profiles can use the pinned Xray `v26.3.27` provider. Known-incompatible
  profiles automatically remain on the legacy SagerNet provider.
- Generated Xray configurations are validated by the real core, and five TCP
  protocol paths are exercised with local end-to-end proxy traffic tests.
- Settings saves are flushed, re-read, validated, backed up, and atomically
  replaced instead of modifying the only configuration in place.
- A self-contained .NET 10 engine host exposes an allowlisted JSON API to the
  Rust adapter. The modern Servers tab can attach a user-selected Netch runtime,
  list non-secret server/mode summaries, and request connect/disconnect.

The modern desktop is currently a **functional compatibility preview**, not yet
a replacement for a known-good client. The engine bridge is connected, but
privileged process/TUN/sharing behavior still requires hands-on Windows VM and
recovery testing. Server editing and production configuration writes remain
disabled.

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
| `Netch/` | .NET 10 WinForms compatibility application and engine code |
| `Netch.EngineHost/` | Headless, versioned JSON-line engine bridge |
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
npm run tauri:dev
```

`tauri:dev` prepares the self-contained engine host and launches the desktop
with administrator rights, matching the legacy application during this
compatibility phase. In the Servers tab, choose a copied or known-good Netch
runtime containing `data/settings.json`, `mode/`, and `bin/`. Close the legacy
Netch process before attaching the same directory.

The engine host is built from this fork, but the attached directory currently
provides settings, modes, native routing helpers, and proxy-core executables.
A SOCKS server is used directly without starting a proxy core. For compatible
VMess/VLESS/Trojan-family profiles, `bin/xray.exe` is preferred when it exists;
otherwise the compatibility selector retains the attached `v2ray-sn.exe` or
protocol-specific legacy helper. The Servers health panel reports this core
inventory explicitly. A future packaged runtime will remove this temporary
dependency on an existing installation.

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

Build the complete debug executable without an installer:

```powershell
cd src\Netch.Desktop
npm run tauri:build -- --debug --no-bundle
```

The output is `src\Netch.Desktop\src-tauri\target\debug\netch-desktop.exe`.
See [Windows smoke testing](docs/windows-smoke-test.md) before connecting a
real profile.

### Legacy application

The compatibility build needs Visual Studio C++ build tools, .NET SDK
10.0.302 (pinned by `global.json`), Go, Rust, and the native build dependencies described by
the existing scripts. `build.ps1` downloads and compiles runtime components;
review it before running it in a trusted environment.

```powershell
.\build.ps1 -Configuration Release -OutputPath release
```

Run the .NET compatibility, provider-config, and loopback traffic tests with a
checksum-verified Xray binary:

```powershell
$xray = .\Other\xray-core\fetch.ps1
$env:NETCH_XRAY_PATH = $xray
dotnet test .\Tests\Tests.csproj -c Release
```

The release build packages Xray under its own filename and includes its MPL-2.0
license. It does not overwrite `v2ray-sn.exe`, so unsupported legacy profile
shapes retain their existing fallback.

## Configuration compatibility

Legacy settings are stored under `data/settings.json`; mode definitions live
under `mode/` in a release and under `Storage/mode/` in this repository. Do not
point early preview builds at the only copy of a real configuration.
Configuration saves create `settings.json.bak`, flush and re-read a temporary
file in the same directory, validate it, and atomically replace the destination.

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

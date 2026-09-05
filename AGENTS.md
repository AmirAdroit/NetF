# Repository instructions

## Purpose

This repository modernizes the GPL-3.0 Netch Windows proxy client while
preserving compatibility and clearly crediting upstream. The current WinForms
application is the behavioral baseline; `src/Netch.Desktop` is the NetF Tauri 2
desktop workspace. NetF is a distinct fork identity, not an official Netch release.

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
- Treat pasted server links as temporary credential-bearing input. Accept one
  allowlisted URI of at most 8,192 characters, never log or echo the link, clear
  it from React after every attempt, and repeat provider validation in .NET.
- Latency commands accept only a validated server ID. DNS resolution, endpoint,
  port, TCP/ICMP selection, timeouts, and cancellation remain engine-owned;
  results and logs must not contain credentials or claim proxy authentication.
- Keep UI code free of administrator and networking implementation details.
- Keep Tauri commands small, typed, validated, and delegated to testable Rust
  modules.
- Avoid new bundled binaries unless their source, license, version, checksum,
  and update procedure are documented.

## Architecture boundaries

- `src/Netch.Desktop/src/`: React presentation and client-side view state only.
- `src/Netch.Desktop/src-tauri/src/commands/`: narrow IPC command adapters.
- `src/Netch.Desktop/src-tauri/src/core/`: UI-independent, unit-tested logic.
- New engine implementations must sit behind `EngineBackend`; do not expose
  compatibility-engine names or wire shapes to React.
- `Netch.EngineHost/`: bounded JSON-line adapter only; do not add general
  command execution or return raw credentials.
- `Netch/Services/ServerShareLinkService.cs`: authority for strict, offline,
  single-link parsing. Do not route link parsing through the legacy bulk parser,
  which logs parse failures and accepts provider shapes outside the owned runtime.
- `Netch/Services/ServerLatencyService.cs`: authority for bounded three-probe
  endpoint testing. Keep live-monitor ownership and disconnect cancellation in
  EngineHost; React may request typed tests and render credential-free results.
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
npm run prepare:engine
npm run tauri:build -- --debug --no-bundle
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

.NET compatibility and provider tests:

```powershell
$xray = .\Other\xray-core\fetch.ps1
$env:NETCH_XRAY_PATH = $xray
dotnet test .\Tests\Tests.csproj -c Release
```

## Definition of done

- Behavior is covered by unit tests; networking changes also have a documented
  Windows integration test.
- Frontend type-check, frontend tests, Rust format/lint/tests, and affected
  legacy tests pass.
- Errors are actionable and do not leak credentials.
- Share-link changes include valid-provider, hostile-input, duplicate-option,
  size/line-count, unsupported-feature, state-gate, and redaction tests.
- Security, migration, operational, and compatibility effects are documented.
- README and relevant docs reflect changed commands or architecture.
- A user can roll back without manually repairing routes, DNS, firewall rules,
  services, or configuration files.

## Known constraints

- The checkout's `main` is the unfinished 2.0 line; tag `1.9.7` is its direct
  ancestor and should be used for behavioral comparisons.
- The compatibility application and tests target pinned .NET 10 LTS; remaining
  obsolete API and nullable warnings are tracked modernization debt.
- Several engine classes directly call WinForms through `Global.MainForm`.
- The headless bridge supports the owned runtime, typed backend handshake,
  operational views, bounded endpoint latency, tray lifecycle, schema-v2 safe
  close behavior, and verified Windows auto-start, but the
  app remains elevated until a separately authenticated privileged broker exists.
- The test suite now covers configuration durability and selected proxy-core
  configs/loopback TCP traffic, but still lacks privileged Windows regression
  and recovery coverage.
- Modern link import accepts one VLESS, VMess, Trojan, Shadowsocks, or SOCKS5
  URI. It intentionally does not fetch subscriptions, import multiple lines, or
  guess a WireGuard URI format.
- Bundled/prebuilt networking components need a full provenance and licensing
  audit before public distribution.

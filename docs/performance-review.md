# NetF performance review

Measurements were taken on 2026-08-10 on the same Windows checkout and branch. Sizes use MiB (1,048,576 bytes). Generated build outputs are ignored and were not added to Git.

## Before and after

| Measurement | Before | After | Result |
| --- | ---: | ---: | --- |
| Owned runtime template | 73.27 MiB | 43.49 MiB | -29.78 MiB (-40.6%) |
| Debug NSIS installer | 96.55 MiB | 92.35 MiB | -4.20 MiB (-4.4%) |
| EngineHost preparation directory | 169.33 MiB (two identical executables) | 84.67 MiB (one executable) | -84.66 MiB (-50.0%) |
| Debug NetF executable | 14.83 MiB | 14.94 MiB | +0.11 MiB |
| Release NetF executable | not recorded | 10.41 MiB | informational |
| Release NSIS installer | not recorded | 91.80 MiB | informational |
| `prepare:runtime` warm run | 8.09 s | 6.67 s | -1.42 s (-17.6%) |
| `prepare:engine` observed run | 30.16 s | 4.29 s warm | build-cache affected; not a controlled comparison |
| Real EngineHost attach | not recorded | spawn 1,313 ms; handshake 371 ms; snapshot 8 ms | one focused test run |
| Frontend CSS | 29.89 kB / 6.74 kB gzip | 34.66 kB / 7.43 kB gzip | +4.77 kB / +0.69 kB gzip |
| Frontend JS | 235.69 kB / 71.71 kB gzip | 236.63 kB / 71.96 kB gzip | +0.94 kB / +0.25 kB gzip |

The installer saves less than the 29.78 MiB raw runtime reduction because NSIS compressed the geo databases well. UPX and Xray trimming were rejected: their smaller potential benefit does not justify antivirus, provenance, startup, and compatibility risk.

## Runtime scope

The modern packaged runtime no longer distributes `geoip.dat`, `geosite.dat`, or inactive `aiodns.conf`. The pinned source cache remains available. All 15 provider/config and loopback traffic cases run Xray from an isolated directory containing only `xray.exe`; 15 passed. Process/TUN route setup, LAN bypass, DNS rollback, and hostname-based remote endpoints still require the privileged Windows matrix because those checks mutate host networking.

## Startup and idle observability

The desktop log now records settings load, runtime verification/install, engine spawn, handshake, initial snapshot, total startup, state transitions, cleanup failures, unexpected health failures, and aggregate health-probe timing. No credential-bearing request or profile values are logged.

Cold/warm GUI startup, working/private memory, idle CPU, and three-second health-monitor overhead were not safely measured in this non-interactive run because the real desktop requests elevation and installs an owned runtime in user app data. Use the read-only sampler while a manually launched instance is stopped:

```powershell
cd src\Netch.Desktop
.\scripts\measure-performance.ps1 -SampleSeconds 600
```

Record the startup timing lines from Activity separately for a clean runtime and the next warm launch. The sampler does not launch, connect, disconnect, or modify NetF.

## Method limitations

- Build timings are sensitive to MSBuild, NuGet, Cargo, and filesystem caches; only the runtime size and installer size comparisons are directly controlled.
- The reparse-point deletion fixture was skipped because this session could not create a Windows symbolic link. Traversal rejection ran and passed; reparse rejection remains in the manual elevated matrix.
- `cargo audit` was unavailable because it is not installed. No tool was installed automatically.
- The elevated Rust GUI test binary cannot execute from the non-elevated test runner (`os error 740`). Strict Clippy and all 19 library tests, including real EngineHost IPC, passed.

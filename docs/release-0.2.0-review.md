# NetF 0.2.0 local review

This is the pre-publication handoff for the standalone-identity, server-management,
live-latency, and supported-settings milestone. The repository has not been
committed, pushed, merged, or published. These are local review artifacts only.

## Local artifacts

| Artifact | Bytes | Size | SHA-256 |
| --- | ---: | ---: | --- |
| `deliverables/NetF-0.2.0-Windows-x64-Setup.exe` | 96,389,751 | 91.92 MiB | `611A0A532DDF0984CDE2EFF569253B8DA79938D6C66C2E4D98AC40B0D6433968` |
| `deliverables/NetF-0.2.0-Windows-x64-Portable.zip` | 103,110,145 | 98.33 MiB | `857AFFB1889B4B656BA26548AFF66CA42EDE74287518E621B346D8C584DA222A` |

The portable archive contains 123 entries. It contains `NetF.exe`, `netf-engine-host.exe`, and runtime manifest version `0.2.0`; it does not contain the former sidecar name, `geoip.dat`, `geosite.dat`, or `aiodns.conf`.

## Implemented

- Added compact Servers **Connect / Library** workspaces with typed create, edit, duplicate, and confirmed-delete workflows for SOCKS5, Xray-compatible Shadowsocks, VMess, VLESS, Trojan, and WireGuard.
- Added strict offline single-link import for VLESS, VMess, Trojan, SIP002 Shadowsocks, and SOCKS5. The bounded parser rejects subscriptions, batches, unknown or duplicate options, unsupported transports/plugins, malformed encoding, and non-standard WireGuard links without echoing credentials.
- Added .NET authority-side validation, stopped-state mutation guards, timestamped backups, atomic persistence, profile-reference maintenance, and fail-closed handling for unsupported imported profiles.
- Kept saved passwords, UUIDs, private keys, and pre-shared keys out of snapshots and server-detail responses. Existing values use explicit **Keep saved / Replace / Clear** mutations, and duplication happens inside the engine.
- Replaced the ineffective mode select with a searchable keyboard-accessible combobox. Added composable All/Built-in/Imported/User filter chips without discarding editor selection or unsaved mode text.
- Adopted the standalone `io.github.amiradroit.netf` product identity, `netf-engine` backend identity, and `netf-engine-host.exe` sidecar. Inherited source namespaces remain unchanged, and required upstream attribution remains in legal/repository material.
- Added fixed-path opt-in previous-data discovery/import. It accepts no frontend path, validates settings and custom modes transactionally, leaves the source untouched, and excludes executables, logs, caches, and geo assets.
- Fixed Scheduled Task verification for quoted paths, Windows device paths, case differences, and current-user SID matching. Stale registrations expose explicit repair and remove actions.
- Replaced misleading unavailable-provider counts with required/optional **Runtime readiness** and in-page details.
- Added release packaging for a versioned installer and portable archive without reintroducing the excluded geo/AioDNS assets.
- Added three-probe TCP/ICMP **Test selected** and bounded-concurrency **Test all**
  operations with credential-free status/latency/timestamps. Optional live
  testing covers only the connected server and cancels before cleanup.
- Added supported settings for Process child handling, TUN IPv4/netmask/gateway,
  custom/proxied TUN DNS, TCP/ICMP selection, and the compatible live interval.
- Added schema-v2 hide-to-tray or cleanup-and-exit behavior. Both exit surfaces
  share a single-flight cleanup path and restore the window on failure.

## Measurements

| Measurement | 0.1.0 baseline | 0.2.0 candidate | Result |
| --- | ---: | ---: | --- |
| Runtime template | 43.49 MiB | 43.49 MiB | unchanged; 115 files / 45,606,133 bytes |
| Release installer | 91.80 MiB | 91.92 MiB | +0.12 MiB |
| Portable ZIP | 98.93 MiB | 98.33 MiB | -0.60 MiB |
| Engine host | 84.67 MiB | 84.70 MiB | +0.03 MiB |
| Frontend CSS | 34.66 / 7.43 kB gzip | 43.53 / 8.73 kB gzip | +8.87 / +1.30 kB gzip |
| Frontend JS | 236.63 / 71.96 kB gzip | 260.89 / 77.91 kB gzip | +24.26 / +5.95 kB gzip |
| `prepare:runtime` warm | 6.67 s | 5.88 s | -0.79 s; cache-sensitive |
| `prepare:engine` warm | 4.46 s | 4.44 s | effectively unchanged; cache-sensitive |
| Real host attach | spawn 1,313 ms; handshake 371 ms; snapshot 8 ms | spawn 874 ms; handshake 478 ms; snapshot 25 ms | filesystem/build-cache-sensitive |

Cold/warm elevated GUI startup, installed-runtime verification, idle working/private memory, idle CPU, and aggregate three-second health-probe overhead were not fabricated from a non-interactive run. Record them during manual acceptance with `scripts/measure-performance.ps1 -SampleSeconds 600` and the phase timings in Activity.

## Automated validation

| Area | Result |
| --- | --- |
| Frontend type-check | Passed |
| Frontend tests | 20 passed across 4 files |
| Frontend production build | Passed; bundle sizes recorded above |
| Browser/UI review | Passed at 1240x820 and 920x660 in light/dark mock mode; latency interactions, responsive settings, no horizontal overflow, and no console warnings/errors |
| Rust format and strict Clippy | Passed |
| Rust library tests | 24 passed, including real host latency, link import, CRUD/redaction, and backup IPC |
| .NET provider/server/startup/latency tests | 50 passed, 1 skipped; all 15 geo-free Xray configuration/loopback cases executed |
| Legacy release build | Passed |
| Tauri 0.2.0 release installer build | Passed |
| Portable packaging/content verification | Passed |
| npm audit | 0 vulnerabilities |
| NuGet vulnerability audit | No vulnerable packages reported |
| Diff whitespace check | Passed |

Explicit limitations:

- The installer, desktop executable, and EngineHost sidecar are not Authenticode
  signed. Treat SmartScreen/antivirus behavior as a release risk and do not call
  this a trusted stable distribution until signing and provenance gates pass.
- The fresh Xray fetch attempt timed out before tests began. The complete suite
  instead used the installed NetF runtime core after its SHA-256 was confirmed
  equal to the packaged manifest (`15c2d007…96ef8f1`).
- The full Rust all-target test run cannot launch the elevated GUI binary from the non-elevated runner (`os error 740`). The library suite and release build pass.
- One reparse/symbolic-link fixture is skipped because this session cannot create the required Windows link. Traversal rejection passes; elevated reparse rejection remains in the manual matrix.
- `cargo audit` is unavailable because it is not installed; no tool was installed implicitly.
- Privileged Process/TUN route, DNS, firewall, driver, crash, reboot, and uninstall recovery behavior requires the disposable-VM acceptance matrix below.

## Remaining risks and sequence

1. **P0 — Privileged rollback/recovery harness.** There is still no automated fault-injection matrix proving route, DNS, firewall, adapter, driver, service, and helper cleanup after every failure point.
2. **P0 — Authenticated elevated broker separation.** The Tauri desktop/WebView process remains elevated; separating a narrowly authenticated broker is the most important security boundary improvement.
3. **P0 — Crash supervision and durable cleanup journal.** Unexpected exits are observable, but safe recovery is not yet backed by a complete mutation journal. Automatic reconnection must remain disabled.
4. **P1 — Authenticated runtime-verification cache.** This can reduce warm startup I/O only after file identity, replacement, reparse, rollback, and cache-corruption attacks are covered.
5. **P1 — Deterministic startup parallelism and event-driven health.** Both can reduce latency/wakeups, but require deterministic failure/cancellation and lost-event tests first.
6. **P1 — Smaller headless host and provider modernization behind `EngineBackend`.** This offers the largest artifact/maintenance gain without exposing inherited wire shapes to React, but has broad compatibility risk.
7. **P2 — Subscription/batch import and optional downloadable geo routing.** These should remain separate opt-in features with hostile-input limits, signed manifests, and credential-redaction tests. Single-link import is already implemented offline.

The detailed evidence, affected areas, expected benefits, complexity, risks, and required tests are maintained in `docs/optimization-backlog.md`.

## Exact manual Windows acceptance

Use a disposable Windows VM snapshot for networking and forced-crash cases.

1. Hash both artifacts and compare them with the values above. Install the setup build, then repeat the basic checks from an extracted portable build.
2. Start with `%LOCALAPPDATA%\io.github.amiradroit.netf` absent. Time first launch and the next two warm launches; confirm the new directory is created, the old `%LOCALAPPDATA%\org.netchfork.preview` directory is unchanged, and no console window appears.
3. While stopped, run `scripts\measure-performance.ps1 -SampleSeconds 600`. Record process count, working/private memory, ten-minute idle CPU, and aggregate three-second health-probe timing from Activity.
4. Create and restart-test one valid server of each supported type: SOCKS5, Shadowsocks, VMess, VLESS, Trojan, and WireGuard. Exercise every visible transport/TLS choice at least once across the Xray profiles.
5. In **Servers → Library**, paste one known-good VLESS, VMess, Trojan, Shadowsocks, and SOCKS5 link. Confirm the pasted value clears immediately, the imported server is selected, duplicate names gain a numeric suffix, and the profiles survive restart. Test the exact 8,192-character boundary, a longer value, multiple lines, malformed percent/Base64, duplicate/unknown query keys, unsupported Reality/XTLS/plugins/transports, IPv6 authority syntax, and a WireGuard URI; every invalid case must fail without showing the link or a credential in UI, Activity, logs, or errors.
6. Connect the representative pasted VLESS WebSocket/XUDP profile through both Process and TUN modes. Confirm its hostname/IP endpoint, path, packet encoding, TLS/SNI, and secret were preserved correctly and that disconnect restores the networking baseline.
7. For every type, edit non-secret fields using **Keep saved**, replace each secret, clear each optional secret, duplicate the server, rename it, and confirm referencing profiles remain valid. Verify no saved secret is ever shown in the UI or copied Activity output.
8. Cancel a server deletion and verify no change; then confirm deletion and verify the server/reference updates survive restart. Confirm a timestamped backup and `settings.json.bak` exist and are parseable.
9. Import a known unsupported SSR, SSH, plugin, or legacy-transport profile. Verify it is visibly read-only, cannot connect or duplicate, explains why, and can only be removed after confirmation.
10. If **Import previous NetF data** appears, use it and verify the existing SOCKS server and custom modes arrive. Confirm no binary, DLL, log, WebView cache, or geo file is copied and the old directory is byte-for-byte unchanged. Repeat the generic folder import with another valid configuration.
11. In Connect, type partial and nonexistent mode names; test Arrow Up/Down, Enter, Escape, and clear. Confirm visible result counts/no-results state and that Connect is disabled until an actual mode is selected.
12. In Modes, combine text search with All/Built-in/Imported/User chips. Confirm counts are correct and changing filters does not discard the selected editor or unsaved text. Repeat scanner tests for duplicates, nested executables, inaccessible directories, mixed-case extensions, reparse points, and result limits.
13. Run **Test selected** and **Test all** with both TCP and ICMP. Verify success, closed-port timeout, reserved-name DNS failure, and the WireGuard/UDP explanation. Enable a short live interval, connect, confirm only that server updates, then disconnect during a probe and verify cancellation and cleanup. Treat real traffic—not endpoint ping—as the authentication test.
14. Save and restart-test Handle child processes, TUN IPv4/netmask/gateway, custom DNS/proxy DNS, TCP/ICMP selection, and disabled/enabled live intervals. Verify malformed masks, mismatched subnets, invalid DNS combinations, and out-of-range intervals fail without changing the active configuration.
15. Connect SOCKS5 and representative Shadowsocks/VMess/VLESS/Trojan/WireGuard profiles through a Process mode. Verify intended TCP/UDP/DNS behavior, unrelated-app bypass, LAN access, hostname endpoint resolution, server-route reachability, then compare routes/DNS/firewall/services/helpers with the pre-connect baseline after disconnect.
16. Repeat with a TUN mode, including Wintun creation/removal, IPv4/IPv6, LAN bypass, DNS, server route, failed connect, and missing-helper cleanup. Any incomplete restoration blocks release.
17. Enable **Start NetF when Windows starts**. Sign out/in and confirm tray-only launch with no automatic connection. Move the portable directory, verify the stale-task warning, use **Repair for this installation**, verify the fixed `NetF Startup` task and `--autostart` argument, then Remove and confirm only that fixed task is deleted.
18. Test both **Hide to tray** and **Disconnect and exit** while stopped and connected. Inject a cleanup failure in a VM and verify the window reopens. Then test second-instance focus, Xray termination, engine-host termination, and desktop force-kill in separate snapshots. Confirm explicit failed/unknown state, no unsafe automatic reconnection, no orphan process, and complete cleanup.
19. Test offline startup, IPv6-only and IPv6-disabled configurations, Wi-Fi plus Ethernet, another VPN/multiple NICs, reboot after forced failure, unavailable helpers/drivers, uninstall, and reinstall. Confirm uninstall removes only current NetF data/components and the fixed task according to the selected uninstall policy, without touching the previous-data source.
20. Search all copied Activity/diagnostic output for passwords, proxy URIs, UUIDs, tokens, authorization headers, and private/pre-shared keys. Any credential occurrence is a release blocker.

Do not publish 0.2.0 until the privileged cleanup tests pass and the results are recorded in `docs/windows-smoke-test.md` or an attached acceptance record.

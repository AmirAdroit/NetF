# NetF Windows smoke test

Use this checklist before treating the Tauri compatibility desktop as a daily
driver. Run destructive recovery cases only in a disposable Windows VM with a
snapshot. Do not test forced termination on a host where stale DNS or routes
would interrupt important work.

## Safe host-level review

1. Close every running NetF process.
2. Keep the previous NetF data or another known-good configuration directory
   available as an import source. The
   desktop must read only its `data/settings.json` and `mode/Custom` content;
   its `bin` directory must not be copied or executed.
3. Build the desktop:

   ```powershell
   cd src\Netch.Desktop
   npm run tauri:build -- --debug --no-bundle
   ```

4. Launch `src\Netch.Desktop\src-tauri\target\debug\NetF.exe` and
   accept the administrator prompt.
   Confirm no CMD window appears and the NetF window remains movable while it
   reports Settings, Runtime, and Engine startup phases.
5. Open **Servers** and test both **Connect** and **Library**. If **Import previous
   NetF data** appears, use it once and verify server/custom-mode counts match.
   Also test the generic folder import. Endpoints may be shown, but the webview
   must never receive a saved password, UUID, private/pre-shared key, or subscription URL.
   Paste one valid VLESS, VMess, Trojan, Shadowsocks, and SOCKS5 link separately;
   confirm each creates and selects one server, clears the paste box, and never
   returns the saved secret when the server is reopened.
6. Open Overview **Runtime readiness**. Required Process, TUN, and Xray components
   must be Ready before connection testing. An absent optional sharing helper may
   report Limited without presenting intentionally excluded AioDNS/legacy providers
   as broken capabilities.
7. Confirm the verified runtime contains packaged Xray and no unowned fallback
   cores. Direct SOCKS is built into the NetF engine and does not require a core process.
8. Switch between Servers and Modes, change light/dark/system appearance, and
   resize to the minimum supported window. Check for clipped controls,
   horizontal scrolling, or selections that reset unexpectedly.
9. In **Modes**, verify names are alphabetical, search by name/path/type/origin,
   click All/Built-in/Imported/User filters, and confirm origin counts. Changing
   filters must not discard the selected editor or unsaved rule text.
10. Save a built-in Process mode and verify a user-owned JSON copy is created
    while the built-in text template remains unchanged. Edit it again and verify
    the prior JSON is retained as `.bak`.
11. Merge a compatible source mode into the copy. Verify handled/bypass rules
    are deduplicated and an incompatible Process/TUN merge is rejected.
12. In **Settings**, change a harmless stopped-state option, save, restart, and
    verify the value persists and `data/settings.json.bak` contains the prior
    file. Save/restart-test Handle child processes, TUN address/netmask/gateway,
    custom/proxied TUN DNS, TCP/ICMP test method, and disabled/enabled live
    interval. Invalid masks, subnets, DNS combinations, and intervals must fail
    without changing the file. Restore the original values before connections.
13. In **Activity**, refresh and copy logs. Confirm the output is bounded and
    contains no server password, UUID, token, private key, or proxy URI.
14. Enable **Start NetF when Windows starts**, confirm the Scheduled Task is
    verified, sign out/in, and verify NetF starts in the notification area
    without opening its window or connecting. Move a portable build, confirm the
    stale task offers **Repair for this installation** and **Remove**, repair it,
    then disable it and verify removal of only the fixed `NetF Startup` task.
15. In Servers, run **Test selected** and **Test all** with TCP and ICMP. Record
    success, closed-port timeout, reserved-name DNS failure, and WireGuard/UDP
    guidance. Confirm results expose no credentials and Connect stays available.

## Connection parity

Use a profile already proven in the legacy client. Test one mode at a time:

1. Record baseline routes, DNS servers, active adapters, relevant services, and
   outbound IP/DNS behavior.
2. Connect from the desktop and verify the intended application traffic, TCP,
   UDP where applicable, and DNS behavior. Confirm unrelated applications
   follow the mode's bypass rules.
3. Disconnect from the desktop. Verify proxy-core/helper processes exit and the
   recorded route, DNS, adapter, firewall, and service state returns to baseline.
4. Repeat for process mode, TUN mode, and sharing mode only when their native
   dependencies are present.
5. Compare `logging/` output with the legacy run and inspect it for credential
   leakage before sharing diagnostics.
6. With **Hide to tray**, connect, close the window, and verify routing continues
   with a green icon. With **Disconnect and exit**, repeat while stopped and
   connected; verify helpers stop and networking returns to baseline. Inject a
   cleanup failure in a VM and verify the window reopens instead of exiting.
7. Enable live latency at a short interval, connect, verify only the connected
   server updates, then disconnect during a probe. The probe must cancel and all
   route/DNS/adapter/helper cleanup must still complete.

## VM-only failure recovery

- disconnect during each startup phase;
- close the UI while connected and verify the supervised host performs cleanup;
- force-kill the engine and then the desktop process separately;
- reboot after forced termination and verify routes, DNS, adapters, firewall
  rules, services, and drivers recover;
- test offline, multi-NIC, IPv6, and a missing-helper failure;
- restore the VM snapshot after the test matrix.

Record the Windows build, selected server type, transport/security settings,
mode type, helper hashes, result, cleanup result, and relevant redacted logs.
Any cleanup failure blocks calling the modern desktop stable.

## NetF optimization milestone acceptance

Run the following in order and retain exact timings, process lists, screenshots,
and redacted logs with the test record.

1. Remove or rename the existing NetF local app-data runtime only in a disposable
   VM after making a backup. Time first launch from process creation to **Ready**.
   Exit normally, time the next warm launch, and record the settings, runtime,
   engine-spawn, handshake, snapshot, and total timing lines from Activity.
2. Confirm the runtime contains no `geoip.dat`, `geosite.dat`, or `aiodns.conf`.
   Confirm there is one `netf-engine-host.exe` process and no visible console
   window. Run `scripts\measure-performance.ps1 -SampleSeconds 600` while stopped;
   record working/private memory, process count, average idle CPU, and the
   aggregate three-second health-probe timing after at least ten minutes.
3. At 1240×820 and 920×660, test Library and Scanner in light/dark/system themes.
   Verify no horizontal page scrolling at minimum size, visible keyboard focus,
   and correct blue selection, green connected/success, amber transition/warning,
   and red failure/destructive semantics.
4. Create Process and TUN modes. Edit each, merge same-type rules, restart, and
   verify names/rules persist. For built-in, imported, and user origins: open
   Delete, choose Cancel, and verify no IPC-visible change; reopen, confirm, and
   verify a timestamped backup. Restart and verify built-ins remain deleted.
   Repeat with the engine connected and confirm deletion is rejected.
5. Inspect `data/deleted-modes.json`: schema version must be 1 and entries must
   be relative mode paths. In a disposable fixture, test invalid IDs, `..`, an
   absolute path, mixed-case extensions, file/directory reparse points, a stale
   tombstone, and a corrupt tombstone. NetF must fail closed without deleting an
   outside file. Restore fixtures from backup afterward.
6. Click **Open modes folder** and **Open app data folder**. Verify they open only
   NetF-owned directories. Attempt malformed/unknown enum values with an IPC test
   harness and verify rejection; there must be no frontend API accepting a path.
7. In Scanner, test nested executables, case-insensitive `.EXE`, duplicate names,
   inaccessible directories, directory reparse points, an empty directory, and
   result limits 1 and 5000. Verify deterministic sorting/rules, warnings, checkbox
   selection, and copied CRLF rule text. No executable may start or change.
8. In **Servers → Library**, create, edit, restart, duplicate, and confirmed-delete
   SOCKS5, Shadowsocks, VMess, VLESS, Trojan, and WireGuard entries. Exercise
   Keep saved/Replace/Clear where allowed, invalid hostnames/ports/UUIDs/ciphers/
   transport-header pairs/CIDRs/keys, deletion cancellation, timestamped backups,
   rename profile references, and connected-state rejection. Verify unsupported
   imported profiles are read-only except confirmed deletion and cannot connect.
   Import the same valid share link twice and verify a unique display name. Test
   one line at 8,192 characters, an over-limit line, multiple lines, duplicate
   query keys, malformed Base64/JSON/percent encoding, Reality/XTLS, unsupported
   transports, Shadowsocks plugin options, an unsupported scheme, bracketed IPv6,
   and an attempted import while connected. Every failure must be credential-free,
   must add no server, and must clear the paste box. Verify WireGuard is offered
   only through the manual form.
9. With the geo files absent, connect each supported Xray profile. Include at
   least one hostname-based server endpoint and verify Windows DNS resolution,
   server-route reachability/bypass, and normal traffic. Verify unsupported
   profiles fail closed and no fallback executable starts.
10. Run Process routing with a selected application and unrelated LAN/browser
   traffic. Verify TCP, UDP where supported, DNS, LAN access, and bypass behavior.
   Disconnect and compare routes, DNS servers, firewall state, services, helpers,
   and outbound behavior byte-for-byte or command-for-command with baseline.
11. Run the equivalent TUN test, including Wintun adapter creation/removal,
    default/specific server route, IPv4/IPv6, LAN bypass, DNS setup, and complete
    restoration after disconnect, connect failure, and unavailable helper.
12. While connected, hide/restore through the tray, start a second instance,
    choose normal Exit, kill Xray, kill EngineHost, then force-kill the desktop in
    separate VM snapshots. Verify focus behavior, explicit failed/unknown state,
    no orphan helpers, cleanup evidence, and no unsafe automatic reconnection.
13. Test offline startup, IPv6-only/disabled combinations, Wi-Fi plus Ethernet,
    VPN/multiple NICs, Windows sign-in auto-start, reboot after a forced failure,
    helper/driver absence, uninstall, and reinstall. Auto-start must never connect.
14. Verify a clean install uses `%LOCALAPPDATA%\io.github.amiradroit.netf`, leaves
    `%LOCALAPPDATA%\org.netchfork.preview` untouched, imports only validated settings
    and custom modes after opt-in, and never imports binaries, logs, caches, or geo data.
15. Search copied Activity output and engine logs for passwords, proxy URIs,
    UUIDs, tokens, private/pre-shared keys, authorization headers, and server
    secrets. Any credential or incomplete route/DNS/firewall cleanup is a release
    blocker and requires restoring the VM snapshot before further connection tests.

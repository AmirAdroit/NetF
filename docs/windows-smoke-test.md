# NetF Windows smoke test

Use this checklist before treating the Tauri compatibility desktop as a daily
driver. Run destructive recovery cases only in a disposable Windows VM with a
snapshot. Do not test forced termination on a host where stale DNS or routes
would interrupt important work.

## Safe host-level review

1. Close every running Netch process.
2. Keep a known-good Netch installation available as an import source. The
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
5. Open **Servers**, verify **Owned runtime**, select **Import**, choose the old
   Netch directory, and verify that server/custom-mode counts match. The webview
   must show no hostname, password, UUID, key, or subscription URL.
6. Confirm **Missing helpers** is zero. If not, stop; the selected runtime is
   incomplete and connection results are not meaningful.
7. Confirm **Core source** says **Fork package** and the proxy-core list includes
   the packaged Xray. `direct SOCKS` is built into the compatibility engine and
   does not require a proxy-core process.
8. Switch between Servers and Modes, change light/dark/system appearance, and
   resize to the minimum supported window. Check for clipped controls,
   horizontal scrolling, or selections that reset unexpectedly.
9. In **Modes**, verify names are alphabetical, search by name/path/type/origin,
   and confirm the Built-in, Imported, and User badges match their locations.
10. Save a built-in Process mode and verify a user-owned JSON copy is created
    while the built-in text template remains unchanged. Edit it again and verify
    the prior JSON is retained as `.bak`.
11. Merge a compatible source mode into the copy. Verify handled/bypass rules
    are deduplicated and an incompatible Process/TUN merge is rejected.
12. In **Settings**, change a harmless stopped-state option, save, restart, and
    verify the value persists and `data/settings.json.bak` contains the prior
    file. Restore the original value before connection testing.
13. In **Activity**, refresh and copy logs. Confirm the output is bounded and
    contains no server password, UUID, token, private key, or proxy URI.
14. Enable **Start NetF when Windows starts**, confirm the Scheduled Task is
    verified, sign out/in, and verify NetF starts in the notification area
    without opening its window or connecting. Disable it and verify removal.

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
6. Connect again, close the window, and verify routing continues with a green
   notification-area icon. Restore NetF, choose **Exit NetF**, and verify the
   engine and helper processes stop before the application exits.

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
   Confirm there is one `netch-engine-host.exe` process and no visible console
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
8. With the geo files absent, connect each supported Xray profile. Include at
   least one hostname-based server endpoint and verify Windows DNS resolution,
   server-route reachability/bypass, and normal traffic. Verify unsupported
   profiles remain on the compatibility provider rather than failing open.
9. Run Process routing with a selected application and unrelated LAN/browser
   traffic. Verify TCP, UDP where supported, DNS, LAN access, and bypass behavior.
   Disconnect and compare routes, DNS servers, firewall state, services, helpers,
   and outbound behavior byte-for-byte or command-for-command with baseline.
10. Run the equivalent TUN test, including Wintun adapter creation/removal,
    default/specific server route, IPv4/IPv6, LAN bypass, DNS setup, and complete
    restoration after disconnect, connect failure, and unavailable helper.
11. While connected, hide/restore through the tray, start a second instance,
    choose normal Exit, kill Xray, kill EngineHost, then force-kill the desktop in
    separate VM snapshots. Verify focus behavior, explicit failed/unknown state,
    no orphan helpers, cleanup evidence, and no unsafe automatic reconnection.
12. Test offline startup, IPv6-only/disabled combinations, Wi-Fi plus Ethernet,
    VPN/multiple NICs, Windows sign-in auto-start, reboot after a forced failure,
    helper/driver absence, uninstall, and reinstall. Auto-start must never connect.
13. Search copied Activity output and engine logs for passwords, proxy URIs,
    UUIDs, tokens, private/pre-shared keys, authorization headers, and server
    secrets. Any credential or incomplete route/DNS/firewall cleanup is a release
    blocker and requires restoring the VM snapshot before further connection tests.

# Windows smoke test

Use this checklist before treating the Tauri compatibility preview as a daily
driver. Run destructive recovery cases only in a disposable Windows VM with a
snapshot. Do not test forced termination on a host where stale DNS or routes
would interrupt important work.

## Safe host-level review

1. Close every running Netch process.
2. Copy a known-good Netch installation to a separate test directory. Preserve
   its `data`, `mode`, and `bin` directories together.
3. Build the preview:

   ```powershell
   cd src\Netch.Desktop
   npm run tauri:build -- --debug --no-bundle
   ```

4. Launch `src\Netch.Desktop\src-tauri\target\debug\netch-desktop.exe` and
   accept the administrator prompt.
5. Open **Servers**, choose the copied Netch directory, and verify that server
   and mode counts match the legacy UI. The webview must show no hostname,
   password, UUID, key, or subscription URL.
6. Confirm **Missing helpers** is zero. If not, stop; the selected runtime is
   incomplete and connection results are not meaningful.
7. Confirm **Core source** says **Attached runtime** and the listed proxy cores
   match the executables in that runtime's `bin` directory. `direct SOCKS` is
   built into the compatibility engine and does not require a proxy-core process.
8. Switch between Servers and Modes, change light/dark/system appearance, and
   resize to the minimum supported window. Check for clipped controls,
   horizontal scrolling, or selections that reset unexpectedly.

## Connection parity

Use a profile already proven in the legacy client. Test one mode at a time:

1. Record baseline routes, DNS servers, active adapters, relevant services, and
   outbound IP/DNS behavior.
2. Connect from the preview and verify the intended application traffic, TCP,
   UDP where applicable, and DNS behavior. Confirm unrelated applications
   follow the mode's bypass rules.
3. Disconnect from the preview. Verify proxy-core/helper processes exit and the
   recorded route, DNS, adapter, firewall, and service state returns to baseline.
4. Repeat for process mode, TUN mode, and sharing mode only when their native
   dependencies are present.
5. Compare `logging/` output with the legacy run and inspect it for credential
   leakage before sharing diagnostics.

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

# NetF troubleshooting

## Startup appears stalled

NetF reports Settings, Runtime, and Engine phases instead of blocking the
window. Open **Activity** after startup and copy the sanitized log; stage timings
separate slow runtime verification from an engine handshake failure. **Retry
startup** replaces a stopped or crashed engine host, but never an active tunnel.

## Red or unknown state

Do not assume traffic is safely disconnected. A red tray icon or **ATTENTION
REQUIRED** means NetF could not prove engine state. Restore the window, open
Activity, and attempt **Disconnect**. If cleanup fails, use the VM recovery
checks in `docs/windows-smoke-test.md` before reconnecting.

## The window disappeared

The X button intentionally hides NetF to the Windows notification area. Click
the NetF icon to restore it. Windows controls whether that icon is directly
visible or placed inside its hidden-icons overflow.

## Auto-start does not run

Open Settings and inspect the registration indicator. NetF uses the per-user
**NetF Startup** task with a logon trigger, highest run level, the installed
executable, and fixed `--autostart` argument. Toggling off and on repairs an
outdated path. Auto-start intentionally stays in the tray and does not connect.

## No console window or console output

This is expected. Both debug and release desktop executables use the Windows
GUI subsystem, and the compatibility host is spawned without a console. Use
Activity logs for diagnostics.

## Reporting a problem

Include the NetF version, startup phase, state label, mode type,
missing-capability list, and copied sanitized Activity log. Never publish raw
settings, subscription URLs, credentials, UUIDs, private keys, or unredacted
engine command lines.

## A deleted built-in mode returned

Current builds store built-in deletions in
`data/deleted-modes.json` and apply them before mode loading. Use **Modes → Open
modes folder** and **Settings → Open app data folder** rather than guessing the
runtime path. If the tombstone file is missing or invalid, do not edit it while
NetF is running; preserve the file and sanitized Activity log for diagnosis.
Deleted files are backed up under `data/deleted-mode-backups/<UTC timestamp>/`.

To intentionally restore a built-in, close NetF, back up the app-data directory,
remove only that relative entry from the tombstone with valid schema/versioned
JSON, then let runtime preparation restore the packaged template. Never replace
the whole data directory or delete the only backup.

## Startup or idle performance investigation

Activity contains credential-free timing lines for startup stages and aggregate
health probes. With NetF manually started and stopped, run
`src\Netch.Desktop\scripts\measure-performance.ps1 -SampleSeconds 600` to
capture process count, memory, and idle CPU without changing engine state.

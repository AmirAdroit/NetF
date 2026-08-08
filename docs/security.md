# Security model

## Why this application is high risk

Netch is not an ordinary desktop UI. It can run elevated, install or replace a
kernel networking driver, load native libraries, spawn proxy cores, change
routes and DNS, add firewall rules, inspect processes, and store proxy
credentials. A webview-based UI also introduces an IPC trust boundary.

The practical threat model includes:

- malicious or compromised subscription data;
- crafted share links, mode files, settings, paths, and hostnames;
- compromised frontend dependencies or injected webview content;
- replacement of bundled helpers, DLLs, or update artifacts;
- unsafe command construction and argument injection;
- credentials leaking into logs, crash reports, process arguments, or UI state;
- stale routes, DNS, firewall rules, services, or drivers after a crash;
- a local unprivileged process attempting to control an elevated engine;
- junction/reparse-point loops or inaccessible paths during directory scans.

## Security invariants

- No remote content is rendered as executable HTML.
- The frontend receives no general shell or unrestricted filesystem primitive.
- Every Tauri command validates paths, sizes, counts, enum values, and state.
- The elevated webview cannot provide an engine executable or runtime path. The
  runtime is installed from a verified packaged manifest; legacy import sources
  are selected by a native Rust-owned folder picker and are never executable.
- Sidecar executable names and argument shapes are allowlisted in native code.
- Secrets are redacted before structured logging and diagnostics export.
- Configuration writes are backed up, validated, and atomic.
- Privileged mutations have idempotent compensating cleanup.
- Release inputs are pinned and verified; runtime downloads require a signed
  manifest and cryptographic hash verification.
- Local IPC to an elevated component authenticates the client and applies a
  restrictive Windows ACL.

The current child-stdio bridge does not expose a listening IPC endpoint. When
the UI and privileged broker are separated, the named-pipe authentication and
ACL invariant above becomes mandatory before the broker is enabled.

## Scanner-specific controls

The new executable scanner:

- accepts one existing directory as its root;
- canonicalizes the root before walking;
- does not follow directory links/reparse points;
- bounds result count and returns a typed limit error;
- reports inaccessible entries instead of silently presenting a complete scan;
- treats `.exe` case-insensitively;
- emits escaped rule text rather than evaluating a regular expression;
- sorts and deduplicates results for deterministic review.

It intentionally does not inspect file signatures or trust executables. Finding
a filename means only that the file exists in the selected tree.

## Known gaps inherited from upstream

- Build scripts download mutable third-party content without a pinned digest.
- The binary provenance and redistribution terms need a complete audit; the
  existing NOTICE includes at least one unknown license entry.
- The legacy process runs entirely as administrator.
- Engine code and UI code are coupled through global mutable state.
- Some secrets may be passed to child processes or retained in settings.
- Automated tests do not currently validate route/DNS/firewall rollback.
- The updater needs a fresh authenticity and rollback design before reuse.

These are release blockers for a public stable build, not reasons to discard the
working behavior before replacements exist.

## Required integration tests

Use disposable Windows VMs with snapshots for tests that mutate the host:

- clean install and first run;
- driver install, upgrade, downgrade rejection, and removal;
- process mode TCP/UDP/DNS routing and bypass rules;
- TUN mode route and DNS setup/teardown;
- normal disconnect, startup failure at every stage, process crash, forced kill,
  reboot recovery, and uninstall;
- metered/offline/multi-NIC/IPv6 scenarios;
- malicious configuration, subscription, and IPC inputs;
- verification that diagnostics and logs contain no credentials.

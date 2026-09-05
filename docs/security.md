# Security model

## Why this application is high risk

NetF is not an ordinary desktop UI. It can run elevated, install or replace a
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
- Windows auto-start uses one fixed per-user Task Scheduler name and the
  internally resolved NetF executable. The frontend supplies only an enabled
  boolean; registration is verified before the setting is persisted. Quoted and
  `\\?\` device paths are normalized before comparison, and the principal is
  verified against the current Windows SID instead of display-name text alone.
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

Server, mode, and settings management expose typed fields only and require a
stopped/failed engine. Server details return secret-presence booleans rather than
saved passwords, UUIDs, private keys, or pre-shared keys. Secret mutations use
the closed `keep`, `replace`, or `clear` enum; unsupported imported provider
shapes are read-only and cannot be connected or duplicated. Provider, endpoint,
port, UUID, cipher, transport/header, TLS, WireGuard CIDR/key, and state checks
are repeated in the .NET authority before atomic persistence.

Latency testing accepts only an integer server ID from the webview. The .NET
authority reads the saved hostname and port, applies bounded DNS and three
bounded TCP/ICMP probes, caps all-server concurrency, prevents overlapping test
batches, and cancels live probes before cleanup. Results contain only ID,
method, status, milliseconds, and timestamp. They do not contain the endpoint or
credentials and must not be described as proxy authentication or traffic proof.

Single-server share-link import is an explicit exception to the rule that saved
secrets never enter React: a newly pasted URI necessarily exists briefly in the
paste box and typed Tauri request. The control accepts exactly one non-empty URI
of at most 8,192 characters and clears it before awaiting the engine response.
Rust repeats the size/single-line bound; the .NET authority allowlists VLESS,
VMess, Trojan, Shadowsocks, and SOCKS5 schemes, parses offline, rejects unknown
or duplicate options, and reuses the normal provider compatibility gate. The
request and parser never log or echo the link, and responses contain only secret
presence flags. Subscription fetching, multi-line import, Shadowsocks plugins,
Reality/XTLS options, and non-standard WireGuard URI guessing remain disabled.

Process and TUN rule lists are bounded to 10,000 entries with bounded line lengths, filenames are
sanitized under owned mode directories, and reparse-point paths are rejected.
Built-in templates are never overwritten by the UI. A confirmed deletion is a
separate stopped-state operation: it uses only a mode ID, validates the resolved
owned path, rejects traversal/reparse points, flushes a timestamped backup, and
persists built-in deletion in an atomic versioned tombstone. Share-mode helper arguments
are read-only because a generic argument editor would turn the elevated engine
into an unsafe command-construction surface.

The Activity API reads only a bounded tail of the owned runtime's application
log. It limits returned lines and bytes and redacts credential-bearing URIs,
passwords, tokens, UUIDs, private/pre-shared keys, and authorization values
before data crosses the engine boundary. Sanitization reduces exposure but does
not replace the release-gate credential-leak tests below.

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

The only frontend folder-open command accepts the closed enum `modes` or
`appData`. Rust resolves the directory internally, verifies it stays beneath
NetF-owned app data, rejects reparse points, and starts `explorer.exe` directly
without a shell or frontend-controlled argument path.

Previous-data import accepts no frontend path. Rust resolves only the fixed
`%LOCALAPPDATA%\org.netchfork.preview\runtime` source beside the current
`io.github.amiradroit.netf` identity. Import reads validated settings and custom
modes transactionally and never copies old binaries, DLLs, logs, caches, or geo
assets. The previous directory is not modified.

## Known gaps inherited from upstream

- Build scripts download mutable third-party content without a pinned digest.
- The binary provenance and redistribution terms need a complete audit; the
  existing NOTICE includes at least one unknown license entry.
- The legacy process runs entirely as administrator.
- The full elevated NetF UI remains a compatibility architecture; an
  authenticated privileged broker is required before calling it least-privilege.
- Engine code and UI code are coupled through global mutable state.
- Some secrets may be passed to child processes or retained in settings.
- Automated tests do not currently validate route/DNS/firewall rollback.
- The updater needs a fresh authenticity and rollback design before reuse.
- TCP reachability can be misleading for UDP-only WireGuard endpoints; ICMP is
  the appropriate optional endpoint signal when the host/provider permits it.

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
- hostile share links including oversized input, multiple lines, duplicate
  parameters, malformed Base64/JSON/percent encoding, unsupported schemes and
  transports, plugin/Reality options, IPv6 endpoints, and credential redaction;
- verification that diagnostics and logs contain no credentials.

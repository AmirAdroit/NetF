# Compatibility matrix

This is the initial audited matrix, not a claim of complete feature parity. The
upstream `1.9.7` tag is the last stable-line comparison point; current `main` is
the unfinished 2.0 line and directly descends from that tag.

| Capability | Legacy code in current checkout | Modern desktop | Migration requirement |
| --- | --- | --- | --- |
| Process-mode executable scan | Yes; recursive filename rules, 50-result limit | Yes; compatible rules with review, warnings, deterministic output, link protection | Validate against real game/app trees |
| Process traffic interception | `NFController` + `Redirector.bin` + NetFilter driver | Connect command wired through headless host | Driver lifecycle, traffic, and crash-recovery VM tests |
| TUN routing | Owned Wintun/tun2socks + compiled RouteHelper | Connect command wired through headless host; direct configured-DNS fallback when aiodns is unavailable | Route/DNS transaction and recovery VM tests; restore audited split DNS helper |
| Network sharing | `PcapController` + pcap2socks/Npcap | Headless controller path wired | Npcap dependency and traffic/cleanup VM tests |
| Manual server management | Original provider-specific forms | Compact searchable create/edit/duplicate/confirmed-delete for SOCKS5, Shadowsocks, VMess, VLESS, Trojan, and WireGuard; credentials stay inside the engine | Complete the manual Windows provider matrix and malformed-corpus testing |
| SOCKS5/Shadowsocks/VMess/VLESS/Trojan/WireGuard | Compatible shapes select packaged pinned Xray `v26.3.27` | Typed forms constrain cipher, transport/header, TLS, UUID, CIDR, and key shapes; connect path wired | Config validation and TCP loopback traffic pass; add UDP and Windows route tests |
| SSR/SSH/legacy H2, QUIC, mKCP, XTLS, SOCKS4a/plugins | Legacy behavior documented | Visible as read-only imported profiles; connect/edit/duplicate fail closed; confirmed delete remains available | Package and audit a provider behind `EngineBackend` before enabling any shape |
| Server subscriptions/share links | Present | Strict offline single-link import for VLESS, VMess, Trojan, Shadowsocks, and SOCKS5; no subscription fetch or batch import | Expand hostile-input/fuzz corpus before adding bounded transactional subscriptions |
| Endpoint latency | Three TCP/ICMP probes plus legacy periodic selected-server interval | Selected and all-server tests; credential-free success/timeout/DNS/error results; optional cancellable connected-server monitor | Manual Windows TCP/ICMP/provider matrix; this does not assert proxy authentication |
| NAT/STUN tests | Present | Intentionally excluded until an owned NAT-test feature exists | Typed result model, bounded network authority, and privacy review |
| Mode file loading | Text and JSON mode formats | Typed detail/list API; searchable alphabetical UI with composable Built-in/Imported/User filter chips | Localization fallbacks, malformed full-corpus testing, and event-driven refresh |
| Mode file writing | Present through UI/service | Process/TUN create/edit, built-in copy-on-customize, compatible merge, `.bak` plus atomic replace | Full corpus round-trip and privileged traffic parity for edited rules |
| Settings persistence | `data/settings.json` with validated atomic replacement and `.bak` rollback | Typed listener, Process child routing, TUN adapter/custom DNS, endpoint testing, redirector, and Xray subset with the same durable write policy | Privileged Process/TUN traffic and rollback matrix |
| Localization | Existing `Storage/i18n` assets | English NetF UI | Key inventory and encoding/fallback tests |
| Tray/autostart/update | Present in inherited UI | Configurable hide-to-tray or cleanup-and-exit close; second-instance focus; single-flight explicit exit; fixed verified `NetF Startup` task; updater excluded | Cleanup-failure/portable-move/uninstall tests; signed update design and non-admin UI lifecycle |
| Bandwidth/status/log UI | Present but partly coupled to `Global.MainForm` | Start/stop and readiness overview; bounded sanitized application-log tail | Typed live events, bandwidth, structured diagnostics export |

## Scanner compatibility details

The old scanner walks all subdirectories, selects `.exe` filenames, escapes a
specific set of C++ regex metacharacters, and appends one rule per line. It does
not store the executable's full path.

The modern scanner intentionally preserves filename-based rules and the same
escape set. Differences are deliberate:

- `.EXE` and other casing variants are accepted;
- duplicate filenames are collapsed because they produce identical legacy
  matching behavior;
- results and warnings are deterministic;
- inaccessible descendants are reported instead of aborting the whole scan;
- filesystem reparse points are skipped to prevent loops or scope surprises;
- exceeding the selected unique-result limit returns an actionable error.

Before production use, run the scanner against a corpus of copied application
directories and compare generated rule behavior through the native redirector,
not only string output.

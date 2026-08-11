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
| SOCKS5 server input | Present | Imported into owned runtime; direct connect path wired | Real owned-runtime process-routing smoke test |
| SOCKS5/Shadowsocks/VMess/VLESS/Trojan/WireGuard | Compatible shapes select packaged pinned Xray `v26.3.27` | Connect path wired | Config validation and TCP loopback traffic pass; add UDP and Windows route tests |
| SSR/SSH/legacy H2, QUIC, mKCP, XTLS, SOCKS4a | Legacy behavior documented | Disabled when no owned compatibility provider is packaged | Build/audit an owned fallback and retain fail-closed selection |
| Server subscriptions/share links | Present | Not connected | Malicious-input tests and secret-safe diagnostics |
| Latency and NAT tests | Present | Not connected | Cancellation/timeouts and structured result events |
| Mode file loading | Text and JSON mode formats | Typed detail/list API; searchable alphabetical UI with built-in/imported/user origin | Localization fallbacks, malformed full-corpus testing, and event-driven refresh |
| Mode file writing | Present through UI/service | Process/TUN create/edit, built-in copy-on-customize, compatible merge, `.bak` plus atomic replace | Full corpus round-trip and privileged traffic parity for edited rules |
| Settings persistence | `data/settings.json` with validated atomic replacement and `.bak` rollback | Typed listener/redirector/DNS/Xray subset enabled with the same durable write policy | Schema versions and broader settings round-trip corpus |
| Localization | Existing `Storage/i18n` assets | English preview only | Key inventory and encoding/fallback tests |
| Tray/autostart/update | Present in legacy UI | Not connected | Signed update design and non-admin UI lifecycle |
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

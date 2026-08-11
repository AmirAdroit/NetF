# Protocol modernization

Protocol support is an engine feature, not a UI checkbox. A protocol is not
listed as supported until Netch can parse its share/config form, validate its
settings, generate a provider config, start the pinned provider, pass traffic,
stop it, and restore Windows networking state after both normal and forced
termination.

## Provider strategy

The legacy application builds a modified SagerNet V2Ray core at version
`v5.0.16` and injects ShadowsocksR/simple-obfs code from mutable gist URLs. That
path is retained only for existing compatibility while it is tested. It is not
an acceptable source for new protocol work.

The first validated compatibility provider is official Xray-core `v26.3.27`, pinned by
release URL, tag object, artifact name, and SHA-256 in
`third_party/proxy-cores.json`. It is intended to cover the existing SOCKS5,
Shadowsocks, VMess, VLESS, Trojan, and WireGuard configurations before enabling
VLESS Vision, REALITY, or XHTTP. Current tests validate configuration for all
six listed protocols and real loopback TCP traffic for SOCKS5, Shadowsocks,
VMess, VLESS, and Trojan. WireGuard config validation passes, but its UDP data
path still needs a dedicated test. ShadowsocksR deliberately remains on the
legacy provider until a tested replacement or explicit retirement policy
exists.

sing-box is a candidate for Hysteria2, TUIC, and AnyTLS. It is not approved for
bundling: GitHub reports no SPDX classification and its license contains an
additional name/association condition. Distribution requires a documented
license review first.

## Compatibility gates

For every provider update:

1. Verify the source tag, release asset, license, and SHA-256 manifest.
2. Generate configs for every existing protocol/transport/security fixture.
3. Run the provider's config validation command for every generated config.
4. Start a local client/server test pair on dynamically allocated ports.
5. Verify TCP and UDP where the protocol claims both.
6. Force-kill the client during startup and active traffic; confirm child
   processes, routes, DNS, firewall state, services, and temporary files are
   restored.
7. Run a Windows VM matrix covering the supported OS floor and current Windows.
8. Keep the previous provider available for rollback for at least one release.

During this compatibility rollout, provider selection is deterministic and
fail-closed: Xray is selected only when its separate executable is present and
the saved profile shape is on the validated allowlist. All other profiles use
the unchanged legacy provider. A future schema will persist an explicit
per-server override before more than one modern provider can serve a profile.

## Planned order

1. Existing Xray-compatible protocols and transports.
2. VLESS Vision + REALITY over TCP.
3. XHTTP transport.
4. Hysteria2.
5. TUIC.
6. AnyTLS.

This order limits simultaneous unknowns. New transports are validated on top of
an already working protocol before additional providers are introduced.

## Updating a provider

- Change the version, immutable tag object, release URL, artifact URL, and
  SHA-256 together in `third_party/proxy-cores.json`.
- Mirror the Xray values in `Other/xray-core/fetch.ps1`.
- Review upstream release notes and license changes.
- Re-run all compatibility gates above.
- Record the result and rollback version in `CHANGELOG.md`.

Do not replace `v2ray-sn.exe` in place. The modern provider uses a distinct
executable name and an explicit controller so legacy profiles remain
recoverable.

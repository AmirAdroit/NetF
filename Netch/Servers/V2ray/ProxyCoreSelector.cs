using Netch.Models;

namespace Netch.Servers;

public static class ProxyCoreSelector
{
    private static readonly HashSet<string> XrayShadowsocksMethods = new(StringComparer.Ordinal)
    {
        "2022-blake3-aes-128-gcm",
        "2022-blake3-aes-256-gcm",
        "2022-blake3-chacha20-poly1305",
        "aes-128-gcm",
        "aes-256-gcm",
        "chacha20-poly1305",
        "chacha20-ietf-poly1305",
        "xchacha20-poly1305",
        "xchacha20-ietf-poly1305"
    };

    private static readonly HashSet<string> XrayLegacyTransports = new(StringComparer.Ordinal)
    {
        "tcp",
        "ws",
        "grpc"
    };

    public static bool CanUseXray(Server server)
    {
        return server switch
        {
            Socks5Server socks => socks.Version == "5",
            ShadowsocksServer shadowsocks =>
                !shadowsocks.HasPlugin() && XrayShadowsocksMethods.Contains(shadowsocks.EncryptMethod),
            ShadowsocksRServer => false,
            SSHServer => false,
            TrojanServer trojan => trojan.TLSSecureType != "xtls",
            VMessServer vmess =>
                vmess.TLSSecureType != "xtls" && XrayLegacyTransports.Contains(vmess.TransferProtocol),
            WireGuardServer => true,
            _ => false
        };
    }

    public static ProxyCoreFlavor Select(Server server, bool xrayExecutableAvailable)
    {
        return xrayExecutableAvailable && CanUseXray(server)
            ? ProxyCoreFlavor.Xray
            : ProxyCoreFlavor.LegacySagerNet;
    }
}

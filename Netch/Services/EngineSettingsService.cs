using System.Net;
using Netch.Models;
using Netch.Utils;

namespace Netch.Services;

public sealed record EngineSettingsSnapshot(
    string LocalAddress,
    ushort Socks5LocalPort,
    ushort HttpLocalPort,
    int RequestTimeout,
    bool ServerTcpPing,
    bool FilterTcp,
    bool FilterUdp,
    bool FilterDns,
    bool HandleOnlyDns,
    bool DnsProxy,
    string DnsHost,
    bool FilterIcmp,
    int IcmpDelay,
    bool AllowInsecure,
    bool UseMux,
    bool XrayCone,
    bool TcpFastOpen);

public static class EngineSettingsService
{
    public static EngineSettingsSnapshot Get()
    {
        var settings = Global.Settings;
        return new EngineSettingsSnapshot(
            settings.LocalAddress,
            settings.Socks5LocalPort,
            settings.HTTPLocalPort,
            settings.RequestTimeout,
            settings.ServerTCPing,
            settings.Redirector.FilterTCP,
            settings.Redirector.FilterUDP,
            settings.Redirector.FilterDNS,
            settings.Redirector.HandleOnlyDNS,
            settings.Redirector.DNSProxy,
            settings.Redirector.DNSHost,
            settings.Redirector.FilterICMP,
            settings.Redirector.ICMPDelay,
            settings.V2RayConfig.AllowInsecure,
            settings.V2RayConfig.UseMux,
            settings.V2RayConfig.XrayCone,
            settings.V2RayConfig.TCPFastOpen);
    }

    public static async Task<EngineSettingsSnapshot> UpdateAsync(EngineSettingsSnapshot request)
    {
        Validate(request);
        await Configuration.UpdateAsync(settings => Apply(settings, request));
        return Get();
    }

    private static void Validate(EngineSettingsSnapshot request)
    {
        if (!IPAddress.TryParse(request.LocalAddress, out _))
            throw new InvalidDataException("Local proxy address must be a literal IPv4 or IPv6 address.");
        if (request.Socks5LocalPort == 0 || request.HttpLocalPort == 0
            || request.Socks5LocalPort == request.HttpLocalPort)
            throw new InvalidDataException("SOCKS5 and HTTP ports must be different non-zero ports.");
        if (request.RequestTimeout is < 1_000 or > 120_000)
            throw new InvalidDataException("Request timeout must be between 1000 and 120000 milliseconds.");
        if (!IPEndPoint.TryParse(request.DnsHost, out var dns) || dns.Port == 0)
            throw new InvalidDataException("Redirector DNS must be an IP endpoint such as 1.1.1.1:53.");
        if (request.IcmpDelay is < 0 or > 10_000)
            throw new InvalidDataException("ICMP delay must be between 0 and 10000 milliseconds.");
    }

    private static void Apply(Setting settings, EngineSettingsSnapshot request)
    {
        settings.LocalAddress = request.LocalAddress;
        settings.Socks5LocalPort = request.Socks5LocalPort;
        settings.HTTPLocalPort = request.HttpLocalPort;
        settings.RequestTimeout = request.RequestTimeout;
        settings.ServerTCPing = request.ServerTcpPing;
        settings.Redirector.FilterTCP = request.FilterTcp;
        settings.Redirector.FilterUDP = request.FilterUdp;
        settings.Redirector.FilterDNS = request.FilterDns;
        settings.Redirector.HandleOnlyDNS = request.HandleOnlyDns;
        settings.Redirector.DNSProxy = request.DnsProxy;
        settings.Redirector.DNSHost = request.DnsHost;
        settings.Redirector.FilterICMP = request.FilterIcmp;
        settings.Redirector.ICMPDelay = request.IcmpDelay;
        settings.V2RayConfig.AllowInsecure = request.AllowInsecure;
        settings.V2RayConfig.UseMux = request.UseMux;
        settings.V2RayConfig.XrayCone = request.XrayCone;
        settings.V2RayConfig.TCPFastOpen = request.TcpFastOpen;
    }
}

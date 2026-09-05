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
    bool FilterParent,
    bool FilterIcmp,
    int IcmpDelay,
    string TunAddress,
    string TunNetmask,
    string TunGateway,
    bool TunUseCustomDns,
    string TunDns,
    bool TunProxyDns,
    int LiveLatencyIntervalSeconds,
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
            settings.Redirector.FilterParent,
            settings.Redirector.FilterICMP,
            settings.Redirector.ICMPDelay,
            settings.TUNTAP.Address,
            settings.TUNTAP.Netmask,
            settings.TUNTAP.Gateway,
            settings.TUNTAP.UseCustomDNS,
            settings.TUNTAP.DNS,
            settings.TUNTAP.ProxyDNS,
            settings.StartedPingInterval,
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
        var address = ParseIpv4(request.TunAddress, "TUN address");
        var gateway = ParseIpv4(request.TunGateway, "TUN gateway");
        var mask = ParseIpv4(request.TunNetmask, "TUN netmask");
        var maskValue = ToUInt32(mask);
        var inverted = ~maskValue;
        if ((inverted & (inverted + 1)) != 0)
            throw new InvalidDataException("TUN netmask must be contiguous.");
        if ((ToUInt32(address) & maskValue) != (ToUInt32(gateway) & maskValue))
            throw new InvalidDataException("TUN address and gateway must use the same subnet.");
        if (request.TunUseCustomDns)
            _ = ParseIpv4(request.TunDns, "TUN DNS");
        if (request.TunProxyDns && !request.TunUseCustomDns)
            throw new InvalidDataException("Proxy DNS requires custom TUN DNS to be enabled.");
        if (request.LiveLatencyIntervalSeconds is < -1 or > 3600)
            throw new InvalidDataException("Live latency interval must be disabled (-1 or 0) or between 1 and 3600 seconds.");
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
        settings.Redirector.FilterParent = request.FilterParent;
        settings.Redirector.FilterICMP = request.FilterIcmp;
        settings.Redirector.ICMPDelay = request.IcmpDelay;
        settings.TUNTAP.Address = request.TunAddress;
        settings.TUNTAP.Netmask = request.TunNetmask;
        settings.TUNTAP.Gateway = request.TunGateway;
        settings.TUNTAP.UseCustomDNS = request.TunUseCustomDns;
        settings.TUNTAP.DNS = request.TunDns;
        settings.TUNTAP.ProxyDNS = request.TunProxyDns;
        settings.StartedPingInterval = request.LiveLatencyIntervalSeconds == 0 ? -1 : request.LiveLatencyIntervalSeconds;
        settings.V2RayConfig.AllowInsecure = request.AllowInsecure;
        settings.V2RayConfig.UseMux = request.UseMux;
        settings.V2RayConfig.XrayCone = request.XrayCone;
        settings.V2RayConfig.TCPFastOpen = request.TcpFastOpen;
    }

    private static IPAddress ParseIpv4(string value, string label)
    {
        if (!IPAddress.TryParse(value, out var address)
            || address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
            throw new InvalidDataException($"{label} must be a literal IPv4 address.");
        return address;
    }

    private static uint ToUInt32(IPAddress address)
    {
        var bytes = address.GetAddressBytes();
        return ((uint)bytes[0] << 24) | ((uint)bytes[1] << 16) | ((uint)bytes[2] << 8) | bytes[3];
    }
}

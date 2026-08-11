using Microsoft.VisualStudio.TestTools.UnitTesting;
using Netch.Interfaces;
using Netch.Servers;
using Netch.Services;
using Netch.Utils;

namespace Tests;

[TestClass]
public class CompatibilityTests
{
    private sealed class RecordingObserver : IEngineObserver
    {
        public List<string?> Statuses { get; } = new();

        public void StatusChanged(string? status)
        {
            Statuses.Add(status);
        }
    }

    [TestMethod]
    public void VlessUuidMappingRemainsCompatible()
    {
        Assert.AreEqual("feb54431-301b-52bb-a6dd-e1e93e81bb9e", "example".GenerateUUIDv5());
    }

    [TestMethod]
    public void EngineStatusIsDeliveredWithoutAFormDependency()
    {
        var originalObserver = EngineEvents.Observer;
        var observer = new RecordingObserver();

        try
        {
            EngineEvents.Observer = observer;
            EngineEvents.ReportStatus("Starting proxy core");
            EngineEvents.ReportStatus(null);

            CollectionAssert.AreEqual(
                new string?[] { "Starting proxy core", null },
                observer.Statuses);
        }
        finally
        {
            EngineEvents.Observer = originalObserver;
        }
    }

    [TestMethod]
    public async Task LegacyWireGuardShapeRemainsAvailableAsync()
    {
        var server = new WireGuardServer
        {
            Hostname = "127.0.0.1",
            Port = 51820,
            LocalAddresses = "172.16.0.2/32",
            PeerPublicKey = "peer-key",
            PrivateKey = "private-key"
        };

        var config = await V2rayConfigUtils.GenerateClientConfigAsync(
            server,
            ProxyCoreFlavor.LegacySagerNet);
        var settings = config.outbounds.Single().settings;

        Assert.AreEqual("127.0.0.1", settings.address);
        Assert.AreEqual((ushort)51820, settings.port);
        CollectionAssert.AreEqual(
            new[] { "172.16.0.2/32" },
            settings.localAddresses);
        Assert.AreEqual("peer-key", settings.peerPublicKey);
        Assert.AreEqual("private-key", settings.privateKey);
        Assert.IsNull(settings.peers);
    }

    [TestMethod]
    public void XraySelectionFailsClosedForKnownIncompatibilities()
    {
        foreach (var transport in new[] { "h2", "kcp", "quic" })
        {
            Assert.IsFalse(ProxyCoreSelector.CanUseXray(new VLESSServer
            {
                TransferProtocol = transport
            }), transport);
        }

        Assert.IsFalse(ProxyCoreSelector.CanUseXray(new VLESSServer
        {
            TLSSecureType = "xtls"
        }));
        Assert.IsFalse(ProxyCoreSelector.CanUseXray(new Socks5Server
        {
            Version = "4a"
        }));
        Assert.IsFalse(ProxyCoreSelector.CanUseXray(new ShadowsocksRServer()));
        Assert.IsFalse(ProxyCoreSelector.CanUseXray(new SSHServer()));
        Assert.IsFalse(ProxyCoreSelector.CanUseXray(new ShadowsocksServer
        {
            EncryptMethod = "aes-256-cfb"
        }));
    }

    [TestMethod]
    public void XraySelectionAllowsOnlyValidatedLegacyShapes()
    {
        Assert.IsTrue(ProxyCoreSelector.CanUseXray(new Socks5Server()));
        Assert.IsTrue(ProxyCoreSelector.CanUseXray(new ShadowsocksServer
        {
            EncryptMethod = "aes-256-gcm"
        }));
        Assert.IsTrue(ProxyCoreSelector.CanUseXray(new VMessServer
        {
            TransferProtocol = "ws"
        }));
        Assert.IsTrue(ProxyCoreSelector.CanUseXray(new VLESSServer
        {
            TransferProtocol = "grpc"
        }));
        Assert.IsTrue(ProxyCoreSelector.CanUseXray(new TrojanServer()));
        Assert.IsTrue(ProxyCoreSelector.CanUseXray(new WireGuardServer()));
    }

    [TestMethod]
    public void ProxyCoreSelectionRequiresBothCompatibilityAndTheVerifiedBinary()
    {
        var compatible = new VLESSServer { TransferProtocol = "ws" };
        var incompatible = new VLESSServer { TransferProtocol = "h2" };

        Assert.AreEqual(
            ProxyCoreFlavor.LegacySagerNet,
            ProxyCoreSelector.Select(compatible, xrayExecutableAvailable: false));
        Assert.AreEqual(
            ProxyCoreFlavor.LegacySagerNet,
            ProxyCoreSelector.Select(incompatible, xrayExecutableAvailable: true));
        Assert.AreEqual(
            ProxyCoreFlavor.Xray,
            ProxyCoreSelector.Select(compatible, xrayExecutableAvailable: true));
    }
}

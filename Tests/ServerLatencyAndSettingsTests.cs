using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Netch.Models;
using Netch.Servers;
using Netch.Services;
using Netch.Utils;
using Global = Netch.Global;

namespace Tests;

[TestClass]
[DoNotParallelize]
public class ServerLatencyAndSettingsTests
{
    [TestMethod]
    public async Task TcpLatencyUsesThreeBoundedEndpointProbesAsync()
    {
        await WithRuntimeAsync(async () =>
        {
            using var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            var port = (ushort)((IPEndPoint)listener.LocalEndpoint).Port;
            Global.Settings.ServerTCPing = true;
            Global.Settings.Server.Add(new Socks5Server
            {
                Remark = "loopback",
                Hostname = "127.0.0.1",
                Port = port,
                Version = "5"
            });

            var accepted = Enumerable.Range(0, 3).Select(async _ =>
            {
                using var client = await listener.AcceptTcpClientAsync().WaitAsync(TimeSpan.FromSeconds(3));
            }).ToArray();
            var result = await ServerLatencyService.TestAsync(0);
            await Task.WhenAll(accepted);

            Assert.AreEqual("success", result.Status);
            Assert.AreEqual("tcp", result.Method);
            Assert.IsNotNull(result.LatencyMs);
            Assert.AreEqual(0, result.ServerId);
            Assert.AreEqual(result, ServerLatencyService.GetLatest(Global.Settings.Server[0], 0));
        });
    }

    [TestMethod]
    public async Task TestAllReturnsCredentialFreeOrderedResultsAsync()
    {
        await WithRuntimeAsync(async () =>
        {
            using var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            var port = (ushort)((IPEndPoint)listener.LocalEndpoint).Port;
            Global.Settings.ServerTCPing = true;
            Global.Settings.Server.Add(new Socks5Server { Remark = "one", Hostname = "127.0.0.1", Port = port, Version = "5", Password = "never-return-this" });
            Global.Settings.Server.Add(new Socks5Server { Remark = "two", Hostname = "127.0.0.1", Port = port, Version = "5", Password = "never-return-this-either" });

            var accepted = Enumerable.Range(0, 6).Select(async _ =>
            {
                using var client = await listener.AcceptTcpClientAsync().WaitAsync(TimeSpan.FromSeconds(3));
            }).ToArray();
            var batch = await ServerLatencyService.TestAllAsync();
            await Task.WhenAll(accepted);

            Assert.AreEqual(2, batch.Total);
            Assert.IsFalse(batch.TimedOut);
            CollectionAssert.AreEqual(new[] { 0, 1 }, batch.Results.Select(result => result.ServerId).ToArray());
            var json = JsonSerializer.Serialize(batch);
            Assert.IsFalse(json.Contains("never-return-this", StringComparison.Ordinal));
            Assert.IsTrue(batch.Results.All(result => result.Status == "success" && result.Method == "tcp"));
        });
    }

    [TestMethod]
    public async Task IcmpLoopbackAndDnsFailureReturnDistinctStatusesAsync()
    {
        await WithRuntimeAsync(async () =>
        {
            Global.Settings.ServerTCPing = false;
            Global.Settings.Server.Add(new Socks5Server { Remark = "icmp", Hostname = "127.0.0.1", Port = 9, Version = "5" });
            Global.Settings.Server.Add(new Socks5Server { Remark = "dns", Hostname = "endpoint-does-not-exist.invalid", Port = 443, Version = "5" });

            var icmp = await ServerLatencyService.TestAsync(0);
            var dns = await ServerLatencyService.TestAsync(1);

            Assert.AreEqual("icmp", icmp.Method);
            Assert.AreEqual("success", icmp.Status);
            Assert.IsNotNull(icmp.LatencyMs);
            Assert.AreEqual("dnsFailure", dns.Status);
            Assert.IsNull(dns.LatencyMs);
        });
    }

    [TestMethod]
    public async Task ClosedTcpEndpointReturnsTimeoutWithoutLeakingEndpointDetailsAsync()
    {
        await WithRuntimeAsync(async () =>
        {
            using var reservation = new TcpListener(IPAddress.Loopback, 0);
            reservation.Start();
            var port = (ushort)((IPEndPoint)reservation.LocalEndpoint).Port;
            reservation.Stop();
            Global.Settings.ServerTCPing = true;
            Global.Settings.Server.Add(new Socks5Server { Remark = "closed", Hostname = "127.0.0.1", Port = port, Version = "5" });

            var result = await ServerLatencyService.TestAsync(0);

            Assert.AreEqual("timeout", result.Status);
            Assert.IsNull(result.LatencyMs);
            Assert.IsFalse(JsonSerializer.Serialize(result).Contains(port.ToString(), StringComparison.Ordinal));
        });
    }

    [TestMethod]
    public async Task InvalidServerAndCancellationAreRejectedAsync()
    {
        await WithRuntimeAsync(async () =>
        {
            await Assert.ThrowsExactlyAsync<InvalidDataException>(() => ServerLatencyService.TestAsync(4));
            using var cancelled = new CancellationTokenSource();
            await cancelled.CancelAsync();
            await Assert.ThrowsAsync<OperationCanceledException>(() => ServerLatencyService.TestAllAsync(cancelled.Token));
        });
    }

    [TestMethod]
    public async Task SupportedSettingsPersistAtomicallyAndNormalizeLegacyDisabledIntervalAsync()
    {
        await WithRuntimeAsync(async () =>
        {
            var request = EngineSettingsService.Get() with
            {
                FilterParent = true,
                TunAddress = "10.42.0.2",
                TunNetmask = "255.255.255.0",
                TunGateway = "10.42.0.1",
                TunUseCustomDns = true,
                TunDns = "1.1.1.1",
                TunProxyDns = true,
                LiveLatencyIntervalSeconds = 0
            };

            var saved = await EngineSettingsService.UpdateAsync(request);

            Assert.IsTrue(saved.FilterParent);
            Assert.AreEqual("10.42.0.2", saved.TunAddress);
            Assert.IsTrue(saved.TunProxyDns);
            Assert.AreEqual(-1, saved.LiveLatencyIntervalSeconds);
            Assert.IsTrue(File.Exists(Path.Combine(Global.NetchDir, "data", "settings.json")));
            Assert.IsTrue(File.Exists(Path.Combine(Global.NetchDir, "data", "settings.json.bak")));
        });
    }

    [TestMethod]
    [DataRow("10.42.0.2", "255.0.255.0", "10.42.0.1", true, "1.1.1.1", true, -1)]
    [DataRow("10.42.0.2", "255.255.255.0", "10.43.0.1", true, "1.1.1.1", true, -1)]
    [DataRow("not-an-ip", "255.255.255.0", "10.42.0.1", true, "1.1.1.1", true, -1)]
    [DataRow("10.42.0.2", "255.255.255.0", "10.42.0.1", true, "dns.example", true, -1)]
    [DataRow("10.42.0.2", "255.255.255.0", "10.42.0.1", false, "1.1.1.1", true, -1)]
    [DataRow("10.42.0.2", "255.255.255.0", "10.42.0.1", true, "1.1.1.1", true, 3601)]
    public async Task InvalidTunAndLatencySettingsAreRejectedWithoutMutationAsync(
        string address,
        string netmask,
        string gateway,
        bool customDns,
        string dns,
        bool proxyDns,
        int interval)
    {
        await WithRuntimeAsync(async () =>
        {
            var before = EngineSettingsService.Get();
            var request = before with
            {
                TunAddress = address,
                TunNetmask = netmask,
                TunGateway = gateway,
                TunUseCustomDns = customDns,
                TunDns = dns,
                TunProxyDns = proxyDns,
                LiveLatencyIntervalSeconds = interval
            };

            await Assert.ThrowsExactlyAsync<InvalidDataException>(() => EngineSettingsService.UpdateAsync(request));
            Assert.AreEqual(before, EngineSettingsService.Get());
        });
    }

    private static async Task WithRuntimeAsync(Func<Task> test)
    {
        var originalRoot = Global.NetchDir;
        var originalExecutable = Global.NetchExecutable;
        var originalSettings = Global.Settings;
        var runtime = Path.Combine(Path.GetTempPath(), $"netf-latency-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(runtime, "data"));
        try
        {
            Global.ConfigureRuntimeRoot(runtime, Path.Combine(runtime, "NetF.exe"));
            Global.Settings = new Setting();
            ServerLatencyService.Clear();
            await Configuration.SaveAsync();
            await test();
        }
        finally
        {
            ServerLatencyService.Clear();
            Global.Settings = originalSettings;
            if (Directory.Exists(originalRoot))
                Global.ConfigureRuntimeRoot(originalRoot, originalExecutable);
            if (Directory.Exists(runtime))
                Directory.Delete(runtime, recursive: true);
        }
    }
}

using System.Diagnostics;
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Netch.Models;
using Netch.Servers;

namespace Tests;

[TestClass]
public class XrayProviderCompatibilityTests
{
    private const string XrayPathVariable = "NETCH_XRAY_PATH";
    private static string? _isolatedDirectory;
    private static string? _isolatedXrayPath;

    [ClassInitialize]
    public static void PrepareIsolatedXray(TestContext _)
    {
        var source = Environment.GetEnvironmentVariable(XrayPathVariable);
        if (string.IsNullOrWhiteSpace(source) || !File.Exists(source))
            return;
        _isolatedDirectory = Path.Combine(Path.GetTempPath(), $"netch-xray-isolated-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_isolatedDirectory);
        _isolatedXrayPath = Path.Combine(_isolatedDirectory, "xray.exe");
        File.Copy(source, _isolatedXrayPath);
        Assert.IsFalse(File.Exists(Path.Combine(_isolatedDirectory, "geoip.dat")));
        Assert.IsFalse(File.Exists(Path.Combine(_isolatedDirectory, "geosite.dat")));
    }

    [ClassCleanup]
    public static void CleanupIsolatedXray()
    {
        DeleteIsolatedDirectoryWithRetry(_isolatedDirectory);
    }

    private static void DeleteIsolatedDirectoryWithRetry(string? directory)
    {
        if (directory is null)
            return;
        for (var attempt = 1; Directory.Exists(directory); attempt++)
        {
            try
            {
                Directory.Delete(directory, recursive: true);
            }
            catch (UnauthorizedAccessException) when (attempt < 10)
            {
                Thread.Sleep(200);
            }
        }
    }

    public static IEnumerable<object[]> ExistingProtocolFixtures()
    {
        const string uuid = "feb54431-301b-52bb-a6dd-e1e93e81bb9e";
        const string key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

        yield return new object[] { "SOCKS5", new Socks5Server("127.0.0.1", 1080) };
        yield return new object[]
        {
            "Shadowsocks",
            new ShadowsocksServer
            {
                Hostname = "127.0.0.1",
                Port = 8388,
                EncryptMethod = "aes-128-gcm",
                Password = "fixture-password"
            }
        };
        yield return new object[]
        {
            "VMess",
            new VMessServer
            {
                Hostname = "127.0.0.1",
                Port = 443,
                UserID = uuid,
                PacketEncoding = "none"
            }
        };
        yield return new object[]
        {
            "VLESS",
            new VLESSServer
            {
                Hostname = "127.0.0.1",
                Port = 443,
                UserID = uuid,
                PacketEncoding = "none"
            }
        };
        yield return new object[]
        {
            "Trojan",
            new TrojanServer
            {
                Hostname = "127.0.0.1",
                Port = 443,
                Host = "example.com",
                Password = "fixture-password"
            }
        };
        yield return new object[]
        {
            "WireGuard",
            new WireGuardServer
            {
                Hostname = "127.0.0.1",
                Port = 51820,
                LocalAddresses = "172.16.0.2/32",
                PeerPublicKey = key,
                PrivateKey = key
            }
        };

        foreach (var transport in new[] { "ws", "grpc" })
        {
            yield return new object[]
            {
                $"VMess/{transport}",
                new VMessServer
                {
                    Hostname = "127.0.0.1",
                    Port = 443,
                    UserID = uuid,
                    PacketEncoding = "none",
                    TransferProtocol = transport,
                    Host = "example.com",
                    Path = "/fixture"
                }
            };
            yield return new object[]
            {
                $"VLESS/{transport}",
                new VLESSServer
                {
                    Hostname = "127.0.0.1",
                    Port = 443,
                    UserID = uuid,
                    PacketEncoding = "none",
                    TransferProtocol = transport,
                    Host = "example.com",
                    Path = "/fixture"
                }
            };
        }
    }

    [TestMethod]
    [DynamicData(nameof(ExistingProtocolFixtures))]
    public async Task PinnedXrayAcceptsExistingGeneratedConfigAsync(string protocol, Server server)
    {
        var xrayPath = _isolatedXrayPath;
        if (string.IsNullOrWhiteSpace(xrayPath))
            Assert.Inconclusive($"Set {XrayPathVariable} to run provider integration tests.");

        Assert.IsTrue(File.Exists(xrayPath), $"Xray executable not found: {xrayPath}");

        var configPath = Path.Combine(Path.GetTempPath(), $"netch-xray-{Guid.NewGuid():N}.json");
        try
        {
            var config = await V2rayConfigUtils.GenerateClientConfigAsync(server, ProxyCoreFlavor.Xray);
            await using (var stream = File.Create(configPath))
            {
                await JsonSerializer.SerializeAsync(
                    stream,
                    config,
                    Netch.Global.NewCustomJsonSerializerOptions());
            }

            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = xrayPath,
                    RedirectStandardError = true,
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };
            process.StartInfo.ArgumentList.Add("run");
            process.StartInfo.ArgumentList.Add("-test");
            process.StartInfo.ArgumentList.Add("-config");
            process.StartInfo.ArgumentList.Add(configPath);

            process.Start();
            var standardOutput = await process.StandardOutput.ReadToEndAsync();
            var standardError = await process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();

            Assert.AreEqual(
                0,
                process.ExitCode,
                $"{protocol} config rejected by pinned Xray.{Environment.NewLine}{standardOutput}{standardError}");
        }
        finally
        {
            if (File.Exists(configPath))
                File.Delete(configPath);
        }
    }
}

using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Netch.Models;
using Netch.Servers;

namespace Tests;

[TestClass]
public class XrayLoopbackTrafficTests
{
    private const string XrayPathVariable = "NETCH_XRAY_PATH";
    private const string FixtureUuid = "feb54431-301b-52bb-a6dd-e1e93e81bb9e";
    private static string? _isolatedDirectory;
    private static string? _isolatedXrayPath;

    [ClassInitialize]
    public static void PrepareIsolatedXray(TestContext _)
    {
        var source = Environment.GetEnvironmentVariable(XrayPathVariable);
        if (string.IsNullOrWhiteSpace(source) || !File.Exists(source))
            return;
        _isolatedDirectory = Path.Combine(Path.GetTempPath(), $"netch-xray-traffic-isolated-{Guid.NewGuid():N}");
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

    public static IEnumerable<object[]> ProtocolFixtures()
    {
        yield return new object[] { "SOCKS5" };
        yield return new object[] { "Shadowsocks" };
        yield return new object[] { "VMess" };
        yield return new object[] { "VLESS" };
        yield return new object[] { "Trojan" };
    }

    [TestMethod]
    [DynamicData(nameof(ProtocolFixtures))]
    public async Task GeneratedClientConfigCarriesLoopbackTrafficAsync(string protocol)
    {
        var xrayPath = _isolatedXrayPath;
        if (string.IsNullOrWhiteSpace(xrayPath))
            Assert.Inconclusive($"Set {XrayPathVariable} to run provider traffic tests.");

        Assert.IsTrue(File.Exists(xrayPath), $"Xray executable not found: {xrayPath}");

        var ports = ReserveAvailableTcpPorts(3);
        var serverPort = ports[0];
        var socksPort = ports[1];
        var targetPort = ports[2];
        var server = CreateClientServer(protocol, serverPort);
        var testDirectory = Path.Combine(Path.GetTempPath(), $"netch-xray-traffic-{Guid.NewGuid():N}");
        Directory.CreateDirectory(testDirectory);
        var serverConfigPath = Path.Combine(testDirectory, "server.json");
        var clientConfigPath = Path.Combine(testDirectory, "client.json");
        Process? serverProcess = null;
        Process? clientProcess = null;
        var originalSocksPort = Netch.Global.Settings.Socks5LocalPort;

        try
        {
            await WriteJsonAsync(serverConfigPath, CreateServerConfig(protocol, serverPort));
            serverProcess = StartXray(xrayPath, serverConfigPath);
            await WaitForPortAsync(serverPort, TimeSpan.FromSeconds(10), serverProcess);

            Netch.Global.Settings.Socks5LocalPort = (ushort)socksPort;
            var clientConfig = await V2rayConfigUtils.GenerateClientConfigAsync(server, ProxyCoreFlavor.Xray);
            await WriteJsonAsync(clientConfigPath, clientConfig);
            clientProcess = StartXray(xrayPath, clientConfigPath);
            await WaitForPortAsync(socksPort, TimeSpan.FromSeconds(10), clientProcess);

            using var target = new TcpListener(IPAddress.Loopback, targetPort);
            target.Start();
            var targetTask = ServeSingleHttpRequestAsync(target);

            var response = await GetThroughSocks5Async(socksPort, targetPort);
            await targetTask;

            StringAssert.Contains(response, "200 OK", protocol);
            StringAssert.Contains(response, "netch-xray-loopback-ok", protocol);
        }
        finally
        {
            Netch.Global.Settings.Socks5LocalPort = originalSocksPort;
            StopProcess(clientProcess);
            StopProcess(serverProcess);

            foreach (var file in new[] { clientConfigPath, serverConfigPath })
            {
                if (File.Exists(file))
                    File.Delete(file);
            }

            if (Directory.Exists(testDirectory) && !Directory.EnumerateFileSystemEntries(testDirectory).Any())
                Directory.Delete(testDirectory);
        }
    }

    private static Server CreateClientServer(string protocol, int port)
    {
        return protocol switch
        {
            "SOCKS5" => new Socks5Server("127.0.0.1", (ushort)port),
            "Shadowsocks" => new ShadowsocksServer
            {
                Hostname = "127.0.0.1",
                Port = (ushort)port,
                EncryptMethod = "aes-128-gcm",
                Password = "loopback-fixture-password"
            },
            "VMess" => new VMessServer
            {
                Hostname = "127.0.0.1",
                Port = (ushort)port,
                UserID = FixtureUuid,
                PacketEncoding = "none"
            },
            "VLESS" => new VLESSServer
            {
                Hostname = "127.0.0.1",
                Port = (ushort)port,
                UserID = FixtureUuid,
                PacketEncoding = "none"
            },
            "Trojan" => new TrojanServer
            {
                Hostname = "127.0.0.1",
                Port = (ushort)port,
                Password = "loopback-fixture-password",
                TLSSecureType = "none"
            },
            _ => throw new ArgumentOutOfRangeException(nameof(protocol), protocol, null)
        };
    }

    private static object CreateServerConfig(string protocol, int port)
    {
        object settings = protocol switch
        {
            "SOCKS5" => new { auth = "noauth", udp = true },
            "Shadowsocks" => new
            {
                network = "tcp,udp",
                method = "aes-128-gcm",
                password = "loopback-fixture-password"
            },
            "VMess" => new { clients = new[] { new { id = FixtureUuid } } },
            "VLESS" => new
            {
                clients = new[] { new { id = FixtureUuid } },
                decryption = "none"
            },
            "Trojan" => new
            {
                clients = new[] { new { password = "loopback-fixture-password" } }
            },
            _ => throw new ArgumentOutOfRangeException(nameof(protocol), protocol, null)
        };

        return new
        {
            log = new { loglevel = "warning" },
            inbounds = new[]
            {
                new
                {
                    listen = "127.0.0.1",
                    port,
                    protocol = protocol switch
                    {
                        "SOCKS5" => "socks",
                        "Shadowsocks" => "shadowsocks",
                        _ => protocol.ToLowerInvariant()
                    },
                    settings
                }
            },
            outbounds = new[] { new { protocol = "freedom" } }
        };
    }

    private static async Task WriteJsonAsync(string path, object value)
    {
        await using var stream = File.Create(path);
        await JsonSerializer.SerializeAsync(stream, value, Netch.Global.NewCustomJsonSerializerOptions());
    }

    private static Process StartXray(string executable, string configPath)
    {
        var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = executable,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };
        process.StartInfo.ArgumentList.Add("run");
        process.StartInfo.ArgumentList.Add("-config");
        process.StartInfo.ArgumentList.Add(configPath);
        process.Start();
        return process;
    }

    private static int[] ReserveAvailableTcpPorts(int count)
    {
        var listeners = new List<TcpListener>(count);
        try
        {
            for (var index = 0; index < count; index++)
            {
                var listener = new TcpListener(IPAddress.Loopback, 0);
                listener.Start();
                listeners.Add(listener);
            }

            return listeners
                .Select(listener => ((IPEndPoint)listener.LocalEndpoint).Port)
                .ToArray();
        }
        finally
        {
            foreach (var listener in listeners)
                listener.Stop();
        }
    }

    private static async Task WaitForPortAsync(int port, TimeSpan timeout, Process process)
    {
        using var cancellation = new CancellationTokenSource(timeout);
        while (!cancellation.IsCancellationRequested)
        {
            if (process.HasExited)
            {
                var standardOutput = await process.StandardOutput.ReadToEndAsync(cancellation.Token);
                var standardError = await process.StandardError.ReadToEndAsync(cancellation.Token);
                Assert.Fail(
                    $"Xray exited with code {process.ExitCode} before port {port} opened."
                    + Environment.NewLine + standardOutput + standardError);
            }

            try
            {
                using var client = new TcpClient();
                await client.ConnectAsync(IPAddress.Loopback, port, cancellation.Token);
                return;
            }
            catch (SocketException)
            {
                await Task.Delay(50, cancellation.Token);
            }
        }

        throw new TimeoutException($"Port {port} did not start listening within {timeout}.");
    }

    private static async Task ServeSingleHttpRequestAsync(TcpListener listener)
    {
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var client = await listener.AcceptTcpClientAsync(cancellation.Token);
        await using var stream = client.GetStream();
        var requestBuffer = new byte[2048];
        _ = await stream.ReadAsync(requestBuffer, cancellation.Token);
        const string body = "netch-xray-loopback-ok";
        var response = Encoding.ASCII.GetBytes(
            $"HTTP/1.1 200 OK\r\nContent-Length: {body.Length}\r\nConnection: close\r\n\r\n{body}");
        await stream.WriteAsync(response, cancellation.Token);
    }

    private static async Task<string> GetThroughSocks5Async(int socksPort, int targetPort)
    {
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var client = new TcpClient();
        await client.ConnectAsync(IPAddress.Loopback, socksPort, cancellation.Token);
        await using var stream = client.GetStream();

        await stream.WriteAsync(new byte[] { 0x05, 0x01, 0x00 }, cancellation.Token);
        var greeting = new byte[2];
        await stream.ReadExactlyAsync(greeting, cancellation.Token);
        CollectionAssert.AreEqual(new byte[] { 0x05, 0x00 }, greeting);

        var connectRequest = new byte[]
        {
            0x05, 0x01, 0x00, 0x01,
            127, 0, 0, 1,
            (byte)(targetPort >> 8), (byte)targetPort
        };
        await stream.WriteAsync(connectRequest, cancellation.Token);

        var replyHeader = new byte[4];
        await stream.ReadExactlyAsync(replyHeader, cancellation.Token);
        Assert.AreEqual((byte)0x00, replyHeader[1], "SOCKS5 connect failed");
        var addressLength = replyHeader[3] switch
        {
            0x01 => 4,
            0x04 => 16,
            0x03 => stream.ReadByte(),
            _ => throw new InvalidDataException($"Unknown SOCKS5 address type {replyHeader[3]}")
        };
        if (addressLength < 0)
            throw new EndOfStreamException();
        var replyAddressAndPort = new byte[addressLength + 2];
        await stream.ReadExactlyAsync(replyAddressAndPort, cancellation.Token);

        var request = Encoding.ASCII.GetBytes(
            $"GET / HTTP/1.1\r\nHost: 127.0.0.1:{targetPort}\r\nConnection: close\r\n\r\n");
        await stream.WriteAsync(request, cancellation.Token);

        using var response = new MemoryStream();
        await stream.CopyToAsync(response, cancellation.Token);
        return Encoding.ASCII.GetString(response.ToArray());
    }

    private static void StopProcess(Process? process)
    {
        if (process == null)
            return;

        try
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
        }
        finally
        {
            process.Dispose();
        }
    }
}

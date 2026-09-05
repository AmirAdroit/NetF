using System.Text;
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Netch.Models;
using Netch.Servers;
using Netch.Services;
using Netch.Utils;

namespace Tests;

[TestClass]
[DoNotParallelize]
public class ServerManagementTests
{
    private const string Uuid = "feb54431-301b-52bb-a6dd-e1e93e81bb9e";
    private static readonly string WireGuardKey = Convert.ToBase64String(new byte[32]);
    private static readonly string WireGuardPeerKey = Convert.ToBase64String(Enumerable.Repeat((byte)1, 32).ToArray());

    [TestMethod]
    public async Task CreatesAllPackagedProvidersWithoutReturningSecretsAsync()
    {
        await WithRuntimeAsync(async () =>
        {
            var requests = new[]
            {
                Request("SOCKS", "SOCKS", new ServerConfigurationInput(
                    Username: "alice", Password: Replace("socks-secret"), Version: "5")),
                Request("SS", "Shadowsocks", new ServerConfigurationInput(
                    Password: Replace("ss-secret"), EncryptMethod: "aes-256-gcm")),
                Request("VMess", "VMess", new ServerConfigurationInput(
                    UserId: Replace(Uuid), AlterId: 0, EncryptMethod: "auto", TransferProtocol: "tcp",
                    PacketEncoding: "xudp", FakeType: "none", ServerName: "vpn.example.com",
                    TlsSecureType: "tls")),
                Request("VLESS", "VLESS", new ServerConfigurationInput(
                    UserId: Replace(Uuid), EncryptMethod: "none", TransferProtocol: "ws",
                    PacketEncoding: "xudp", FakeType: "none", Host: "cdn.example.com",
                    ServerName: "vpn.example.com", Path: "/socket", TlsSecureType: "tls")),
                Request("Trojan", "Trojan", new ServerConfigurationInput(
                    Password: Replace("trojan-secret"), Host: "vpn.example.com", TlsSecureType: "tls")),
                Request("WireGuard", "WireGuard", new ServerConfigurationInput(
                    LocalAddresses: "172.16.0.2/32,fd00::2/128", PeerPublicKey: WireGuardPeerKey,
                    PrivateKey: Replace(WireGuardKey), PreSharedKey: Replace(WireGuardKey), Mtu: 1420), 51820)
            };

            foreach (var request in requests)
            {
                var result = await ServerManagementService.SaveAsync(request);
                Assert.IsTrue(result.Server.Supported, result.Server.SupportMessage);
                var json = JsonSerializer.Serialize(result.Server);
                Assert.IsFalse(json.Contains("secret", StringComparison.Ordinal));
                Assert.IsFalse(json.Contains(Uuid, StringComparison.Ordinal));
                Assert.IsFalse(json.Contains(WireGuardKey, StringComparison.Ordinal));
            }

            Assert.AreEqual(6, Netch.Global.Settings.Server.Count);
            Assert.IsTrue(File.Exists(Configuration.FileFullName));
            var reloaded = await Configuration.ReadValidatedAsync(Configuration.FileFullName);
            Assert.AreEqual(6, reloaded.Server.Count);
        });
    }

    [TestMethod]
    public async Task KeepsReplacesAndClearsSecretsWithoutExposingSavedValuesAsync()
    {
        await WithRuntimeAsync(async () =>
        {
            await ServerManagementService.SaveAsync(Request("SOCKS", "SOCKS", new ServerConfigurationInput(
                Username: "alice", Password: Replace("first-secret"), Version: "5")));

            var kept = await ServerManagementService.SaveAsync(Request("SOCKS", "SOCKS kept", new ServerConfigurationInput(
                Username: "alice", Password: new SecretUpdate("keep"), Version: "5"), serverId: 0));
            Assert.IsTrue(kept.Server.Configuration.HasPassword);
            Assert.AreEqual("first-secret", ((Socks5Server)Netch.Global.Settings.Server[0]).Password);

            await ServerManagementService.SaveAsync(Request("SOCKS", "SOCKS replaced", new ServerConfigurationInput(
                Username: "alice", Password: Replace("second-secret"), Version: "5"), serverId: 0));
            Assert.AreEqual("second-secret", ((Socks5Server)Netch.Global.Settings.Server[0]).Password);

            var cleared = await ServerManagementService.SaveAsync(Request("SOCKS", "SOCKS anonymous", new ServerConfigurationInput(
                Password: new SecretUpdate("clear"), Version: "5"), serverId: 0));
            Assert.IsFalse(cleared.Server.Configuration.HasPassword);
            Assert.IsNull(((Socks5Server)Netch.Global.Settings.Server[0]).Password);
        });
    }

    [TestMethod]
    public async Task RenameDuplicateAndDeleteMaintainReferencesAndDurableBackupAsync()
    {
        await WithRuntimeAsync(async () =>
        {
            await ServerManagementService.SaveAsync(Request("Trojan", "Primary", new ServerConfigurationInput(
                Password: Replace("secret"), Host: "vpn.example.com", TlsSecureType: "tls")));
            Netch.Global.Settings.Profiles.Add(new Profile
            {
                Index = 0,
                ServerRemark = "Primary",
                ModeRemark = "Process",
                ProfileName = "Saved profile"
            });
            await Configuration.SaveAsync();

            var renamed = await ServerManagementService.SaveAsync(Request("Trojan", "Renamed", new ServerConfigurationInput(
                Password: new SecretUpdate("keep"), Host: "vpn.example.com", TlsSecureType: "tls"), serverId: 0));
            Assert.IsTrue(File.Exists(Path.Combine(renamed.BackupDirectory!, "settings.json")));
            Assert.AreEqual("Renamed", Netch.Global.Settings.Profiles.Single().ServerRemark);

            var duplicated = await ServerManagementService.DuplicateAsync(0);
            Assert.AreEqual("Renamed copy", duplicated.Server.Remark);
            Assert.AreEqual("secret", ((TrojanServer)Netch.Global.Settings.Server[1]).Password);

            var deleted = await ServerManagementService.DeleteAsync(0);
            Assert.IsTrue(File.Exists(Path.Combine(deleted.BackupDirectory, "settings.json")));
            var backup = await Configuration.ReadValidatedAsync(Path.Combine(deleted.BackupDirectory, "settings.json"));
            Assert.AreEqual(2, backup.Server.Count);
            Assert.IsFalse(Netch.Global.Settings.Profiles.Any(profile => profile.ServerRemark == "Renamed"));
            Assert.AreEqual(1, Netch.Global.Settings.Server.Count);
        });
    }

    [TestMethod]
    public async Task RejectsInvalidAndUnsupportedProviderShapesAsync()
    {
        await WithRuntimeAsync(async () =>
        {
            await Assert.ThrowsExactlyAsync<InvalidDataException>(() => ServerManagementService.SaveAsync(
                Request("VLESS", "Bad host", new ServerConfigurationInput(
                    UserId: Replace(Uuid), TransferProtocol: "tcp", PacketEncoding: "xudp", FakeType: "none"),
                    hostname: "not a host/path")));
            await Assert.ThrowsExactlyAsync<InvalidDataException>(() => ServerManagementService.SaveAsync(
                Request("VLESS", "Bad UUID", new ServerConfigurationInput(
                    UserId: Replace("not-a-uuid"), TransferProtocol: "tcp", PacketEncoding: "xudp", FakeType: "none"))));
            await Assert.ThrowsExactlyAsync<InvalidDataException>(() => ServerManagementService.SaveAsync(
                Request("VMess", "Bad combination", new ServerConfigurationInput(
                    UserId: Replace(Uuid), TransferProtocol: "ws", PacketEncoding: "xudp", FakeType: "http"))));
            await Assert.ThrowsExactlyAsync<InvalidDataException>(() => ServerManagementService.SaveAsync(
                Request("SS", "Bad 2022 key", new ServerConfigurationInput(
                    Password: Replace("not-base64"), EncryptMethod: "2022-blake3-aes-256-gcm"))));
            await Assert.ThrowsExactlyAsync<InvalidDataException>(() => ServerManagementService.SaveAsync(
                Request("WireGuard", "Bad key", new ServerConfigurationInput(
                    LocalAddresses: "172.16.0.2/32", PeerPublicKey: "invalid",
                    PrivateKey: Replace("invalid"), Mtu: 1420), 51820)));

            var unsupported = ServerManagementService.Support(new ShadowsocksRServer
            {
                Hostname = "vpn.example.com",
                Port = 443
            });
            Assert.IsFalse(unsupported.Supported);
            StringAssert.Contains(unsupported.Message, "not packaged");

            foreach (var imported in new Server[]
                     {
                         new Socks5Server { Hostname = "vpn.example.com", Port = 1080, Version = "5", RemoteHostname = "not a host/path" },
                         new VMessServer { Hostname = "vpn.example.com", Port = 443, UserID = Uuid, TransferProtocol = "tcp", FakeType = "none", PacketEncoding = "invalid", TLSSecureType = "tls" },
                         new VLESSServer { Hostname = "vpn.example.com", Port = 443, UserID = Uuid, TransferProtocol = "tcp", FakeType = "none", PacketEncoding = "xudp", TLSSecureType = "reality" },
                         new TrojanServer { Hostname = "vpn.example.com", Port = 443, Password = "secret", TLSSecureType = "reality" },
                         new WireGuardServer { Hostname = "vpn.example.com", Port = 51820, LocalAddresses = "172.16.0.2/32", PeerPublicKey = WireGuardPeerKey, PrivateKey = WireGuardKey, MTU = 1 }
                     })
            {
                var importedSupport = ServerManagementService.Support(imported);
                Assert.IsFalse(importedSupport.Supported, $"{imported.Type} should fail closed.");
                Assert.IsFalse(string.IsNullOrWhiteSpace(importedSupport.Message));
            }
        });
    }

    [TestMethod]
    public async Task ImportsSupportedShareLinksWithoutReturningCredentialsAsync()
    {
        await WithRuntimeAsync(async () =>
        {
            var vmessJson = JsonSerializer.Serialize(new
            {
                v = "2",
                ps = "VMess imported",
                add = "vmess.example.com",
                port = "443",
                id = Uuid,
                aid = "0",
                scy = "auto",
                net = "ws",
                type = "none",
                host = "cdn.example.com",
                path = "/socket",
                tls = "tls",
                sni = "vmess.example.com"
            });
            var vmessLink = "vmess://" + Base64Url(vmessJson);
            var shadowsocksCredentials = Base64Url("aes-256-gcm:ss-secret");
            var links = new[]
            {
                $"vless://{Uuid}@52.28.57.212:46359?encryption=none&type=ws&path=/&packetEncoding=xudp#Mine-me",
                vmessLink,
                "trojan://trojan%2Bsecret@trojan.example.com:443?security=tls&type=tcp&sni=trojan.example.com#Trojan%20imported",
                $"ss://{shadowsocksCredentials}@ss.example.com:8388#Shadowsocks%20imported",
                "socks5://alice:socks%2Bsecret@socks.example.com:1080#SOCKS5%20imported"
            };

            foreach (var link in links)
            {
                var result = await ServerShareLinkService.ImportAsync(link);
                Assert.IsTrue(result.Server.Supported, result.Server.SupportMessage);
                var response = JsonSerializer.Serialize(result);
                Assert.IsFalse(response.Contains(Uuid, StringComparison.Ordinal));
                Assert.IsFalse(response.Contains("secret", StringComparison.OrdinalIgnoreCase));
            }

            Assert.AreEqual(5, Netch.Global.Settings.Server.Count);
            var vless = (VLESSServer)Netch.Global.Settings.Server[0];
            Assert.AreEqual("Mine-me", vless.Remark);
            Assert.AreEqual("52.28.57.212", vless.Hostname);
            Assert.AreEqual((ushort)46359, vless.Port);
            Assert.AreEqual("ws", vless.TransferProtocol);
            Assert.AreEqual("/", vless.Path);
            Assert.AreEqual("xudp", vless.PacketEncoding);
            Assert.AreEqual(Uuid, vless.UserID);
            Assert.AreEqual("trojan+secret", ((TrojanServer)Netch.Global.Settings.Server[2]).Password);
            Assert.AreEqual("socks+secret", ((Socks5Server)Netch.Global.Settings.Server[4]).Password);

            var duplicate = await ServerShareLinkService.ImportAsync(links[0]);
            Assert.AreEqual("Mine-me 2", duplicate.Server.Remark);
            Assert.AreEqual(6, Netch.Global.Settings.Server.Count);
            var ipv6 = ServerShareLinkService.Parse(
                $"vless://{Uuid}@[2001:db8::1]:443?encryption=none&type=tcp&packetEncoding=xudp#IPv6");
            Assert.IsTrue(ipv6.Hostname.Contains("2001:db8::1", StringComparison.Ordinal));

            var reloaded = await Configuration.ReadValidatedAsync(Configuration.FileFullName);
            Assert.AreEqual(6, reloaded.Server.Count);
        });
    }

    [TestMethod]
    public async Task ShareLinkImportRejectsBatchUnsupportedAndSecretBearingErrorsAsync()
    {
        await WithRuntimeAsync(async () =>
        {
            var secret = "do-not-return-this-secret";
            var invalidLinks = new[]
            {
                $"vless://{Uuid}@vpn.example.com:443?encryption=none&type=ws&path=/&security=reality#Unsupported",
                $"vless://{Uuid}@vpn.example.com:443?encryption=none&type=ws&fp=chrome#Unsupported",
                $"vless://{Uuid}@vpn.example.com:443?encryption=none&type=ws&type=tcp#Duplicate",
                $"trojan://{secret}@vpn.example.com:443?type=grpc#Unsupported",
                $"ss://{Base64Url($"aes-256-gcm:{secret}")}@vpn.example.com:8388?plugin=obfs-local#Unsupported",
                $"trojan://{secret}@vpn.example.com:443?sni=%ZZ#Malformed",
                "vmess://not-base64",
                $"socks5://alice:{secret}@vpn.example.com:1080\nvless://{Uuid}@vpn.example.com:443",
                "wireguard://unsupported",
                "vless://" + new string('a', ServerShareLinkService.MaximumLinkCharacters)
            };

            foreach (var link in invalidLinks)
            {
                var exception = await Assert.ThrowsExactlyAsync<InvalidDataException>(
                    () => ServerShareLinkService.ImportAsync(link));
                Assert.IsFalse(exception.Message.Contains(secret, StringComparison.Ordinal));
                Assert.IsFalse(exception.Message.Contains(Uuid, StringComparison.Ordinal));
            }

            Assert.AreEqual(0, Netch.Global.Settings.Server.Count);
        });
    }

    [TestMethod]
    public async Task DuplicateLegacyRemarksDoNotLoseOrMisassignProfileReferencesAsync()
    {
        await WithRuntimeAsync(async () =>
        {
            foreach (var password in new[] { "first", "second" })
                await ServerManagementService.SaveAsync(Request("Trojan", "Shared", new ServerConfigurationInput(
                    Password: Replace(password), Host: "vpn.example.com", TlsSecureType: "tls")));
            Netch.Global.Settings.Profiles.Add(new Profile
            {
                Index = 0,
                ServerRemark = "Shared",
                ModeRemark = "Process",
                ProfileName = "Ambiguous legacy profile"
            });
            await Configuration.SaveAsync();

            await ServerManagementService.DeleteAsync(0);
            Assert.AreEqual("Shared", Netch.Global.Settings.Profiles.Single().ServerRemark);

            await ServerManagementService.SaveAsync(Request("Trojan", "Unique", new ServerConfigurationInput(
                Password: new SecretUpdate("keep"), Host: "vpn.example.com", TlsSecureType: "tls"), serverId: 0));
            Assert.AreEqual("Unique", Netch.Global.Settings.Profiles.Single().ServerRemark);
        });
    }

    private static ServerEditRequest Request(
        string type,
        string remark,
        ServerConfigurationInput configuration,
        ushort port = 443,
        int? serverId = null,
        string hostname = "vpn.example.com") =>
        new(serverId, type, remark, hostname, port, configuration);

    private static SecretUpdate Replace(string value) => new("replace", value);

    private static string Base64Url(string value) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(value)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static async Task WithRuntimeAsync(Func<Task> test)
    {
        var originalRoot = Netch.Global.NetchDir;
        var originalExecutable = Netch.Global.NetchExecutable;
        var originalSettings = Netch.Global.Settings;
        var runtime = Path.Combine(Path.GetTempPath(), $"netf-server-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(runtime, "data"));
        try
        {
            Netch.Global.ConfigureRuntimeRoot(runtime, Path.Combine(runtime, "NetF.exe"));
            Netch.Global.Settings = new Setting();
            await Configuration.SaveAsync();
            await test();
        }
        finally
        {
            Netch.Global.Settings = originalSettings;
            if (Directory.Exists(originalRoot))
                Netch.Global.ConfigureRuntimeRoot(originalRoot, originalExecutable);
            if (Directory.Exists(runtime))
                Directory.Delete(runtime, recursive: true);
        }
    }
}

using System.Net;
using System.Text.Json;
using Netch.Controllers;
using Netch.Interfaces;
using Netch.Models;

namespace Netch.Servers;

public class V2rayController : Guard, IServerController
{
    private readonly ProxyCoreFlavor _coreFlavor;
    private readonly string _name;

    public V2rayController() : this("v2ray-sn.exe", "V2Ray (SagerNet)", ProxyCoreFlavor.LegacySagerNet)
    {
    }

    protected V2rayController(string executable, string name, ProxyCoreFlavor coreFlavor) : base(executable)
    {
        _name = name;
        _coreFlavor = coreFlavor;
        //if (!Global.Settings.V2RayConfig.XrayCone)
        //    Instance.StartInfo.Environment["XRAY_CONE_DISABLED"] = "true";
    }

    protected override IEnumerable<string> StartedKeywords => new[] { "started" };

    protected override IEnumerable<string> FailedKeywords => new[] { "config file not readable", "failed to" };

    public override string Name => _name;

    public ushort? Socks5LocalPort { get; set; }

    public string? LocalAddress { get; set; }

    public virtual async Task<Socks5Server> StartAsync(Server s)
    {
        await using (var fileStream = new FileStream(Constants.TempConfig, FileMode.Create, FileAccess.Write, FileShare.Read))
        {
            await JsonSerializer.SerializeAsync(
                fileStream,
                await V2rayConfigUtils.GenerateClientConfigAsync(s, _coreFlavor),
                Global.NewCustomJsonSerializerOptions());
        }

        await StartGuardAsync("run -c ..\\data\\last.json");
        return new Socks5Server(IPAddress.Loopback.ToString(), this.Socks5LocalPort(), s.Hostname);
    }
}

public sealed class XrayController : V2rayController
{
    public XrayController() : base("xray.exe", "Xray", ProxyCoreFlavor.Xray)
    {
    }
}

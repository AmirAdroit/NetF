using System.Collections.Concurrent;
using System.Net.Sockets;
using Netch.Models;
using Netch.Utils;

namespace Netch.Services;

public sealed record ServerLatencyResult(
    int ServerId,
    string Status,
    string Method,
    int? LatencyMs,
    DateTimeOffset TestedAtUtc);

public sealed record ServerLatencyBatchResult(
    IReadOnlyList<ServerLatencyResult> Results,
    int Total,
    bool TimedOut);

public static class ServerLatencyService
{
    private const int DnsTimeoutMs = 3000;
    private const int ProbeTimeoutMs = 1000;
    private const int ProbeCount = 3;
    private const int MaximumConcurrency = 16;
    private static readonly TimeSpan BatchTimeout = TimeSpan.FromSeconds(60);
    private static readonly SemaphoreSlim TestGate = new(1, 1);
    private static readonly ConcurrentDictionary<Server, ServerLatencyResult> Latest =
        new(ReferenceEqualityComparer.Instance);

    public static ServerLatencyResult? GetLatest(Server server, int serverId) =>
        Latest.TryGetValue(server, out var result) ? result with { ServerId = serverId } : null;

    public static void Clear() => Latest.Clear();

    public static async Task<ServerLatencyResult> TestAsync(int serverId, CancellationToken cancellationToken = default)
    {
        var server = GetServer(serverId);
        await TestGate.WaitAsync(cancellationToken);
        try
        {
            return await TestCoreAsync(server, serverId, cancellationToken);
        }
        finally
        {
            TestGate.Release();
        }
    }

    public static async Task<ServerLatencyResult?> TryTestAsync(
        Server server,
        int serverId,
        CancellationToken cancellationToken = default)
    {
        if (!await TestGate.WaitAsync(0, cancellationToken))
            return null;
        try
        {
            return await TestCoreAsync(server, serverId, cancellationToken);
        }
        finally
        {
            TestGate.Release();
        }
    }

    public static async Task<ServerLatencyBatchResult> TestAllAsync(CancellationToken cancellationToken = default)
    {
        await TestGate.WaitAsync(cancellationToken);
        try
        {
            var servers = Global.Settings.Server.Select((server, id) => (server, id)).ToArray();
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            deadline.CancelAfter(BatchTimeout);
            var results = new ConcurrentBag<ServerLatencyResult>();
            var options = new ParallelOptions
            {
                CancellationToken = deadline.Token,
                MaxDegreeOfParallelism = MaximumConcurrency
            };
            var timedOut = false;
            try
            {
                await Parallel.ForEachAsync(servers, options, async (item, token) =>
                {
                    results.Add(await TestCoreAsync(item.server, item.id, token));
                });
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                timedOut = true;
            }

            cancellationToken.ThrowIfCancellationRequested();
            return new ServerLatencyBatchResult(
                results.OrderBy(result => result.ServerId).ToArray(),
                servers.Length,
                timedOut);
        }
        finally
        {
            TestGate.Release();
        }
    }

    private static async Task<ServerLatencyResult> TestCoreAsync(
        Server server,
        int serverId,
        CancellationToken cancellationToken)
    {
        var method = Global.Settings.ServerTCPing ? "tcp" : "icmp";
        var testedAt = DateTimeOffset.UtcNow;
        try
        {
            var address = await DnsUtils.LookupAsync(server.Hostname, AddressFamily.Unspecified, DnsTimeoutMs)
                .WaitAsync(cancellationToken);
            if (address == null)
                return Save(server, new ServerLatencyResult(serverId, "dnsFailure", method, null, testedAt));

            var probes = Enumerable.Range(0, ProbeCount).Select(async _ =>
            {
                if (method == "tcp")
                    return await Utils.Utils.TCPingAsync(address, server.Port, ProbeTimeoutMs, cancellationToken);
                return await Utils.Utils.ICMPingAsync(address, ProbeTimeoutMs).WaitAsync(cancellationToken);
            });
            var values = await Task.WhenAll(probes);
            var successful = values.Where(value => value < ProbeTimeoutMs).ToArray();
            return successful.Length == 0
                ? Save(server, new ServerLatencyResult(serverId, "timeout", method, null, testedAt))
                : Save(server, new ServerLatencyResult(serverId, "success", method, successful.Min(), testedAt));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            return Save(server, new ServerLatencyResult(serverId, "error", method, null, testedAt));
        }
    }

    private static ServerLatencyResult Save(Server server, ServerLatencyResult result)
    {
        Latest[server] = result;
        return result;
    }

    private static Server GetServer(int serverId)
    {
        if ((uint)serverId >= (uint)Global.Settings.Server.Count)
            throw new InvalidDataException("The selected server no longer exists.");
        return Global.Settings.Server[serverId];
    }
}

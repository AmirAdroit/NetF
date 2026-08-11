using Netch.Interfaces;

namespace Netch.Services;

/// <summary>
/// Narrow event boundary between the networking engine and its presentation.
/// Headless hosts may replace <see cref="Observer"/> before starting the engine.
/// </summary>
public static class EngineEvents
{
    private sealed class NullEngineObserver : IEngineObserver
    {
        public void StatusChanged(string? status)
        {
        }
    }

    private static IEngineObserver _observer = new NullEngineObserver();

    public static IEngineObserver Observer
    {
        get => _observer;
        set => _observer = value ?? throw new ArgumentNullException(nameof(value));
    }

    public static void ReportStatus(string? status)
    {
        Observer.StatusChanged(status);
    }
}

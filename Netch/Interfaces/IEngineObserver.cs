namespace Netch.Interfaces;

/// <summary>
/// Receives UI-independent engine lifecycle events. Implementations must not
/// perform networking or change engine state.
/// </summary>
public interface IEngineObserver
{
    void StatusChanged(string? status);
}

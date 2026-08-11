using Netch.Interfaces;

namespace Netch.Forms;

internal sealed class MainFormEngineObserver : IEngineObserver
{
    private readonly MainForm _mainForm;

    public MainFormEngineObserver(MainForm mainForm)
    {
        _mainForm = mainForm;
    }

    public void StatusChanged(string? status)
    {
        _mainForm.StatusText(status);
    }
}

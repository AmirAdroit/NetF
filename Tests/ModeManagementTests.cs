using Microsoft.VisualStudio.TestTools.UnitTesting;
using System.Text.Json;
using Netch.Models.Modes.ProcessMode;
using Netch.Models.Modes.TunMode;
using Netch.Services;
using Netch.Utils;

namespace Tests;

[TestClass]
public class ModeManagementTests
{
    [TestMethod]
    public void TunIncludeAddsHandleRulesToTheDestinationMode()
    {
        var directory = CreateTemporaryDirectory();
        try
        {
            var child = Path.Combine(directory, "child.txt");
            var parent = Path.Combine(directory, "parent.txt");
            File.WriteAllText(child, "#Child,1\ngame\\.exe\n");
            File.WriteAllText(parent, "#Parent,1\n#include <child.h>\n");

            var loaded = (TunMode)ModeHelper.LoadMode(parent, directory);

            CollectionAssert.Contains(loaded.Handle, "game\\.exe");
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [TestMethod]
    public async Task AtomicModeWriteKeepsPreviousModeAsBackupAsync()
    {
        var directory = CreateTemporaryDirectory();
        try
        {
            var path = Path.Combine(directory, "mode.json");
            var original = new Redirector
            {
                Remark = new Dictionary<string, string> { ["en"] = "Before" },
                Handle = ["before\\.exe"]
            };
            await original.WriteFileAtomicAsync(path);

            var updated = new Redirector
            {
                Remark = new Dictionary<string, string> { ["en"] = "After" },
                Handle = ["after\\.exe"]
            };
            await updated.WriteFileAtomicAsync(path);

            Assert.AreEqual("After", ModeHelper.LoadMode(path).i18NRemark);
            using var backup = JsonDocument.Parse(File.ReadAllText(path + ".bak"));
            Assert.AreEqual("Before", backup.RootElement.GetProperty("remark").GetProperty("en").GetString());
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [TestMethod]
    public void SharedLogsRedactCredentialsAndProxyUris()
    {
        var line = "password=secret uuid: abc vmess://credential-payload";
        var redacted = EngineLogService.RedactLine(line);

        Assert.IsFalse(redacted.Contains("secret", StringComparison.Ordinal));
        Assert.IsFalse(redacted.Contains("abc", StringComparison.Ordinal));
        Assert.IsFalse(redacted.Contains("credential-payload", StringComparison.Ordinal));
        StringAssert.Contains(redacted, "[redacted]");
        StringAssert.Contains(redacted, "[redacted-uri]");
    }

    private static string CreateTemporaryDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), $"netch-mode-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }
}

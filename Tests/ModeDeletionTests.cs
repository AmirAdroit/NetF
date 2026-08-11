using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Netch.Services;

namespace Tests;

[TestClass]
[DoNotParallelize]
public class ModeDeletionTests
{
    [TestMethod]
    public async Task DeletesBuiltInAndUserModesWithDurableBackupsAndPersistentTombstoneAsync()
    {
        var originalRoot = Netch.Global.NetchDir;
        var originalExecutable = Netch.Global.NetchExecutable;
        var runtime = CreateRuntime();
        try
        {
            var builtIn = Path.Combine(runtime, "mode", "BuiltIn.json");
            var user = Path.Combine(runtime, "mode", "Custom", "User", "User.json");
            await WriteModeAsync(builtIn, "Built in");
            await WriteModeAsync(user, "User mode");
            Configure(runtime);

            var builtInId = FindModeId(builtIn);
            var builtInResult = await ModeDeletionService.DeleteAsync(builtInId);
            Assert.AreEqual("built-in", builtInResult.Origin);
            Assert.IsFalse(File.Exists(builtIn));
            Assert.IsTrue(Directory.EnumerateFiles(builtInResult.BackupDirectory, "BuiltIn.json", SearchOption.AllDirectories).Any());

            var tombstonePath = Path.Combine(runtime, "data", "deleted-modes.json");
            using (var tombstones = JsonDocument.Parse(await File.ReadAllTextAsync(tombstonePath)))
            {
                Assert.AreEqual(1, tombstones.RootElement.GetProperty("schemaVersion").GetInt32());
                Assert.AreEqual("BuiltIn.json", tombstones.RootElement.GetProperty("paths")[0].GetString());
            }

            await WriteModeAsync(builtIn, "Restored by runtime update");
            await ModeDeletionService.ApplyTombstonesAsync();
            Assert.IsFalse(File.Exists(builtIn), "A runtime refresh must not silently restore a deleted built-in mode.");

            ModeService.Instance.Load(notifyPresentation: false);
            var userResult = await ModeDeletionService.DeleteAsync(FindModeId(user));
            Assert.AreEqual("user", userResult.Origin);
            Assert.IsFalse(File.Exists(user));
            Assert.IsTrue(Directory.EnumerateFiles(userResult.BackupDirectory, "User.json", SearchOption.AllDirectories).Any());
            using var unchanged = JsonDocument.Parse(await File.ReadAllTextAsync(tombstonePath));
            Assert.AreEqual(1, unchanged.RootElement.GetProperty("paths").GetArrayLength());
        }
        finally
        {
            Netch.Global.Modes.Clear();
            if (Directory.Exists(originalRoot))
                Netch.Global.ConfigureRuntimeRoot(originalRoot, originalExecutable);
            Directory.Delete(runtime, recursive: true);
        }
    }

    [TestMethod]
    public async Task RejectsInvalidIdsAndTombstoneTraversalAsync()
    {
        var originalRoot = Netch.Global.NetchDir;
        var originalExecutable = Netch.Global.NetchExecutable;
        var runtime = CreateRuntime();
        try
        {
            Configure(runtime);
            await Assert.ThrowsExactlyAsync<InvalidDataException>(() => ModeDeletionService.DeleteAsync(-1));
            await File.WriteAllTextAsync(
                Path.Combine(runtime, "data", "deleted-modes.json"),
                "{\"schemaVersion\":1,\"paths\":[\"../data/settings.json\"]}");
            await Assert.ThrowsExactlyAsync<InvalidDataException>(() => ModeDeletionService.ApplyTombstonesAsync());
        }
        finally
        {
            Netch.Global.Modes.Clear();
            if (Directory.Exists(originalRoot))
                Netch.Global.ConfigureRuntimeRoot(originalRoot, originalExecutable);
            Directory.Delete(runtime, recursive: true);
        }
    }

    [TestMethod]
    public async Task RejectsReparsePointsWhenWindowsAllowsTheFixtureAsync()
    {
        var originalRoot = Netch.Global.NetchDir;
        var originalExecutable = Netch.Global.NetchExecutable;
        var runtime = CreateRuntime();
        var outside = Path.Combine(Path.GetTempPath(), $"netch-mode-outside-{Guid.NewGuid():N}");
        Directory.CreateDirectory(outside);
        try
        {
            var link = Path.Combine(runtime, "mode", "Linked");
            try
            {
                Directory.CreateSymbolicLink(link, outside);
            }
            catch (Exception exception) when (exception is UnauthorizedAccessException or IOException)
            {
                Assert.Inconclusive($"Symbolic-link creation is unavailable: {exception.Message}");
                return;
            }

            await WriteModeAsync(Path.Combine(outside, "Linked.json"), "Linked");
            Configure(runtime);
            await File.WriteAllTextAsync(
                Path.Combine(runtime, "data", "deleted-modes.json"),
                "{\"schemaVersion\":1,\"paths\":[\"Linked/Linked.json\"]}");
            await Assert.ThrowsExactlyAsync<InvalidDataException>(() => ModeDeletionService.ApplyTombstonesAsync());
        }
        finally
        {
            Netch.Global.Modes.Clear();
            if (Directory.Exists(originalRoot))
                Netch.Global.ConfigureRuntimeRoot(originalRoot, originalExecutable);
            if (Directory.Exists(runtime))
                Directory.Delete(runtime, recursive: true);
            if (Directory.Exists(outside))
                Directory.Delete(outside, recursive: true);
        }
    }

    private static void Configure(string runtime)
    {
        Netch.Global.ConfigureRuntimeRoot(runtime, Path.Combine(runtime, "NetF.exe"));
        ModeService.Instance.Load(notifyPresentation: false);
    }

    private static int FindModeId(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var id = Netch.Global.Modes.FindIndex(mode => Path.GetFullPath(mode.FullName).Equals(fullPath, StringComparison.OrdinalIgnoreCase));
        Assert.IsTrue(id >= 0, $"Mode was not loaded: {path}");
        return id;
    }

    private static async Task WriteModeAsync(string path, string remark)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path, $$"""
            {
              "type": "ProcessMode",
              "remark": { "en": "{{remark}}" },
              "handle": ["game\\.exe"],
              "bypass": []
            }
            """);
    }

    private static string CreateRuntime()
    {
        var path = Path.Combine(Path.GetTempPath(), $"netch-delete-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(path, "mode", "Custom", "User"));
        Directory.CreateDirectory(Path.Combine(path, "data"));
        return path;
    }
}

using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Netch.Utils;

namespace Tests;

[TestClass]
public class AtomicJsonFileTests
{
    private sealed record TestDocument(string Value);

    [TestMethod]
    public async Task ReplacesExistingFileAndKeepsPreviousContentAsBackupAsync()
    {
        var directory = CreateTemporaryDirectory();
        try
        {
            var destination = Path.Combine(directory, "settings.json");
            var backup = Path.Combine(directory, "settings.json.bak");
            await File.WriteAllTextAsync(destination, "{\"Value\":\"before\"}");

            await AtomicJsonFile.WriteAsync(
                destination,
                backup,
                new TestDocument("after"),
                new JsonSerializerOptions(),
                document => Assert.AreEqual("after", document.Value));

            Assert.AreEqual("after", Read(destination).Value);
            Assert.AreEqual("before", Read(backup).Value);
            Assert.AreEqual(0, Directory.GetFiles(directory, "*.tmp").Length);
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [TestMethod]
    public async Task ValidationFailureLeavesOriginalUntouchedAsync()
    {
        var directory = CreateTemporaryDirectory();
        try
        {
            var destination = Path.Combine(directory, "settings.json");
            var backup = Path.Combine(directory, "settings.json.bak");
            await File.WriteAllTextAsync(destination, "{\"Value\":\"before\"}");

            await Assert.ThrowsExactlyAsync<InvalidDataException>(() => AtomicJsonFile.WriteAsync(
                destination,
                backup,
                new TestDocument("rejected"),
                new JsonSerializerOptions(),
                _ => throw new InvalidDataException("validation failed")));

            Assert.AreEqual("before", Read(destination).Value);
            Assert.IsFalse(File.Exists(backup));
            Assert.AreEqual(0, Directory.GetFiles(directory, "*.tmp").Length);
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    private static TestDocument Read(string path)
    {
        return JsonSerializer.Deserialize<TestDocument>(File.ReadAllText(path))!;
    }

    private static string CreateTemporaryDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), $"netch-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }
}

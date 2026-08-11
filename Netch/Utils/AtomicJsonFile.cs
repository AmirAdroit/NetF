using System.Text.Json;

namespace Netch.Utils;

/// <summary>
/// Writes JSON without ever truncating the destination in place. The temporary
/// file is created beside the destination so the final replace stays on the
/// same volume and is atomic on supported Windows filesystems.
/// </summary>
public static class AtomicJsonFile
{
    public static async Task WriteAsync<T>(
        string destination,
        string backup,
        T value,
        JsonSerializerOptions options,
        Action<T> validate,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(destination);
        ArgumentException.ThrowIfNullOrWhiteSpace(backup);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(validate);

        var destinationPath = Path.GetFullPath(destination);
        var backupPath = Path.GetFullPath(backup);
        var directory = Path.GetDirectoryName(destinationPath)
            ?? throw new InvalidOperationException("Configuration path has no parent directory.");
        Directory.CreateDirectory(directory);

        var temporaryPath = Path.Combine(
            directory,
            $".{Path.GetFileName(destinationPath)}.{Guid.NewGuid():N}.tmp");

        try
        {
            await using (var stream = new FileStream(
                             temporaryPath,
                             FileMode.CreateNew,
                             FileAccess.Write,
                             FileShare.None,
                             4096,
                             FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, value, options, cancellationToken);
                await stream.FlushAsync(cancellationToken);
#pragma warning disable VSTHRD103 // FileStream has no asynchronous flush-to-disk equivalent.
                stream.Flush(flushToDisk: true);
#pragma warning restore VSTHRD103
            }

            T validatedValue;
            await using (var stream = new FileStream(
                             temporaryPath,
                             FileMode.Open,
                             FileAccess.Read,
                             FileShare.Read,
                             4096,
                             FileOptions.Asynchronous))
            {
                validatedValue = await JsonSerializer.DeserializeAsync<T>(stream, options, cancellationToken)
                    ?? throw new JsonException("The validated configuration was empty.");
            }

            validate(validatedValue);

            if (File.Exists(destinationPath))
                File.Replace(temporaryPath, destinationPath, backupPath, ignoreMetadataErrors: true);
            else
                File.Move(temporaryPath, destinationPath);
        }
        catch
        {
            if (File.Exists(temporaryPath))
                File.Delete(temporaryPath);

            throw;
        }
    }
}

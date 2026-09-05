using System.Text;
using System.Text.Json;
using System.Web;

namespace Netch.Services;

public static class ServerShareLinkService
{
    public const int MaximumLinkCharacters = 8192;

    private static readonly HashSet<string> VmessJsonFields = new(StringComparer.OrdinalIgnoreCase)
    {
        "v", "ps", "add", "port", "id", "aid", "scy", "net", "type", "host", "path", "tls", "sni", "packetEncoding"
    };

    private static readonly HashSet<string> VUriQueryFields = new(StringComparer.OrdinalIgnoreCase)
    {
        "encryption", "type", "path", "packetEncoding", "security", "sni", "host", "headerType", "mode", "serviceName"
    };

    public static async Task<ServerMutationResult> ImportAsync(string link)
    {
        var request = Parse(link);
        return await ServerManagementService.SaveAsync(request);
    }

    public static ServerEditRequest Parse(string link)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(link))
                throw new InvalidDataException("Paste one server share link.");
            if (link.Length > MaximumLinkCharacters)
                throw new InvalidDataException($"Server links must be at most {MaximumLinkCharacters} characters.");
            if (link.Any(character => character is '\r' or '\n' or '\0'))
                throw new InvalidDataException("Paste exactly one server share link.");

            var trimmed = link.Trim();
            ValidatePercentEncoding(trimmed);
            var separator = trimmed.IndexOf("://", StringComparison.Ordinal);
            if (separator <= 0)
                throw new InvalidDataException("The server link has no supported URI scheme.");

            return trimmed[..separator].ToLowerInvariant() switch
            {
                "vless" => ParseVUri(trimmed, "VLESS"),
                "vmess" when trimmed[(separator + 3)..].Contains('@') => ParseVUri(trimmed, "VMess"),
                "vmess" => ParseVmessJson(trimmed),
                "trojan" => ParseTrojan(trimmed),
                "ss" => ParseShadowsocks(trimmed),
                "socks" or "socks5" => ParseSocks(trimmed),
                _ => throw new InvalidDataException(
                    "NetF accepts VLESS, VMess, Trojan, Shadowsocks, and SOCKS5 share links. WireGuard remains available through the manual form.")
            };
        }
        catch (InvalidDataException)
        {
            throw;
        }
        catch (Exception exception) when (exception is FormatException or UriFormatException or JsonException or OverflowException or DecoderFallbackException or ArgumentException)
        {
            throw new InvalidDataException("The server link is malformed or uses options that NetF does not support.");
        }
    }

    private static ServerEditRequest ParseVUri(string link, string type)
    {
        var uri = ParseAuthorityUri(link, type.ToLowerInvariant());
        var query = ParseQuery(uri);
        RejectUnknownQuery(query, VUriQueryFields);

        var transport = ValueOrDefault(query, "type", "tcp");
        var packetEncoding = ValueOrDefault(query, "packetEncoding", "xudp");
        var encryption = ValueOrDefault(query, "encryption", type == "VLESS" ? "none" : "auto");
        if (type == "VLESS" && encryption != "none")
            throw new InvalidDataException("VLESS share links must use encryption=none.");

        var fakeType = transport switch
        {
            "tcp" => ValueOrDefault(query, "headerType", "none"),
            "grpc" => ValueOrDefault(query, "mode", "none"),
            _ => "none"
        };
        var path = transport == "grpc"
            ? FirstValue(query, "serviceName", "path")
            : OptionalValue(query, "path");
        var configuration = new ServerConfigurationInput(
            EncryptMethod: encryption,
            UserId: ReplaceSecret(DecodeUserInfo(uri)),
            AlterId: type == "VMess" ? 0 : null,
            TransferProtocol: transport,
            PacketEncoding: packetEncoding,
            FakeType: fakeType,
            Host: OptionalValue(query, "host"),
            ServerName: OptionalValue(query, "sni"),
            Path: path,
            TlsSecureType: ValueOrDefault(query, "security", "none"),
            UseMux: false);

        return Request(type, DecodeRemark(uri, type), uri, configuration);
    }

    private static ServerEditRequest ParseVmessJson(string link)
    {
        var encoded = link["vmess://".Length..];
        if (encoded.IndexOfAny(['?', '#', '@']) >= 0)
            throw new InvalidDataException("The VMess link is not a supported Base64 JSON link.");

        using var document = JsonDocument.Parse(DecodeBase64Url(encoded), new JsonDocumentOptions
        {
            AllowTrailingCommas = false,
            CommentHandling = JsonCommentHandling.Disallow,
            MaxDepth = 16
        });
        if (document.RootElement.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("The VMess link payload must be a JSON object.");

        var fields = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        foreach (var property in document.RootElement.EnumerateObject())
        {
            if (!VmessJsonFields.Contains(property.Name) || !fields.TryAdd(property.Name, property.Value))
                throw new InvalidDataException("The VMess link contains duplicate or unsupported options.");
        }

        var hostname = RequiredText(fields, "add", "The VMess link has no server address.");
        var port = RequiredPort(fields, "port");
        var userId = RequiredText(fields, "id", "The VMess link has no user ID.");
        var remark = OptionalText(fields, "ps");
        var configuration = new ServerConfigurationInput(
            EncryptMethod: ValueOrDefault(fields, "scy", "auto"),
            UserId: ReplaceSecret(userId),
            AlterId: OptionalInteger(fields, "aid") ?? 0,
            TransferProtocol: ValueOrDefault(fields, "net", "tcp"),
            PacketEncoding: ValueOrDefault(fields, "packetEncoding", "xudp"),
            FakeType: ValueOrDefault(fields, "type", "none"),
            Host: OptionalText(fields, "host"),
            ServerName: OptionalText(fields, "sni"),
            Path: OptionalText(fields, "path"),
            TlsSecureType: ValueOrDefault(fields, "tls", "none"),
            UseMux: false);

        return Request("VMess", remark, hostname, port, configuration);
    }

    private static ServerEditRequest ParseTrojan(string link)
    {
        var uri = ParseAuthorityUri(link, "trojan");
        var query = ParseQuery(uri);
        RejectUnknownQuery(query, new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "sni", "peer", "security", "type"
        });
        if (ValueOrDefault(query, "type", "tcp") != "tcp")
            throw new InvalidDataException("Only TCP Trojan share links are supported.");

        var sni = FirstValue(query, "sni", "peer");
        var configuration = new ServerConfigurationInput(
            Password: ReplaceSecret(DecodeUserInfo(uri)),
            Host: sni,
            TlsSecureType: ValueOrDefault(query, "security", "tls"));
        return Request("Trojan", DecodeRemark(uri, "Trojan"), uri, configuration);
    }

    private static ServerEditRequest ParseShadowsocks(string link)
    {
        var body = link["ss://".Length..];
        var remark = string.Empty;
        var fragmentIndex = body.IndexOf('#');
        if (fragmentIndex >= 0)
        {
            remark = DecodeComponent(body[(fragmentIndex + 1)..]);
            body = body[..fragmentIndex];
        }

        var queryIndex = body.IndexOf('?');
        if (queryIndex >= 0)
        {
            var query = ParseQueryText(body[(queryIndex + 1)..]);
            if (query.ContainsKey("plugin"))
                throw new InvalidDataException("Shadowsocks plugin links are not supported by the packaged runtime.");
            if (query.Count > 0)
                throw new InvalidDataException("The Shadowsocks link contains unsupported options.");
            body = body[..queryIndex];
        }

        string credentials;
        string endpoint;
        var atIndex = body.LastIndexOf('@');
        if (atIndex >= 0)
        {
            var encodedCredentials = body[..atIndex];
            endpoint = body[(atIndex + 1)..];
            credentials = TryDecodeBase64Url(encodedCredentials, out var decoded)
                ? decoded
                : DecodeComponent(encodedCredentials);
        }
        else
        {
            var decoded = DecodeBase64Url(body);
            atIndex = decoded.LastIndexOf('@');
            if (atIndex <= 0)
                throw new InvalidDataException("The Shadowsocks link has no server endpoint.");
            credentials = decoded[..atIndex];
            endpoint = decoded[(atIndex + 1)..];
        }

        var separator = credentials.IndexOf(':');
        if (separator <= 0 || separator == credentials.Length - 1)
            throw new InvalidDataException("The Shadowsocks link has invalid credentials.");
        var (hostname, port) = ParseEndpoint(endpoint);
        var configuration = new ServerConfigurationInput(
            Password: ReplaceSecret(credentials[(separator + 1)..]),
            EncryptMethod: credentials[..separator]);
        return Request("SS", remark, hostname, port, configuration);
    }

    private static ServerEditRequest ParseSocks(string link)
    {
        var separator = link.IndexOf("://", StringComparison.Ordinal);
        var uri = ParseAuthorityUri(link, link[..separator].ToLowerInvariant());
        if (!string.IsNullOrEmpty(uri.Query))
            throw new InvalidDataException("The SOCKS5 link contains unsupported options.");

        var username = string.Empty;
        SecretUpdate? password = null;
        if (!string.IsNullOrEmpty(uri.UserInfo))
        {
            var userInfo = DecodeUserInfo(uri);
            var credentialSeparator = userInfo.IndexOf(':');
            if (credentialSeparator < 0)
                throw new InvalidDataException("SOCKS5 credentials must include both username and password.");
            username = userInfo[..credentialSeparator];
            password = ReplaceSecret(userInfo[(credentialSeparator + 1)..]);
        }

        var configuration = new ServerConfigurationInput(
            Username: string.IsNullOrEmpty(username) ? null : username,
            Password: password,
            Version: "5");
        return Request("SOCKS", DecodeRemark(uri, "SOCKS5"), uri, configuration);
    }

    private static ServerEditRequest Request(
        string type,
        string? remark,
        Uri uri,
        ServerConfigurationInput configuration) =>
        Request(type, remark, uri.Host, CheckedPort(uri), configuration);

    private static ServerEditRequest Request(
        string type,
        string? remark,
        string hostname,
        ushort port,
        ServerConfigurationInput configuration) =>
        new(null, type, UniqueRemark(remark, type, hostname, port), hostname, port, configuration);

    private static Uri ParseAuthorityUri(string link, string expectedScheme)
    {
        if (!Uri.TryCreate(link, UriKind.Absolute, out var uri)
            || !string.Equals(uri.Scheme, expectedScheme, StringComparison.OrdinalIgnoreCase)
            || string.IsNullOrWhiteSpace(uri.Host)
            || uri.Port is <= 0 or > ushort.MaxValue
            || uri.AbsolutePath is not ("" or "/"))
            throw new InvalidDataException("The server link has an invalid endpoint.");
        return uri;
    }

    private static (string Hostname, ushort Port) ParseEndpoint(string endpoint)
    {
        if (!Uri.TryCreate($"netf://placeholder@{endpoint}", UriKind.Absolute, out var uri)
            || string.IsNullOrWhiteSpace(uri.Host)
            || uri.Port is <= 0 or > ushort.MaxValue
            || uri.AbsolutePath is not ("" or "/")
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment))
            throw new InvalidDataException("The server link has an invalid endpoint.");
        return (uri.Host, CheckedPort(uri));
    }

    private static ushort CheckedPort(Uri uri) => checked((ushort)uri.Port);

    private static SecretUpdate ReplaceSecret(string value) => new("replace", value);

    private static string DecodeUserInfo(Uri uri)
    {
        var value = DecodeComponent(uri.UserInfo);
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidDataException("The server link has no credential or user ID.");
        return value;
    }

    private static string DecodeRemark(Uri uri, string fallbackType) =>
        string.IsNullOrEmpty(uri.Fragment) ? fallbackType : DecodeComponent(uri.Fragment[1..]);

    private static Dictionary<string, string> ParseQuery(Uri uri) =>
        ParseQueryText(uri.GetComponents(UriComponents.Query, UriFormat.UriEscaped));

    private static Dictionary<string, string> ParseQueryText(string query)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(query))
            return result;
        var segments = query.Split('&', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length > 32)
            throw new InvalidDataException("The server link contains too many options.");
        foreach (var segment in segments)
        {
            var separator = segment.IndexOf('=');
            var key = DecodeQueryComponent(separator < 0 ? segment : segment[..separator]);
            var value = DecodeQueryComponent(separator < 0 ? string.Empty : segment[(separator + 1)..]);
            if (key.Length is 0 or > 64 || value.Length > 2048 || !result.TryAdd(key, value))
                throw new InvalidDataException("The server link contains invalid or duplicate options.");
        }
        return result;
    }

    private static void RejectUnknownQuery(
        IReadOnlyDictionary<string, string> query,
        IReadOnlySet<string> allowed)
    {
        if (query.Keys.Any(key => !allowed.Contains(key)))
            throw new InvalidDataException("The server link contains options that the packaged runtime does not support.");
    }

    private static string? OptionalValue(IReadOnlyDictionary<string, string> values, string key) =>
        values.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value) ? value : null;

    private static string? FirstValue(
        IReadOnlyDictionary<string, string> values,
        string first,
        string second)
    {
        var firstValue = OptionalValue(values, first);
        var secondValue = OptionalValue(values, second);
        if (firstValue != null && secondValue != null && firstValue != secondValue)
            throw new InvalidDataException("The server link contains conflicting options.");
        return firstValue ?? secondValue;
    }

    private static string ValueOrDefault(
        IReadOnlyDictionary<string, string> values,
        string key,
        string defaultValue) => OptionalValue(values, key) ?? defaultValue;

    private static string? OptionalText(IReadOnlyDictionary<string, JsonElement> values, string key)
    {
        if (!values.TryGetValue(key, out var value) || value.ValueKind == JsonValueKind.Null)
            return null;
        if (value.ValueKind != JsonValueKind.String)
            throw new InvalidDataException("The VMess link contains a field with the wrong type.");
        var text = value.GetString();
        return string.IsNullOrWhiteSpace(text) ? null : text;
    }

    private static string RequiredText(
        IReadOnlyDictionary<string, JsonElement> values,
        string key,
        string message) => OptionalText(values, key) ?? throw new InvalidDataException(message);

    private static string ValueOrDefault(
        IReadOnlyDictionary<string, JsonElement> values,
        string key,
        string defaultValue) => OptionalText(values, key) ?? defaultValue;

    private static ushort RequiredPort(IReadOnlyDictionary<string, JsonElement> values, string key)
    {
        if (!values.TryGetValue(key, out var value))
            throw new InvalidDataException("The VMess link has no server port.");
        var text = value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            _ => null
        };
        if (!ushort.TryParse(text, out var port) || port == 0)
            throw new InvalidDataException("The VMess link has an invalid server port.");
        return port;
    }

    private static int? OptionalInteger(IReadOnlyDictionary<string, JsonElement> values, string key)
    {
        if (!values.TryGetValue(key, out var value) || value.ValueKind == JsonValueKind.Null)
            return null;
        var text = value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            _ => null
        };
        if (!int.TryParse(text, out var number))
            throw new InvalidDataException("The VMess link contains an invalid number.");
        return number;
    }

    private static string DecodeComponent(string value)
    {
        ValidatePercentEncoding(value);
        var decoded = Uri.UnescapeDataString(value);
        if (decoded.Any(char.IsControl))
            throw new InvalidDataException("The server link contains control characters.");
        return decoded;
    }

    private static string DecodeQueryComponent(string value)
    {
        ValidatePercentEncoding(value);
        var decoded = HttpUtility.UrlDecode(value, Encoding.UTF8) ?? string.Empty;
        if (decoded.Any(char.IsControl))
            throw new InvalidDataException("The server link contains control characters.");
        return decoded;
    }

    private static void ValidatePercentEncoding(string value)
    {
        for (var index = 0; index < value.Length; index++)
        {
            if (value[index] != '%')
                continue;
            if (index + 2 >= value.Length || !Uri.IsHexDigit(value[index + 1]) || !Uri.IsHexDigit(value[index + 2]))
                throw new InvalidDataException("The server link contains invalid percent encoding.");
            index += 2;
        }
    }

    private static string DecodeBase64Url(string encoded)
    {
        if (string.IsNullOrWhiteSpace(encoded) || encoded.Any(char.IsWhiteSpace))
            throw new FormatException();
        var normalized = encoded.Replace('-', '+').Replace('_', '/');
        if (normalized.Length % 4 == 1)
            throw new FormatException();
        normalized = normalized.PadRight(normalized.Length + (4 - normalized.Length % 4) % 4, '=');
        var bytes = Convert.FromBase64String(normalized);
        if (bytes.Length > 32 * 1024)
            throw new InvalidDataException("The decoded server link is too large.");
        return new UTF8Encoding(false, true).GetString(bytes);
    }

    private static bool TryDecodeBase64Url(string encoded, out string decoded)
    {
        try
        {
            decoded = DecodeBase64Url(encoded);
            return decoded.Contains(':');
        }
        catch (Exception exception) when (exception is FormatException or DecoderFallbackException)
        {
            decoded = string.Empty;
            return false;
        }
    }

    private static string UniqueRemark(string? preferred, string type, string hostname, ushort port)
    {
        var baseRemark = string.IsNullOrWhiteSpace(preferred)
            ? $"{type} {hostname}:{port}"
            : preferred.Trim();
        if (baseRemark.Length > 128 || baseRemark.Any(char.IsControl))
            throw new InvalidDataException("The server name in the link is invalid or too long.");

        var existing = new HashSet<string>(Global.Settings.Server.Select(server => server.Remark), StringComparer.OrdinalIgnoreCase);
        if (!existing.Contains(baseRemark))
            return baseRemark;
        for (var suffix = 2; suffix < int.MaxValue; suffix++)
        {
            var ending = $" {suffix}";
            var prefix = baseRemark[..Math.Min(baseRemark.Length, 128 - ending.Length)];
            var candidate = prefix + ending;
            if (!existing.Contains(candidate))
                return candidate;
        }
        throw new InvalidOperationException("Could not allocate a unique server name.");
    }
}

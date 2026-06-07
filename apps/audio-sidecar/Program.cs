using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using AudioSidecar.Models;

namespace AudioSidecar;

internal static partial class Program
{
    public static async Task Main()
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = new UTF8Encoding(false);

        if (OperatingSystem.IsWindows())
        {
            NativeMethods.HideConsoleWindow();
        }

        using var shutdown = new CancellationTokenSource();

        await SendLogAsync("info", "audio sidecar started", shutdown.Token);

        try
        {
            await ReadInputLoopAsync(shutdown);
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            await SendLogAsync("info", "audio sidecar stopped", CancellationToken.None);
        }
    }

    public static void SendMessage<T>(T message)
    {
        var json = JsonSerializer.Serialize(message, JsonOptions.Default);

        lock (JsonOptions.StdoutLock)
        {
            Console.WriteLine(json);
            Console.Out.Flush();
        }
    }

    private static async Task ReadInputLoopAsync(CancellationTokenSource shutdown)
    {
        while (!shutdown.IsCancellationRequested)
        {
            var line = await Console.In.ReadLineAsync(shutdown.Token);

            if (line is null)
            {
                shutdown.Cancel();
                return;
            }

            line = line.Trim();

            if (line.Length == 0)
            {
                continue;
            }

            if (string.Equals(line, BridgeMessageTypes.Exit, StringComparison.OrdinalIgnoreCase))
            {
                shutdown.Cancel();
                return;
            }

            IncomingBridgeMessage? command;

            try
            {
                command = JsonSerializer.Deserialize(line, BridgeJsonContext.Default.IncomingBridgeMessage);
            }
            catch (JsonException ex)
            {
                await SendLogAsync("warn", "invalid jsonl command", shutdown.Token, new Dictionary<string, object?>
                {
                    ["error"] = ex.Message
                });
                continue;
            }

            switch (command?.Type)
            {
                case BridgeMessageTypes.ControlStart:
                    await SendLogAsync("info", "received start command", shutdown.Token);
                    break;

                case BridgeMessageTypes.ControlStop:
                    await SendLogAsync("info", "received stop command", shutdown.Token);
                    break;

                case BridgeMessageTypes.ControlShutdown:
                case BridgeMessageTypes.Exit:
                    shutdown.Cancel();
                    return;

                default:
                    await SendLogAsync("warn", "unknown command type", shutdown.Token, new Dictionary<string, object?>
                    {
                        ["type"] = command?.Type
                    });
                    break;
            }
        }
    }

    private static Task SendLogAsync(
        string level,
        string message,
        CancellationToken cancellationToken,
        IReadOnlyDictionary<string, object?>? details = null)
    {
        return SendMessageAsync(new LogMessage
        {
            Level = level,
            Message = message,
            Details = details is null ? null : ToJsonElementDictionary(details)
        }, cancellationToken);
    }

    private static Task SendMessageAsync<T>(T message, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SendMessage(message);
        return Task.CompletedTask;
    }

    private static Dictionary<string, JsonElement> ToJsonElementDictionary(IReadOnlyDictionary<string, object?> details)
    {
        var result = new Dictionary<string, JsonElement>(StringComparer.Ordinal);

        foreach (var (key, value) in details)
        {
            result[key] = JsonSerializer.SerializeToElement(value, JsonOptions.Default);
        }

        return result;
    }
}

internal static class JsonOptions
{
    public static readonly object StdoutLock = new();

    public static readonly JsonSerializerOptions Default = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };
}

internal static partial class NativeMethods
{
    public static void HideConsoleWindow()
    {
        var handle = GetConsoleWindow();

        if (handle != IntPtr.Zero)
        {
            ShowWindow(handle, 0);
        }
    }

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}

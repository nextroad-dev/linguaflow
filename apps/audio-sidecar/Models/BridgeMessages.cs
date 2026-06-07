using System.Text.Json;
using System.Text.Json.Serialization;

namespace AudioSidecar.Models;

public static class BridgeMessageTypes
{
    public const string AudioChunk = "audio.chunk";
    public const string Log = "log";
    public const string StartCapture = "start_capture";
    public const string StopCapture = "stop_capture";
    public const string ControlStart = "control.start";
    public const string ControlStop = "control.stop";
    public const string ControlShutdown = "control.shutdown";
    public const string Exit = "exit";
}

public static class BridgeDirections
{
    public const string SidecarToMain = "sidecar-to-main";
    public const string MainToSidecar = "main-to-sidecar";
}

public sealed class AudioChunkMessage
{
    public string Direction { get; init; } = BridgeDirections.SidecarToMain;
    public string Type { get; init; } = BridgeMessageTypes.AudioChunk;
    public long Sequence { get; init; }
    public long TimestampMs { get; init; }
    public int SampleRate { get; init; }
    public int Channels { get; init; }
    public string Format { get; init; } = "pcm_s16le";
    public required string DataBase64 { get; init; }
}

public sealed class LogMessage
{
    public string Direction { get; init; } = BridgeDirections.SidecarToMain;
    public string Type { get; init; } = BridgeMessageTypes.Log;
    public string Level { get; init; } = "info";
    public required string Message { get; init; }
    public long TimestampMs { get; init; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    public string? Scope { get; init; }
    public Dictionary<string, JsonElement>? Details { get; init; }
}

public sealed class ControlCommand
{
    public string Direction { get; init; } = BridgeDirections.MainToSidecar;
    public required string Type { get; init; }
    public string? RequestId { get; init; }
    public int? SampleRate { get; init; }
    public int? Channels { get; init; }
    public string? Format { get; init; }
}

public sealed class IncomingBridgeMessage
{
    public string? Direction { get; init; }
    public string? Type { get; init; }
    public string? RequestId { get; init; }
    public int? SampleRate { get; init; }
    public int? Channels { get; init; }
    public string? Format { get; init; }
}

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(AudioChunkMessage))]
[JsonSerializable(typeof(LogMessage))]
[JsonSerializable(typeof(ControlCommand))]
[JsonSerializable(typeof(IncomingBridgeMessage))]
public partial class BridgeJsonContext : JsonSerializerContext;

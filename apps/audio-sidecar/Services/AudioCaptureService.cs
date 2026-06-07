using AudioSidecar.Models;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace AudioSidecar.Services;

public sealed class AudioCaptureService : IDisposable
{
    private const int TargetSampleRate = 16_000;
    private const int TargetChannels = 1;
    private const int BytesPerSample = 2;
    private const int ChunkDurationMs = 200;
    private const int TargetChunkBytes = TargetSampleRate * TargetChannels * BytesPerSample * ChunkDurationMs / 1000;

    private readonly object gate = new();
    private readonly List<byte> pendingBytes = new(TargetChunkBytes * 2);

    private WasapiLoopbackCapture? capture;
    private string? deviceName;
    private long sequence;
    private bool disposed;
    private double sourcePosition;

    public bool IsRunning { get; private set; }

    public void Start()
    {
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);

            if (IsRunning)
            {
                return;
            }

            using var enumerator = new MMDeviceEnumerator();
            var device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            deviceName = device.FriendlyName;

            capture = new WasapiLoopbackCapture(device);
            capture.DataAvailable += OnDataAvailable;
            capture.RecordingStopped += OnRecordingStopped;

            pendingBytes.Clear();
            sequence = 0;
            sourcePosition = 0;
            IsRunning = true;
            capture.StartRecording();

            Program.SendMessage(new LogMessage
            {
                Level = "info",
                Scope = nameof(AudioCaptureService),
                Message = $"wasapi loopback capture started: {deviceName}"
            });
        }
    }

    public void Stop()
    {
        WasapiLoopbackCapture? captureToStop;

        lock (gate)
        {
            if (!IsRunning || capture is null)
            {
                return;
            }

            captureToStop = capture;
            IsRunning = false;
        }

        captureToStop.StopRecording();
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed)
            {
                return;
            }

            disposed = true;
        }

        Stop();
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        try
        {
            var activeCapture = capture;

            if (activeCapture is null || e.BytesRecorded <= 0)
            {
                return;
            }

            var monoSamples = DecodeToMonoFloat(e.Buffer, e.BytesRecorded, activeCapture.WaveFormat);
            var pcm16 = ResampleToPcm16(monoSamples, activeCapture.WaveFormat.SampleRate);

            if (pcm16.Length == 0)
            {
                return;
            }

            lock (gate)
            {
                pendingBytes.AddRange(pcm16);

                while (pendingBytes.Count >= TargetChunkBytes)
                {
                    var chunk = pendingBytes.GetRange(0, TargetChunkBytes).ToArray();
                    pendingBytes.RemoveRange(0, TargetChunkBytes);
                    SendAudioChunk(chunk);
                }
            }
        }
        catch (Exception ex)
        {
            Program.SendMessage(new LogMessage
            {
                Level = "error",
                Scope = nameof(AudioCaptureService),
                Message = "failed to process captured audio",
                Details = new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["error"] = System.Text.Json.JsonSerializer.SerializeToElement(ex.Message, JsonOptions.Default)
                }
            });
        }
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        lock (gate)
        {
            if (pendingBytes.Count > 0)
            {
                SendAudioChunk(pendingBytes.ToArray());
                pendingBytes.Clear();
            }

            if (capture is not null)
            {
                capture.DataAvailable -= OnDataAvailable;
                capture.RecordingStopped -= OnRecordingStopped;
                capture.Dispose();
                capture = null;
            }

            IsRunning = false;
        }

        Program.SendMessage(new LogMessage
        {
            Level = e.Exception is null ? "info" : "error",
            Scope = nameof(AudioCaptureService),
            Message = e.Exception is null ? "wasapi loopback capture stopped" : "wasapi loopback capture stopped with error"
        });
    }

    private void SendAudioChunk(byte[] chunk)
    {
        var levels = CalculatePcm16Levels(chunk);

        Program.SendMessage(new AudioChunkMessage
        {
            Sequence = sequence++,
            TimestampMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            SampleRate = TargetSampleRate,
            Channels = TargetChannels,
            Format = "pcm_s16le",
            DeviceName = deviceName,
            Rms = levels.Rms,
            Peak = levels.Peak,
            DataBase64 = Convert.ToBase64String(chunk)
        });
    }

    private static (double Rms, double Peak) CalculatePcm16Levels(byte[] chunk)
    {
        if (chunk.Length < BytesPerSample)
        {
            return (0, 0);
        }

        var sampleCount = chunk.Length / BytesPerSample;
        var sumSquares = 0d;
        var peak = 0d;

        for (var offset = 0; offset + 1 < chunk.Length; offset += BytesPerSample)
        {
            var sample = BitConverter.ToInt16(chunk, offset) / 32768d;
            var abs = Math.Abs(sample);

            sumSquares += sample * sample;
            peak = Math.Max(peak, abs);
        }

        return (Math.Sqrt(sumSquares / sampleCount), peak);
    }

    private static float[] DecodeToMonoFloat(byte[] buffer, int bytesRecorded, WaveFormat format)
    {
        var bytesPerSample = format.BitsPerSample / 8;
        var frameCount = bytesRecorded / format.BlockAlign;
        var samples = new float[frameCount];

        for (var frame = 0; frame < frameCount; frame++)
        {
            var sum = 0.0f;
            var frameOffset = frame * format.BlockAlign;

            for (var channel = 0; channel < format.Channels; channel++)
            {
                var sampleOffset = frameOffset + channel * bytesPerSample;
                sum += DecodeSample(buffer, sampleOffset, format);
            }

            samples[frame] = sum / format.Channels;
        }

        return samples;
    }

    private byte[] ResampleToPcm16(float[] sourceSamples, int sourceSampleRate)
    {
        if (sourceSamples.Length == 0)
        {
            return [];
        }

        var ratio = (double)sourceSampleRate / TargetSampleRate;
        var output = new List<byte>((int)(sourceSamples.Length / ratio) * BytesPerSample);

        while (sourcePosition + 1 < sourceSamples.Length)
        {
            var index = (int)sourcePosition;
            var fraction = sourcePosition - index;
            var sample = (float)(sourceSamples[index] + (sourceSamples[index + 1] - sourceSamples[index]) * fraction);
            var pcm = FloatToPcm16(sample);

            output.Add((byte)(pcm & 0xff));
            output.Add((byte)((pcm >> 8) & 0xff));

            sourcePosition += ratio;
        }

        sourcePosition -= sourceSamples.Length;
        return output.ToArray();
    }

    private static float DecodeSample(byte[] buffer, int offset, WaveFormat format)
    {
        if (format.Encoding == WaveFormatEncoding.IeeeFloat && format.BitsPerSample == 32)
        {
            return BitConverter.ToSingle(buffer, offset);
        }

        if (format.Encoding == WaveFormatEncoding.Pcm)
        {
            return format.BitsPerSample switch
            {
                16 => BitConverter.ToInt16(buffer, offset) / 32768f,
                24 => DecodePcm24(buffer, offset) / 8388608f,
                32 => BitConverter.ToInt32(buffer, offset) / 2147483648f,
                _ => 0f
            };
        }

        return 0f;
    }

    private static int DecodePcm24(byte[] buffer, int offset)
    {
        var value = buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);

        if ((value & 0x800000) != 0)
        {
            value |= unchecked((int)0xff000000);
        }

        return value;
    }

    private static short FloatToPcm16(float sample)
    {
        var clamped = Math.Clamp(sample, -1f, 1f);
        return (short)Math.Round(clamped * short.MaxValue);
    }
}

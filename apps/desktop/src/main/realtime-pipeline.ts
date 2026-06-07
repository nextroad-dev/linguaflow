import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { AudioChunkMessage, SubtitleState } from "@protocol";
import { AudioSentenceSegmenter, type AudioSentenceSegmentationOptions } from "./audio-sentence-segmenter";
import { QwenProvider, type QwenProviderOptions, type QwenRealtimeOptions } from "./qwen-provider";
import { SidecarManager, type SidecarManagerOptions } from "./sidecar-bridge";
import { SubtitleAssembler } from "./subtitle-assembler";

export type RealtimePipelineOptions = {
  sidecar?: SidecarManagerOptions;
  qwen?: QwenProviderOptions;
  segmentation?: AudioSentenceSegmentationOptions;
};

type RealtimePipelineEvents = {
  subtitle: [state: SubtitleState];
  status: [message: string];
  voiceAudio: [event: VoiceAudioOutputEvent];
};

export type VoiceAudioOutputEvent = {
  pcm16Base64: string;
  sampleRate: 24000;
  channels: 1;
  receivedAtMs: number;
};

export declare interface RealtimePipeline {
  on<K extends keyof RealtimePipelineEvents>(event: K, listener: (...args: RealtimePipelineEvents[K]) => void): this;
  off<K extends keyof RealtimePipelineEvents>(event: K, listener: (...args: RealtimePipelineEvents[K]) => void): this;
  emit<K extends keyof RealtimePipelineEvents>(event: K, ...args: RealtimePipelineEvents[K]): boolean;
}

export class RealtimePipeline extends EventEmitter {
  public readonly sidecar: SidecarManager;
  public readonly qwen: QwenProvider;
  private isRunning = false;
  private qwenReady = false;
  private readonly pendingAudioChunks: AudioChunkMessage[] = [];
  private readonly segmenter: AudioSentenceSegmenter;
  private readonly subtitleAssembler: SubtitleAssembler;

  constructor(options: RealtimePipelineOptions = {}) {
    super();

    this.sidecar = new SidecarManager(options.sidecar);
    this.qwen = new QwenProvider(options.qwen);
    this.subtitleAssembler = new SubtitleAssembler(
      {
        sourceLanguage: this.qwen.getSourceLanguage(),
        targetLanguage: this.qwen.getTargetLanguage()
      },
      (state) => {
        this.broadcastSubtitle(state);
      }
    );
    this.segmenter = new AudioSentenceSegmenter(
      {
        sendAudio: (base64Data) => {
          this.qwen.sendAudio(base64Data);
        },
        commitAudio: () => {
          this.qwen.commitAudio();
        }
      },
      options.segmentation
    );

    this.sidecar.on("message", (message) => {
      if (message.type === "audio.chunk") {
        this.handleAudioChunk(message);
      } else if (message.type === "log") {
        this.emit("status", `[sidecar] ${message.level}: ${message.message}`);
      }
    });

    this.sidecar.on("error", (error) => {
      this.emit("status", `[sidecar] error: ${error.message}`);
    });

    this.sidecar.on("close", (code, signal) => {
      this.emit("status", `[sidecar] closed: code=${code ?? "null"} signal=${signal ?? "null"}`);
    });

    this.qwen.on("open", () => {
      this.subtitleAssembler.setListening(true);
      this.emit("status", "[qwen] connected");
    });

    this.qwen.on("ready", () => {
      this.qwenReady = true;
      this.emit("status", "[qwen] session.updated");
      this.flushPendingAudio();
    });

    this.qwen.on("error", (error) => {
      this.subtitleAssembler.setError(error.message);
      this.emit("status", `[qwen] error: ${error.message}`);
    });

    this.qwen.on("close", (code, reason) => {
      this.qwenReady = false;
      this.subtitleAssembler.setListening(false);
      this.emit("status", `[qwen] closed: code=${code} reason=${reason || "none"}`);
    });

    this.qwen.on("raw", (message) => {
      const type = readQwenEventType(message);

      if (type && type !== "response.audio.delta") {
        this.emit("status", `[qwen] ${type}`);
      }
    });

    this.qwen.on("text", (event) => {
      this.subtitleAssembler.applyTextEvent(event);
    });

    this.qwen.on("audio", (event) => {
      if (this.qwen.getRealtimeOptions().enableVoiceOutput) {
        this.emit("voiceAudio", event);
      }
    });
  }

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.emit("status", "starting realtime pipeline");

    if (!this.qwen.getRealtimeOptions().enableQwenRealtime) {
      this.isRunning = false;
      this.emit("status", "[qwen] disabled");
      throw new Error("Qwen Realtime is disabled");
    }

    this.qwen.connect();
    this.sidecar.start();
    this.startCapture();
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.qwenReady = false;
    this.pendingAudioChunks.length = 0;
    this.emit("status", "stopping realtime pipeline");
    this.stopCapture();
    this.flushActiveSentence();
    this.qwen.close();
    this.segmenter.reset();
    this.subtitleAssembler.flush();
  }

  dispose(): void {
    this.qwen.close();
    this.sidecar.stop();
    this.subtitleAssembler.dispose();
  }

  onSubtitleUpdate(listener: (state: SubtitleState) => void): void {
    this.on("subtitle", listener);
  }

  onStatusUpdate(listener: (message: string) => void): void {
    this.on("status", listener);
  }

  setQwenApiKey(apiKey: string): void {
    this.qwen.setApiKey(apiKey);
  }

  setQwenRegion(region: "cn" | "intl"): void {
    this.qwen.setRegion(region);
  }

  setQwenRealtimeEnabled(enabled: boolean): void {
    this.qwen.setRealtimeOptions({ enableQwenRealtime: enabled });
  }

  setVoiceOutputEnabled(enabled: boolean): void {
    this.qwen.setRealtimeOptions({ enableVoiceOutput: enabled });
  }

  setQwenRealtimeOptions(options: Partial<QwenRealtimeOptions>): void {
    this.qwen.setRealtimeOptions(options);
  }

  onVoiceAudio(listener: (event: VoiceAudioOutputEvent) => void): void {
    this.on("voiceAudio", listener);
  }

  private handleAudioChunk(message: AudioChunkMessage): void {
    if (message.sequence % 10 === 0) {
      const rms = formatLevel(message.rms);
      const peak = formatLevel(message.peak);
      const device = message.deviceName ? ` · ${message.deviceName}` : "";
      this.emit("status", `[audio] chunk #${message.sequence} rms=${rms} peak=${peak}${device}`);
    }

    if (!this.qwenReady) {
      this.pendingAudioChunks.push(message);

      if (this.pendingAudioChunks.length > 50) {
        this.pendingAudioChunks.shift();
      }

      return;
    }

    const boundary = this.segmenter.handleChunk(message);

    if (boundary) {
      this.subtitleAssembler.applySentenceBoundary(boundary.reason);
      this.emit(
        "status",
        `[segment] committed reason=${boundary.reason} duration=${boundary.segmentDurationMs}ms silence=${boundary.trailingSilenceMs}ms`
      );
    }
  }

  private flushPendingAudio(): void {
    while (this.pendingAudioChunks.length > 0) {
      const chunk = this.pendingAudioChunks.shift();

      if (chunk) {
        this.handleAudioChunk(chunk);
      }
    }
  }

  private flushActiveSentence(): void {
    const boundary = this.segmenter.flush();

    if (boundary) {
      this.subtitleAssembler.applySentenceBoundary(boundary.reason);
      this.emit(
        "status",
        `[segment] committed reason=${boundary.reason} duration=${boundary.segmentDurationMs}ms silence=${boundary.trailingSilenceMs}ms`
      );
    }
  }

  private startCapture(): void {
    this.sidecar.sendCommand({
      direction: "main-to-sidecar",
      type: "control.start",
      requestId: randomUUID(),
      sampleRate: this.qwen.getRealtimeOptions().sampleRate,
      channels: 1,
      format: "pcm_s16le"
    });
  }

  private stopCapture(): void {
    try {
      this.sidecar.sendCommand({
        direction: "main-to-sidecar",
        type: "control.stop",
        requestId: randomUUID()
      });
    } catch {
      // The sidecar may already be down during app shutdown.
    }
  }

  private broadcastSubtitle(state: SubtitleState): void {
    this.emit("subtitle", state);
  }
}

function readQwenEventType(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null || !("type" in message)) {
    return undefined;
  }

  const type = (message as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

function formatLevel(value: number | undefined): string {
  return typeof value === "number" ? value.toFixed(4) : "n/a";
}

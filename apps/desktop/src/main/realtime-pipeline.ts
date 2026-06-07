import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { AudioChunkMessage, SubtitleState } from "@protocol";
import { QwenProvider, type QwenProviderOptions } from "./qwen-provider";
import { SidecarManager, type SidecarManagerOptions } from "./sidecar-bridge";

export type RealtimePipelineOptions = {
  sidecar?: SidecarManagerOptions;
  qwen?: QwenProviderOptions;
};

type RealtimePipelineEvents = {
  subtitle: [state: SubtitleState];
  status: [message: string];
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
  private readonly pendingAudioFrames: string[] = [];

  constructor(options: RealtimePipelineOptions = {}) {
    super();

    this.sidecar = new SidecarManager(options.sidecar);
    this.qwen = new QwenProvider(options.qwen);

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
      this.emit("status", "[qwen] connected");
    });

    this.qwen.on("ready", () => {
      this.qwenReady = true;
      this.emit("status", "[qwen] session.updated");
      this.flushPendingAudio();
    });

    this.qwen.on("error", (error) => {
      this.emit("status", `[qwen] error: ${error.message}`);
    });

    this.qwen.on("close", (code, reason) => {
      this.qwenReady = false;
      this.emit("status", `[qwen] closed: code=${code} reason=${reason || "none"}`);
    });

    this.qwen.on("raw", (message) => {
      const type = readQwenEventType(message);

      if (type && type !== "response.audio.delta") {
        this.emit("status", `[qwen] ${type}`);
      }
    });

    this.qwen.on("subtitle", (state) => {
      this.broadcastSubtitle(state);
    });
  }

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.emit("status", "starting realtime pipeline");
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
    this.pendingAudioFrames.length = 0;
    this.emit("status", "stopping realtime pipeline");
    this.stopCapture();
    this.qwen.close();
  }

  dispose(): void {
    this.qwen.close();
    this.sidecar.stop();
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

  private handleAudioChunk(message: AudioChunkMessage): void {
    if (message.sequence % 10 === 0) {
      const rms = formatLevel(message.rms);
      const peak = formatLevel(message.peak);
      const device = message.deviceName ? ` · ${message.deviceName}` : "";
      this.emit("status", `[audio] chunk #${message.sequence} rms=${rms} peak=${peak}${device}`);
    }

    if (!this.qwenReady) {
      this.pendingAudioFrames.push(message.dataBase64);

      if (this.pendingAudioFrames.length > 50) {
        this.pendingAudioFrames.shift();
      }

      return;
    }

    this.qwen.sendAudio(message.dataBase64);
  }

  private flushPendingAudio(): void {
    while (this.pendingAudioFrames.length > 0) {
      const frame = this.pendingAudioFrames.shift();

      if (frame) {
        this.qwen.sendAudio(frame);
      }
    }
  }

  private startCapture(): void {
    this.sidecar.sendCommand({
      direction: "main-to-sidecar",
      type: "control.start",
      requestId: randomUUID(),
      sampleRate: 16000,
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

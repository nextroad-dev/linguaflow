import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import type { AudioChunkMessage, SubtitleState } from "@protocol";
import { QwenProvider, type QwenProviderOptions } from "./qwen-provider";
import { SidecarManager, type SidecarManagerOptions } from "./sidecar-bridge";

export type RealtimePipelineOptions = {
  sidecar?: SidecarManagerOptions;
  qwen?: QwenProviderOptions;
};

export class RealtimePipeline {
  public readonly sidecar: SidecarManager;
  public readonly qwen: QwenProvider;

  constructor(options: RealtimePipelineOptions = {}) {
    this.sidecar = new SidecarManager(options.sidecar);
    this.qwen = new QwenProvider(options.qwen);

    this.sidecar.on("message", (message) => {
      if (message.type === "audio.chunk") {
        this.handleAudioChunk(message);
      }
    });

    this.qwen.on("subtitle", (state) => {
      this.broadcastSubtitle(state);
    });
  }

  start(): void {
    this.qwen.connect();
    this.sidecar.start();
    this.startCapture();
  }

  stop(): void {
    this.stopCapture();
    this.qwen.close();
  }

  dispose(): void {
    this.qwen.close();
    this.sidecar.stop();
  }

  private handleAudioChunk(message: AudioChunkMessage): void {
    this.qwen.sendAudio(message.dataBase64);
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
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("subtitle:update", state);
    }
  }
}

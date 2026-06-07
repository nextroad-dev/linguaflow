import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { SubtitleSegment, SubtitleState } from "@protocol";

type QwenProviderEvents = {
  open: [];
  ready: [];
  close: [code: number, reason: string];
  error: [error: Error];
  subtitle: [state: SubtitleState];
  raw: [message: unknown];
};

export type QwenProviderOptions = {
  apiKey?: string;
  model?: string;
  url?: string;
  region?: "cn" | "intl";
  sourceLanguage?: string;
  targetLanguage?: string;
};

export declare interface QwenProvider {
  on<K extends keyof QwenProviderEvents>(event: K, listener: (...args: QwenProviderEvents[K]) => void): this;
  once<K extends keyof QwenProviderEvents>(event: K, listener: (...args: QwenProviderEvents[K]) => void): this;
  off<K extends keyof QwenProviderEvents>(event: K, listener: (...args: QwenProviderEvents[K]) => void): this;
  emit<K extends keyof QwenProviderEvents>(event: K, ...args: QwenProviderEvents[K]): boolean;
}

export class QwenProvider extends EventEmitter {
  private ws: WebSocket | null = null;
  private sourceText = "";
  private translatedText = "";
  private currentSegmentId = randomUUID();
  private sessionReady = false;

  private apiKey: string;
  private readonly model: string;
  private url: string;
  private readonly sourceLanguage: string;
  private readonly targetLanguage: string;

  public subtitleState: SubtitleState;

  constructor(options: QwenProviderOptions = {}) {
    super();

    this.apiKey = options.apiKey ?? process.env.DASHSCOPE_API_KEY ?? "";
    this.model = options.model ?? process.env.QWEN_REALTIME_MODEL ?? "qwen3.5-livetranslate-flash-realtime";
    this.url =
      options.url ??
      process.env.QWEN_REALTIME_URL ??
      getRealtimeEndpoint(options.region ?? readRegionFromEnv() ?? "cn");
    this.sourceLanguage = options.sourceLanguage ?? "auto";
    this.targetLanguage = options.targetLanguage ?? "zh";
    this.subtitleState = {
      isListening: false,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      history: []
    };
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    if (!this.apiKey) {
      throw new Error("DASHSCOPE_API_KEY is required to connect Qwen realtime WebSocket");
    }

    const endpoint = `${this.url}?model=${encodeURIComponent(this.model)}`;

    this.ws = new WebSocket(endpoint, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "X-DashScope-Beta": "realtime=v1"
      }
    });

    this.ws.on("open", () => {
      const { lastError: _lastError, ...state } = this.subtitleState;
      this.subtitleState = { ...state, isListening: true };
      this.emit("open");
      this.configureSession();
      this.emitSubtitle(false);
    });

    this.ws.on("message", (data) => {
      this.handleMessage(data);
    });

    this.ws.on("error", (error) => {
      this.subtitleState = { ...this.subtitleState, lastError: error.message };
      this.emit("error", error);
      this.emitSubtitle(false);
    });

    this.ws.on("close", (code, buffer) => {
      const reason = buffer.toString("utf8");
      this.subtitleState = { ...this.subtitleState, isListening: false };
      this.emit("close", code, reason);
      this.emitSubtitle(false);
      this.ws = null;
    });
  }

  close(): void {
    this.sendJson({
      event_id: randomUUID(),
      type: "session.finish"
    });
    this.ws?.close();
    this.ws = null;
    this.sessionReady = false;
    this.subtitleState = { ...this.subtitleState, isListening: false };
    this.emitSubtitle(false);
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  setRegion(region: "cn" | "intl"): void {
    this.url = getRealtimeEndpoint(region);
  }

  sendAudio(base64Data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionReady) {
      return;
    }

    this.ws.send(
      JSON.stringify({
        event_id: randomUUID(),
        type: "input_audio_buffer.append",
        audio: base64Data
      })
    );
  }

  private configureSession(): void {
    this.sendJson({
      event_id: randomUUID(),
      type: "session.update",
      session: {
        modalities: ["text"],
        input_audio_format: "pcm",
        output_audio_format: "pcm",
        input_audio_transcription: {
          model: "qwen3-asr-flash-realtime",
          language: this.sourceLanguage === "auto" ? "en" : this.sourceLanguage
        },
        translation: {
          language: this.targetLanguage
        }
      }
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    let payload: unknown;

    try {
      payload = JSON.parse(data.toString("utf8"));
    } catch (cause) {
      this.emit("error", new Error("Failed to parse Qwen WebSocket message", { cause }));
      return;
    }

    this.emit("raw", payload);
    this.handleControlEvent(payload);
    this.applySubtitleDelta(payload);
  }

  private handleControlEvent(payload: unknown): void {
    if (!isRecord(payload)) {
      return;
    }

    const type = readString(payload, "type");

    if (type === "session.updated") {
      this.sessionReady = true;
      this.emit("ready");
      return;
    }

    if (type === "error") {
      const message = pickNestedText(payload, [["error", "message"]]) ?? "Qwen realtime server returned an error";
      this.emit("error", new Error(message));
    }
  }

  private applySubtitleDelta(payload: unknown): void {
    if (!isRecord(payload)) {
      return;
    }

    const type = readString(payload, "type");
    const transcript = pickCompositeText(payload, ["transcript", "text", "delta", "stash"]);
    const translation = pickNestedText(payload, [
      ["translation"],
      ["output", "translation"],
      ["response", "translation"],
      ["response", "audio_transcript", "text"],
      ["response", "text"]
    ]);

    if (isSourceTranscriptEvent(type) && transcript) {
      this.sourceText = transcript;
    }

    if (isTranslationEvent(type) && (translation || transcript)) {
      this.translatedText = translation ?? transcript ?? this.translatedText;
    }

    if (!this.sourceText && transcript && !isTranslationEvent(type)) {
      this.sourceText = transcript;
    }

    if (!this.translatedText && translation) {
      this.translatedText = translation;
    }

    if (this.sourceText || this.translatedText) {
      this.emitSubtitle(isFinalEvent(type));
    }
  }

  private emitSubtitle(isFinal: boolean): void {
    const now = Date.now();
    const current: SubtitleSegment = {
      id: this.currentSegmentId,
      sourceText: this.sourceText,
      translatedText: this.translatedText,
      startedAtMs: now,
      updatedAtMs: now,
      isFinal
    };

    const history = isFinal ? [...this.subtitleState.history, current] : this.subtitleState.history;
    const { current: _current, ...state } = this.subtitleState;

    this.subtitleState = isFinal ? { ...state, history } : { ...state, current, history };

    this.emit("subtitle", this.subtitleState);

    if (isFinal) {
      this.currentSegmentId = randomUUID();
      this.sourceText = "";
      this.translatedText = "";
    }
  }

  private sendJson(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}

function isSourceTranscriptEvent(type: string | undefined): boolean {
  return Boolean(type?.includes("transcription") || type?.includes("transcript"));
}

function isTranslationEvent(type: string | undefined): boolean {
  return Boolean(type?.includes("response.") || type?.includes("translation") || type?.includes("audio_transcript"));
}

function isFinalEvent(type: string | undefined): boolean {
  return Boolean(type?.endsWith(".done") || type?.endsWith(".completed") || type === "response.done");
}

function pickText(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readString(payload, key);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function pickCompositeText(payload: Record<string, unknown>, keys: string[]): string | undefined {
  const text = pickText(payload, keys);
  const stash = readString(payload, "stash");

  if (text && stash && text !== stash) {
    return `${text}${stash}`;
  }

  return text ?? stash;
}

function pickNestedText(payload: Record<string, unknown>, paths: string[][]): string | undefined {
  for (const path of paths) {
    let value: unknown = payload;

    for (const key of path) {
      if (!isRecord(value)) {
        value = undefined;
        break;
      }

      value = value[key];
    }

    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRegionFromEnv(): "cn" | "intl" | undefined {
  return process.env.QWEN_REALTIME_REGION === "intl" || process.env.QWEN_REALTIME_REGION === "cn"
    ? process.env.QWEN_REALTIME_REGION
    : undefined;
}

function getRealtimeEndpoint(region: "cn" | "intl"): string {
  return region === "intl"
    ? "wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime"
    : "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
}

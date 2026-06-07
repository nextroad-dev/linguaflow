import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

type QwenProviderEvents = {
  open: [];
  ready: [];
  close: [code: number, reason: string];
  error: [error: Error];
  text: [event: QwenSubtitleTextEvent];
  raw: [message: unknown];
};

export type QwenSubtitleTextEvent = {
  sourceText?: string;
  translatedText?: string;
  isFinal: boolean;
  receivedAtMs: number;
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
  private sessionReady = false;

  private apiKey: string;
  private readonly model: string;
  private url: string;
  private readonly sourceLanguage: string;
  private readonly targetLanguage: string;

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
  }

  getSourceLanguage(): string {
    return this.sourceLanguage;
  }

  getTargetLanguage(): string {
    return this.targetLanguage;
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
      this.emit("open");
      this.configureSession();
    });

    this.ws.on("message", (data) => {
      this.handleMessage(data);
    });

    this.ws.on("error", (error) => {
      this.emit("error", error);
    });

    this.ws.on("close", (code, buffer) => {
      const reason = buffer.toString("utf8");
      this.emit("close", code, reason);
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
    this.sourceText = "";
    this.translatedText = "";
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

  commitAudio(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionReady) {
      return;
    }

    this.sendJson({
      event_id: randomUUID(),
      type: "input_audio_buffer.commit"
    });
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
        },
        turn_detection: null
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
    const transcript = pickSourceTranscriptText(payload, type);
    const translation = pickTranslationText(payload, type);
    const isFinal = isFinalEvent(type) && isTranslationEvent(type);
    let changed = false;

    if (isSourceTranscriptEvent(type) && transcript) {
      this.sourceText = mergeText(this.sourceText, transcript.text, transcript.mode);
      changed = true;
    }

    if (isTranslationEvent(type) && translation && this.isLikelyTargetLanguage(translation.text)) {
      this.translatedText = mergeText(this.translatedText, translation.text, translation.mode);
      changed = true;
    }

    if (!this.sourceText && transcript && !isTranslationEvent(type)) {
      this.sourceText = transcript.text;
      changed = true;
    }

    if (changed || (isFinal && (this.sourceText || this.translatedText))) {
      this.emit("text", {
        sourceText: this.sourceText || undefined,
        translatedText: this.translatedText || undefined,
        isFinal,
        receivedAtMs: Date.now()
      });
    }

    if (isFinal) {
      this.sourceText = "";
      this.translatedText = "";
    }
  }

  private isLikelyTargetLanguage(text: string): boolean {
    if (this.targetLanguage !== "zh") {
      return true;
    }

    return isLikelyChineseTranslation(text);
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

function isLikelyChineseTranslation(text: string): boolean {
  const visibleText = text.trim();

  if (!visibleText) {
    return false;
  }

  const hanCount = countMatches(visibleText, /[\u3400-\u9fff]/g);

  if (hanCount > 0) {
    return true;
  }

  const latinCount = countMatches(visibleText, /[A-Za-z]/g);
  const meaningfulCount = countMatches(visibleText, /[\p{L}\p{N}]/gu);

  return meaningfulCount > 0 && latinCount / meaningfulCount < 0.35;
}

type PickedText = {
  text: string;
  mode: "snapshot" | "delta";
};

function pickSourceTranscriptText(payload: Record<string, unknown>, type: string | undefined): PickedText | undefined {
  const transcript = readString(payload, "transcript");

  if (transcript) {
    return { text: transcript, mode: type?.includes(".delta") ? "delta" : "snapshot" };
  }

  const stash = readString(payload, "stash");

  if (stash) {
    return { text: stash, mode: "snapshot" };
  }

  if (!isSourceTranscriptEvent(type)) {
    return undefined;
  }

  const text = readString(payload, "text");

  if (text) {
    return { text, mode: type?.includes(".delta") ? "delta" : "snapshot" };
  }

  const delta = readString(payload, "delta");

  if (delta) {
    return { text: delta, mode: "delta" };
  }

  return undefined;
}

function pickTranslationText(payload: Record<string, unknown>, type: string | undefined): PickedText | undefined {
  const nestedText =
    pickNestedText(payload, [
      ["translation"],
      ["output", "translation"],
      ["response", "translation"],
      ["response", "audio_transcript", "text"],
      ["response", "text"]
    ]);

  if (nestedText) {
    return { text: nestedText, mode: "snapshot" };
  }

  const text = readString(payload, "text");

  if (text) {
    return { text, mode: "snapshot" };
  }

  const delta = readString(payload, "delta");

  if (delta) {
    return { text: delta, mode: type?.includes(".delta") ? "delta" : "snapshot" };
  }

  return undefined;
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function mergeText(currentText: string, nextText: string, mode: "snapshot" | "delta"): string {
  if (mode === "snapshot") {
    return nextText;
  }

  if (!currentText || currentText.endsWith(nextText)) {
    return currentText || nextText;
  }

  return `${currentText}${nextText}`;
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

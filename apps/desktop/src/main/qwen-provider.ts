import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

type QwenProviderEvents = {
  open: [];
  ready: [];
  close: [code: number, reason: string];
  error: [error: Error];
  text: [event: QwenSubtitleTextEvent];
  audio: [event: QwenAudioOutputEvent];
  raw: [message: unknown];
};

export type QwenSubtitleTextEvent = {
  sourceText?: string;
  translatedText?: string;
  isFinal: boolean;
  receivedAtMs: number;
};

export type QwenAudioOutputEvent = {
  pcm16Base64: string;
  sampleRate: 24000;
  channels: 1;
  receivedAtMs: number;
};

export type QwenInputAudioFormat = "pcm" | "opus";
export type QwenOutputAudioFormat = "pcm";
export type QwenTurnDetectionType = "server_vad" | "semantic_vad";
export type QwenVoiceCloneFrequency = "never" | "once" | "always";

export type QwenTurnDetectionOptions = {
  type: QwenTurnDetectionType;
  threshold: number;
  silence_duration_ms: number;
};

export type QwenRealtimeOptions = {
  enableQwenRealtime: boolean;
  enableVoiceOutput: boolean;
  voice?: string;
  sourceLanguage: string;
  targetLanguage: string;
  sampleRate: number;
  inputAudioFormat: QwenInputAudioFormat;
  outputAudioFormat: QwenOutputAudioFormat;
  turnDetection: QwenTurnDetectionOptions;
  phrases?: Record<string, string>;
  enableVoiceClone?: boolean;
  voiceCloneFrequency?: QwenVoiceCloneFrequency;
};

export type QwenSessionUpdate = {
  event_id: string;
  type: "session.update";
  session: Record<string, unknown>;
};

export type QwenProviderOptions = {
  apiKey?: string;
  model?: string;
  url?: string;
  region?: "cn" | "intl";
  realtime?: Partial<QwenRealtimeOptions>;
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
  private realtimeOptions: QwenRealtimeOptions;

  constructor(options: QwenProviderOptions = {}) {
    super();

    this.apiKey = options.apiKey ?? process.env.DASHSCOPE_API_KEY ?? "";
    this.model = options.model ?? process.env.QWEN_REALTIME_MODEL ?? "qwen3.5-livetranslate-flash-realtime";
    this.url =
      options.url ??
      process.env.QWEN_REALTIME_URL ??
      getRealtimeEndpoint(options.region ?? readRegionFromEnv() ?? "cn");
    this.realtimeOptions = normalizeRealtimeOptions(options.realtime);
  }

  getSourceLanguage(): string {
    return this.realtimeOptions.sourceLanguage;
  }

  getTargetLanguage(): string {
    return this.realtimeOptions.targetLanguage;
  }

  getRealtimeOptions(): QwenRealtimeOptions {
    return this.realtimeOptions;
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

    this.ws.on("unexpected-response", (_request, response) => {
      this.emit("error", new Error(`Qwen realtime WebSocket rejected connection: HTTP ${response.statusCode}`));
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

  setRealtimeOptions(options: Partial<QwenRealtimeOptions>): void {
    this.realtimeOptions = normalizeRealtimeOptions({
      ...this.realtimeOptions,
      ...options
    });

    if (this.ws?.readyState === WebSocket.OPEN && this.sessionReady) {
      this.configureSession();
    }
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
    // Qwen semantic VAD controls turn boundaries; audio is streamed with append events only.
  }

  private configureSession(): void {
    this.sendJson(buildSessionUpdate(this.realtimeOptions));
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
    this.applyAudioDelta(payload);
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

    if (isTranslationEvent(type) && translation) {
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

  private applyAudioDelta(payload: unknown): void {
    if (!isRecord(payload)) {
      return;
    }

    const type = readString(payload, "type");

    if (type !== "response.audio.delta") {
      return;
    }

    const delta = readString(payload, "delta");

    if (!delta) {
      return;
    }

    this.emit("audio", {
      pcm16Base64: delta,
      sampleRate: 24000,
      channels: 1,
      receivedAtMs: Date.now()
    });
  }

  private sendJson(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}

export function buildSessionUpdate(options: QwenRealtimeOptions): QwenSessionUpdate {
  const normalizedOptions = normalizeRealtimeOptions(options);
  const session: Record<string, unknown> = {
    modalities: buildOutputModalities(normalizedOptions),
    instructions:
      `You are a realtime interpreter. Translate the user's speech into ${normalizedOptions.targetLanguage} naturally and concisely. Do not answer questions or add explanations. Only output the translation. Use a natural tone, slightly fast pace, suitable for simultaneous interpreting.`,
    input_audio_format: normalizedOptions.inputAudioFormat,
    output_audio_format: normalizedOptions.outputAudioFormat,
    input_audio_transcription: {
      model: "qwen3-asr-flash-realtime",
      language: normalizedOptions.sourceLanguage
    },
    translation: buildTranslationOptions(normalizedOptions),
    turn_detection: normalizedOptions.turnDetection
  };

  if (normalizedOptions.enableVoiceOutput || normalizedOptions.enableVoiceClone) {
    const voice = resolveVoice(normalizedOptions);

    if (voice) {
      session.voice = voice;
    }
  }

  if (normalizedOptions.enableVoiceClone) {
    const frequency = normalizedOptions.voiceCloneFrequency ?? "never";
    session.enable_voice_clone = true;
    session.voice_clone_options = { frequency };

    if (frequency === "once" || frequency === "always") {
      session.voice = "default";
    }
  }

  return {
    event_id: randomUUID(),
    type: "session.update",
    session
  };
}

function buildTranslationOptions(options: QwenRealtimeOptions): Record<string, unknown> {
  const translation: Record<string, unknown> = {
    language: options.targetLanguage
  };
  const phrases = normalizePhrases(options.phrases);

  if (Object.keys(phrases).length > 0) {
    translation.corpus = {
      phrases
    };
  }

  return translation;
}

function buildOutputModalities(options: QwenRealtimeOptions): string[] {
  const modalities = ["text"];

  if (options.enableVoiceOutput) {
    modalities.push("audio");
  }

  return modalities;
}

export function normalizeRealtimeOptions(options: Partial<QwenRealtimeOptions> = {}): QwenRealtimeOptions {
  return {
    enableQwenRealtime: readBoolean(options.enableQwenRealtime, true),
    enableVoiceOutput: readBoolean(options.enableVoiceOutput, false),
    voice: normalizeOptionalString(options.voice),
    sourceLanguage: normalizeLanguage(options.sourceLanguage, "en"),
    targetLanguage: normalizeLanguage(options.targetLanguage, "zh"),
    sampleRate: normalizeSampleRate(options.sampleRate),
    inputAudioFormat: options.inputAudioFormat === "opus" ? "opus" : "pcm",
    outputAudioFormat: "pcm",
    turnDetection: normalizeTurnDetection(options.turnDetection),
    phrases: normalizePhrases(options.phrases),
    enableVoiceClone: readBoolean(options.enableVoiceClone, false),
    voiceCloneFrequency: normalizeVoiceCloneFrequency(options.voiceCloneFrequency)
  };
}

function normalizeTurnDetection(value: Partial<QwenTurnDetectionOptions> | undefined): QwenTurnDetectionOptions {
  return {
    type: value?.type === "server_vad" ? "server_vad" : "semantic_vad",
    threshold: normalizeNumber(value?.threshold, 0.5, 0, 1),
    silence_duration_ms: Math.round(normalizeNumber(value?.silence_duration_ms, 800, 0, 5000))
  };
}

function normalizePhrases(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const phrases: Record<string, string> = {};

  for (const [source, target] of Object.entries(value)) {
    if (source.trim() && typeof target === "string" && target.trim()) {
      phrases[source.trim()] = target.trim();
    }
  }

  return phrases;
}

function resolveVoice(options: QwenRealtimeOptions): string | undefined {
  if (options.enableVoiceClone) {
    const frequency = options.voiceCloneFrequency ?? "never";
    return frequency === "never" ? options.voice || process.env.QWEN_REALTIME_VOICE : "default";
  }

  return options.voice || process.env.QWEN_REALTIME_VOICE || undefined;
}

function normalizeVoiceCloneFrequency(value: unknown): QwenVoiceCloneFrequency {
  return value === "once" || value === "always" || value === "never" ? value : "never";
}

function normalizeSampleRate(value: unknown): number {
  const sampleRate = normalizeNumber(value, 16000, 8000, 48000);
  return Math.round(sampleRate);
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeLanguage(value: unknown, fallback: string): string {
  const language = normalizeString(value, fallback);
  return ["zh", "en", "ja", "ko", "fr", "de", "es", "it", "pt", "ru", "ar"].includes(language) ? language : fallback;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isSourceTranscriptEvent(type: string | undefined): boolean {
  return Boolean(type?.startsWith("conversation.item.input_audio_transcription"));
}

function isTranslationEvent(type: string | undefined): boolean {
  return Boolean(
    type === "response.done" ||
      type?.startsWith("response.audio_transcript") ||
      type?.startsWith("response.text") ||
      type?.includes("translation")
  );
}

function isFinalEvent(type: string | undefined): boolean {
  return Boolean(type === "response.done" || type?.endsWith(".completed") || type === "response.audio_transcript.done");
}

type PickedText = {
  text: string;
  mode: "snapshot" | "delta";
};

function pickSourceTranscriptText(payload: Record<string, unknown>, type: string | undefined): PickedText | undefined {
  const transcript = readString(payload, "transcript");

  if (isFinalEvent(type) && transcript) {
    return { text: transcript, mode: "snapshot" };
  }

  const textWithStash = readTextWithStash(payload);

  if (textWithStash) {
    return { text: textWithStash, mode: "snapshot" };
  }

  if (transcript) {
    return { text: transcript, mode: "snapshot" };
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
  const transcript = readString(payload, "transcript");

  if (isFinalEvent(type) && transcript) {
    return { text: transcript, mode: "snapshot" };
  }

  const textWithStash = readTextWithStash(payload);

  if (textWithStash && isTranslationEvent(type)) {
    return { text: textWithStash, mode: "snapshot" };
  }

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

  if (transcript) {
    return { text: transcript, mode: "snapshot" };
  }

  const delta = readString(payload, "delta");

  if (delta) {
    return { text: delta, mode: type?.includes(".delta") ? "delta" : "snapshot" };
  }

  return undefined;
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

function readTextWithStash(payload: Record<string, unknown>): string | undefined {
  const text = readString(payload, "text");
  const stash = readString(payload, "stash");

  if (text === undefined && stash === undefined) {
    return undefined;
  }

  return `${text ?? ""}${stash ?? ""}`;
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

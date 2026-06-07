export type JsonlMessageDirection = "sidecar-to-main" | "main-to-sidecar";

export type AudioSampleFormat = "pcm_s16le";

export type AudioChunkMessage = {
  direction: "sidecar-to-main";
  type: "audio.chunk";
  sequence: number;
  timestampMs: number;
  sampleRate: number;
  channels: number;
  format: AudioSampleFormat;
  deviceName?: string;
  rms?: number;
  peak?: number;
  dataBase64: string;
};

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogMessage = {
  direction: "sidecar-to-main";
  type: "log";
  level: LogLevel;
  message: string;
  timestampMs: number;
  scope?: string;
  details?: Record<string, unknown>;
};

export type ControlCommand =
  | {
      direction: "main-to-sidecar";
      type: "control.start";
      requestId: string;
      sampleRate: number;
      channels: number;
      format: AudioSampleFormat;
    }
  | {
      direction: "main-to-sidecar";
      type: "control.stop";
      requestId: string;
    }
  | {
      direction: "main-to-sidecar";
      type: "control.shutdown";
      requestId: string;
    };

export type SidecarToMainMessage = AudioChunkMessage | LogMessage;

export type MainToSidecarMessage = ControlCommand;

export type SubtitleSegment = {
  id: string;
  sourceText: string;
  translatedText: string;
  startedAtMs: number;
  updatedAtMs: number;
  isFinal: boolean;
};

export type SubtitleState = {
  isListening: boolean;
  sourceLanguage?: string;
  targetLanguage?: string;
  visible?: SubtitleSegment;
  current?: SubtitleSegment;
  history: SubtitleSegment[];
  lastError?: string;
};

import type { AudioChunkMessage } from "@protocol";

export type SentenceBoundaryReason = "silence" | "max-duration" | "flush";

export type SentenceBoundaryEvent = {
  reason: SentenceBoundaryReason;
  segmentDurationMs: number;
  trailingSilenceMs: number;
};

export type AudioSentenceSegmentationOptions = {
  silenceDurationMs?: number;
  maxSentenceDurationMs?: number;
  silenceRmsThreshold?: number;
  prerollDurationMs?: number;
};

type AudioSentenceSegmenterSink = {
  sendAudio: (base64Data: string) => void;
  commitAudio: () => void;
};

type ResolvedAudioSentenceSegmentationOptions = Required<AudioSentenceSegmentationOptions>;

const DEFAULT_OPTIONS: ResolvedAudioSentenceSegmentationOptions = {
  silenceDurationMs: readPositiveNumberFromEnv("LINGUFLOW_SENTENCE_SILENCE_MS", 700),
  maxSentenceDurationMs: readPositiveNumberFromEnv("LINGUFLOW_SENTENCE_MAX_MS", 12_000),
  silenceRmsThreshold: readPositiveNumberFromEnv("LINGUFLOW_SENTENCE_SILENCE_RMS", 0.008),
  prerollDurationMs: readPositiveNumberFromEnv("LINGUFLOW_SENTENCE_PREROLL_MS", 400)
};

export class AudioSentenceSegmenter {
  private readonly options: ResolvedAudioSentenceSegmentationOptions;
  private readonly prerollChunks: AudioChunkMessage[] = [];
  private segmentDurationMs = 0;
  private trailingSilenceMs = 0;
  private hasActiveSegment = false;

  constructor(
    private readonly sink: AudioSentenceSegmenterSink,
    options: AudioSentenceSegmentationOptions = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...dropUndefinedOptions(options) };
  }

  handleChunk(chunk: AudioChunkMessage): SentenceBoundaryEvent | undefined {
    const durationMs = getChunkDurationMs(chunk);
    const isSilent = this.isSilentChunk(chunk);

    if (!this.hasActiveSegment) {
      if (isSilent) {
        this.rememberPreroll(chunk);
        return undefined;
      }

      this.startSegment();
    }

    if (this.segmentDurationMs === 0 && this.prerollChunks.length > 0) {
      this.sendPreroll();
    }

    this.sink.sendAudio(chunk.dataBase64);
    this.segmentDurationMs += durationMs;
    this.trailingSilenceMs = isSilent ? this.trailingSilenceMs + durationMs : 0;

    if (this.trailingSilenceMs >= this.options.silenceDurationMs) {
      return this.commit("silence");
    }

    if (this.segmentDurationMs >= this.options.maxSentenceDurationMs) {
      return this.commit("max-duration");
    }

    return undefined;
  }

  flush(): SentenceBoundaryEvent | undefined {
    if (!this.hasActiveSegment) {
      this.reset();
      return undefined;
    }

    return this.commit("flush");
  }

  reset(): void {
    this.prerollChunks.length = 0;
    this.segmentDurationMs = 0;
    this.trailingSilenceMs = 0;
    this.hasActiveSegment = false;
  }

  private startSegment(): void {
    this.hasActiveSegment = true;
    this.segmentDurationMs = 0;
    this.trailingSilenceMs = 0;
  }

  private commit(reason: SentenceBoundaryReason): SentenceBoundaryEvent {
    const event: SentenceBoundaryEvent = {
      reason,
      segmentDurationMs: this.segmentDurationMs,
      trailingSilenceMs: this.trailingSilenceMs
    };

    this.sink.commitAudio();
    this.reset();
    return event;
  }

  private sendPreroll(): void {
    for (const chunk of this.prerollChunks) {
      this.sink.sendAudio(chunk.dataBase64);
    }

    this.prerollChunks.length = 0;
  }

  private rememberPreroll(chunk: AudioChunkMessage): void {
    this.prerollChunks.push(chunk);

    let durationMs = this.prerollChunks.reduce((total, item) => total + getChunkDurationMs(item), 0);

    while (durationMs > this.options.prerollDurationMs && this.prerollChunks.length > 0) {
      const removed = this.prerollChunks.shift();
      durationMs -= removed ? getChunkDurationMs(removed) : 0;
    }
  }

  private isSilentChunk(chunk: AudioChunkMessage): boolean {
    return (chunk.rms ?? 0) < this.options.silenceRmsThreshold;
  }
}

function getChunkDurationMs(chunk: AudioChunkMessage): number {
  const bytesPerSample = chunk.format === "pcm_s16le" ? 2 : 2;
  const bytesPerMillisecond = (chunk.sampleRate * chunk.channels * bytesPerSample) / 1000;

  if (bytesPerMillisecond <= 0) {
    return 0;
  }

  return Math.max(1, Math.round((Buffer.byteLength(chunk.dataBase64, "base64") / bytesPerMillisecond)));
}

function dropUndefinedOptions(
  options: AudioSentenceSegmentationOptions
): Partial<ResolvedAudioSentenceSegmentationOptions> {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}

function readPositiveNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

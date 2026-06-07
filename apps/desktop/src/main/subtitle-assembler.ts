import { randomUUID } from "node:crypto";
import type { SubtitleSegment, SubtitleState } from "@protocol";
import type { SentenceBoundaryReason } from "./audio-sentence-segmenter";
import type { QwenSubtitleTextEvent } from "./qwen-provider";

export type SubtitleAssemblerOptions = {
  sourceLanguage?: string;
  targetLanguage?: string;
  finalDwellMs?: number;
  softFinalizeMs?: number;
  maxHistoryItems?: number;
};

type ResolvedSubtitleAssemblerOptions = Required<SubtitleAssemblerOptions>;

const DEFAULT_OPTIONS: ResolvedSubtitleAssemblerOptions = {
  sourceLanguage: "auto",
  targetLanguage: "zh",
  finalDwellMs: 1800,
  softFinalizeMs: 1400,
  maxHistoryItems: 80
};

export class SubtitleAssembler {
  private readonly options: ResolvedSubtitleAssemblerOptions;
  private state: SubtitleState;
  private activeSegment: SubtitleSegment | undefined;
  private softFinalizeTimer: ReturnType<typeof setTimeout> | undefined;
  private clearTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    options: SubtitleAssemblerOptions = {},
    private readonly onUpdate?: (state: SubtitleState) => void
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...dropUndefinedOptions(options) };
    this.state = {
      isListening: false,
      sourceLanguage: this.options.sourceLanguage,
      targetLanguage: this.options.targetLanguage,
      history: []
    };
  }

  getState(): SubtitleState {
    return this.state;
  }

  setListening(isListening: boolean): void {
    const { lastError: _lastError, ...state } = this.state;
    this.state = { ...state, isListening };
    this.emit();
  }

  setError(message: string): void {
    this.state = { ...this.state, lastError: message };
    this.emit();
  }

  applyTextEvent(event: QwenSubtitleTextEvent): void {
    if (!event.sourceText && !event.translatedText) {
      return;
    }

    this.cancelClear();
    this.cancelSoftFinalize();

    const now = event.receivedAtMs;
    const activeSegment = this.getOrCreateActiveSegment(now);
    const nextSegment: SubtitleSegment = {
      ...activeSegment,
      sourceText: event.sourceText ?? activeSegment.sourceText,
      translatedText: event.translatedText ?? activeSegment.translatedText,
      updatedAtMs: now,
      isFinal: event.isFinal
    };

    this.activeSegment = nextSegment;

    if (event.isFinal) {
      this.finalizeActiveSegment();
      return;
    }

    this.state = {
      ...this.state,
      current: nextSegment,
      visible: nextSegment
    };
    this.emit();
  }

  applySentenceBoundary(reason: SentenceBoundaryReason): void {
    if (!this.activeSegment || !hasText(this.activeSegment)) {
      return;
    }

    if (reason === "max-duration") {
      this.publishActiveSegment();
      return;
    }

    this.scheduleSoftFinalize();
  }

  flush(): void {
    if (this.activeSegment && hasText(this.activeSegment)) {
      this.finalizeActiveSegment();
      return;
    }

    this.clearVisibleSubtitle();
  }

  reset(): void {
    this.cancelSoftFinalize();
    this.cancelClear();
    this.activeSegment = undefined;
    this.state = {
      isListening: false,
      sourceLanguage: this.options.sourceLanguage,
      targetLanguage: this.options.targetLanguage,
      history: []
    };
    this.emit();
  }

  dispose(): void {
    this.cancelSoftFinalize();
    this.cancelClear();
  }

  private getOrCreateActiveSegment(now: number): SubtitleSegment {
    if (this.activeSegment) {
      return this.activeSegment;
    }

    this.activeSegment = {
      id: randomUUID(),
      sourceText: "",
      translatedText: "",
      startedAtMs: now,
      updatedAtMs: now,
      isFinal: false
    };

    return this.activeSegment;
  }

  private publishActiveSegment(): void {
    if (!this.activeSegment) {
      return;
    }

    this.state = {
      ...this.state,
      current: this.activeSegment,
      visible: this.activeSegment
    };
    this.emit();
  }

  private finalizeActiveSegment(): void {
    if (!this.activeSegment || !hasText(this.activeSegment)) {
      return;
    }

    this.cancelSoftFinalize();

    const now = Date.now();
    const finalSegment: SubtitleSegment = {
      ...this.activeSegment,
      updatedAtMs: now,
      isFinal: true
    };
    const history = [...this.state.history, finalSegment].slice(-this.options.maxHistoryItems);

    this.activeSegment = undefined;
    this.state = {
      ...this.state,
      current: undefined,
      visible: finalSegment,
      history
    };
    this.emit();
    this.scheduleClear();
  }

  private scheduleSoftFinalize(): void {
    if (this.softFinalizeTimer) {
      return;
    }

    this.softFinalizeTimer = setTimeout(() => {
      this.softFinalizeTimer = undefined;
      this.finalizeActiveSegment();
    }, this.options.softFinalizeMs);
  }

  private scheduleClear(): void {
    this.cancelClear();
    this.clearTimer = setTimeout(() => {
      this.clearTimer = undefined;
      this.clearVisibleSubtitle();
    }, this.options.finalDwellMs);
  }

  private clearVisibleSubtitle(): void {
    this.state = {
      ...this.state,
      current: undefined,
      visible: undefined
    };
    this.emit();
  }

  private cancelSoftFinalize(): void {
    if (this.softFinalizeTimer) {
      clearTimeout(this.softFinalizeTimer);
      this.softFinalizeTimer = undefined;
    }
  }

  private cancelClear(): void {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = undefined;
    }
  }

  private emit(): void {
    this.onUpdate?.(this.state);
  }
}

function hasText(segment: SubtitleSegment): boolean {
  return Boolean(segment.sourceText || segment.translatedText);
}

function dropUndefinedOptions(
  options: SubtitleAssemblerOptions
): Partial<ResolvedSubtitleAssemblerOptions> {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}

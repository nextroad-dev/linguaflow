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
  sourceDisplayChars?: number;
  sourceDisplayWords?: number;
  translatedDisplayChars?: number;
  translatedDisplayWords?: number;
};

type ResolvedSubtitleAssemblerOptions = Required<SubtitleAssemblerOptions>;

const DEFAULT_OPTIONS: ResolvedSubtitleAssemblerOptions = {
  sourceLanguage: "auto",
  targetLanguage: "zh",
  finalDwellMs: 1800,
  softFinalizeMs: 1400,
  maxHistoryItems: 80,
  sourceDisplayChars: 72,
  sourceDisplayWords: 12,
  translatedDisplayChars: 28,
  translatedDisplayWords: 12
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
      visible: this.toVisibleSegment(nextSegment)
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
      visible: this.toVisibleSegment(this.activeSegment)
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
      visible: this.toVisibleSegment(finalSegment),
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

  private toVisibleSegment(segment: SubtitleSegment): SubtitleSegment {
    return {
      ...segment,
      sourceText: fitSubtitleText(segment.sourceText, {
        maxChars: this.options.sourceDisplayChars,
        maxWords: this.options.sourceDisplayWords
      }),
      translatedText: fitSubtitleText(segment.translatedText, {
        maxChars: this.options.translatedDisplayChars,
        maxWords: this.options.translatedDisplayWords
      })
    };
  }

  private emit(): void {
    this.onUpdate?.(this.state);
  }
}

type SubtitleFitOptions = {
  maxChars: number;
  maxWords: number;
};

function fitSubtitleText(text: string, options: SubtitleFitOptions): string {
  const normalizedText = normalizeSubtitleWhitespace(text);

  if (!normalizedText) {
    return "";
  }

  if (shouldFitByWords(normalizedText)) {
    return fitSubtitleWords(normalizedText, options.maxWords, options.maxChars);
  }

  if (normalizedText.length <= options.maxChars) {
    return normalizedText;
  }

  return fitSubtitleChars(normalizedText, options.maxChars);
}

function fitSubtitleWords(text: string, maxWords: number, maxChars: number): string {
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length <= maxWords && text.length <= maxChars) {
    return formatWordLines(words, maxChars);
  }

  let pageWords = words.slice(-maxWords);
  let page = pageWords.join(" ");

  while (page.length > maxChars && pageWords.length > 4) {
    pageWords = pageWords.slice(1);
    page = pageWords.join(" ");
  }

  return formatWordLines(trimLeadingPunctuation(page).split(/\s+/).filter(Boolean), maxChars);
}

function fitSubtitleChars(text: string, maxChars: number): string {
  const pages = splitTextPages(text, maxChars);
  const latestPage = pages.at(-1) ?? text.slice(-maxChars);

  return formatCharacterLines(trimLeadingPunctuation(latestPage), maxChars);
}

function splitTextPages(text: string, maxChars: number): string[] {
  const pages: string[] = [];
  const clauses = text.match(/[^，。！？、；：,.!?;:]+[，。！？、；：,.!?;:]*/g) ?? [text];
  let currentPage = "";

  for (const clause of clauses) {
    const nextPage = `${currentPage}${clause}`;

    if (nextPage.length <= maxChars) {
      currentPage = nextPage;
      continue;
    }

    if (currentPage) {
      pages.push(currentPage.trim());
      currentPage = "";
    }

    if (clause.length <= maxChars) {
      currentPage = clause;
      continue;
    }

    for (let index = 0; index < clause.length; index += maxChars) {
      const page = clause.slice(index, index + maxChars).trim();

      if (page) {
        pages.push(page);
      }
    }
  }

  if (currentPage.trim()) {
    pages.push(currentPage.trim());
  }

  return pages;
}

function normalizeSubtitleWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatCharacterLines(text: string, maxChars: number): string {
  const maxLineChars = Math.max(8, Math.ceil(maxChars / 2));

  if (text.length <= maxLineChars) {
    return text;
  }

  return [text.slice(0, maxLineChars), text.slice(maxLineChars, maxChars)].filter(Boolean).join("\n");
}

function formatWordLines(words: string[], maxChars: number): string {
  const maxLineChars = Math.max(18, Math.ceil(maxChars / 2));
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (nextLine.length <= maxLineChars || lines.length === 1) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.slice(-2).join("\n");
}

function shouldFitByWords(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length < 4) {
    return false;
  }

  const latinCount = countMatches(text, /[A-Za-z]/g);
  const hanCount = countMatches(text, /[\u3400-\u9fff]/g);

  return latinCount > hanCount * 1.5;
}

function trimLeadingPunctuation(text: string): string {
  return text.replace(/^[\s，。！？、；：,.!?;:]+/, "").trim();
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function hasText(segment: SubtitleSegment): boolean {
  return Boolean(segment.sourceText || segment.translatedText);
}

function dropUndefinedOptions(
  options: SubtitleAssemblerOptions
): Partial<ResolvedSubtitleAssemblerOptions> {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}

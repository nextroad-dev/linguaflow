import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import type {
  QwenInputAudioFormat,
  QwenOutputAudioFormat,
  QwenTurnDetectionType,
  QwenVoiceCloneFrequency
} from "./qwen-provider";

export type AppSettings = {
  dashscopeApiKey?: string;
  dashscopeRegion?: "cn" | "intl";
  qwenRealtimeEnabled?: boolean;
  voiceOutputEnabled?: boolean;
  qwenVoice?: string;
  qwenSourceLanguage?: string;
  qwenTargetLanguage?: string;
  qwenSampleRate?: number;
  qwenInputAudioFormat?: QwenInputAudioFormat;
  qwenOutputAudioFormat?: QwenOutputAudioFormat;
  qwenTurnDetectionType?: QwenTurnDetectionType;
  qwenVadThreshold?: number;
  qwenSilenceDurationMs?: number;
  qwenPhrases?: Record<string, string>;
  qwenVoiceCloneEnabled?: boolean;
  qwenVoiceCloneFrequency?: QwenVoiceCloneFrequency;
  subtitleTheme?: SubtitleTheme;
  subtitlePosition?: SubtitlePosition;
  subtitleDisplayMode?: SubtitleDisplayMode;
  subtitleFontSize?: SubtitleFontSize;
  subtitleBackgroundOpacity?: number;
};

export type SubtitleTheme = "classic-white" | "stroke-dark" | "light-bar" | "high-contrast";

export type SubtitlePosition = "top" | "center" | "bottom" | "bottom-left" | "bottom-right";

export type SubtitleDisplayMode = "bilingual" | "translated-only";

export type SubtitleFontSize = "small" | "medium" | "large";

export const defaultSubtitleTheme: SubtitleTheme = "classic-white";
export const defaultSubtitlePosition: SubtitlePosition = "bottom";
export const defaultSubtitleDisplayMode: SubtitleDisplayMode = "bilingual";
export const defaultSubtitleFontSize: SubtitleFontSize = "medium";
export const defaultSubtitleBackgroundOpacity = 0.5;
export const defaultQwenRealtimeEnabled = true;
export const defaultVoiceOutputEnabled = false;
export const defaultQwenSourceLanguage = "en";
export const defaultQwenTargetLanguage = "zh";
export const defaultQwenSampleRate = 16000;
export const defaultQwenInputAudioFormat: QwenInputAudioFormat = "pcm";
export const defaultQwenOutputAudioFormat: QwenOutputAudioFormat = "pcm";
export const defaultQwenTurnDetectionType: QwenTurnDetectionType = "semantic_vad";
export const defaultQwenVadThreshold = 0.5;
export const defaultQwenSilenceDurationMs = 800;
export const defaultQwenVoiceCloneEnabled = false;
export const defaultQwenVoiceCloneFrequency: QwenVoiceCloneFrequency = "never";
const qwenLanguageCodes = new Set(["zh", "en", "ja", "ko", "fr", "de", "es", "it", "pt", "ru", "ar"]);

export function loadSettings(): AppSettings {
  try {
    return JSON.parse(readFileSync(getSettingsPath(), "utf8")) as AppSettings;
  } catch {
    return {};
  }
}

export function saveSettings(settings: AppSettings): void {
  const settingsPath = getSettingsPath();
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
}

export function maskSecret(value: string | undefined): string {
  if (!value) {
    return "";
  }

  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}${"*".repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

export function normalizeSubtitleTheme(value: unknown): SubtitleTheme {
  return value === "stroke-dark" || value === "light-bar" || value === "high-contrast" || value === "classic-white"
    ? value
    : defaultSubtitleTheme;
}

export function normalizeSubtitlePosition(value: unknown): SubtitlePosition {
  return value === "top" || value === "center" || value === "bottom-left" || value === "bottom-right" || value === "bottom"
    ? value
    : defaultSubtitlePosition;
}

export function normalizeSubtitleDisplayMode(value: unknown): SubtitleDisplayMode {
  return value === "translated-only" || value === "bilingual" ? value : defaultSubtitleDisplayMode;
}

export function normalizeSubtitleFontSize(value: unknown): SubtitleFontSize {
  return value === "small" || value === "large" || value === "medium" ? value : defaultSubtitleFontSize;
}

export function normalizeSubtitleBackgroundOpacity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultSubtitleBackgroundOpacity;
  }

  return Math.min(0.75, Math.max(0.25, value));
}

export function normalizeBooleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeStringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeQwenLanguageSetting(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const language = value.trim();
  return qwenLanguageCodes.has(language) ? language : fallback;
}

export function normalizeOptionalStringSetting(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeNumberSetting(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

export function normalizeQwenInputAudioFormat(value: unknown): QwenInputAudioFormat {
  return value === "opus" ? "opus" : defaultQwenInputAudioFormat;
}

export function normalizeQwenOutputAudioFormat(_value: unknown): QwenOutputAudioFormat {
  return defaultQwenOutputAudioFormat;
}

export function normalizeQwenTurnDetectionType(value: unknown): QwenTurnDetectionType {
  return value === "server_vad" ? "server_vad" : defaultQwenTurnDetectionType;
}

export function normalizeQwenVoiceCloneFrequency(value: unknown): QwenVoiceCloneFrequency {
  return value === "once" || value === "always" || value === "never" ? value : defaultQwenVoiceCloneFrequency;
}

export function normalizeQwenPhrases(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) {
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

function getSettingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";

export type AppSettings = {
  dashscopeApiKey?: string;
  dashscopeRegion?: "cn" | "intl";
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

function getSettingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

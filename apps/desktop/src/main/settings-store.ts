import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";

export type AppSettings = {
  dashscopeApiKey?: string;
  dashscopeRegion?: "cn" | "intl";
};

const settingsPath = join(app.getPath("userData"), "settings.json");

export function loadSettings(): AppSettings {
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8")) as AppSettings;
  } catch {
    return {};
  }
}

export function saveSettings(settings: AppSettings): void {
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

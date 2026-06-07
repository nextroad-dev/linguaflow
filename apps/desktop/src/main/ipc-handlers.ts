import { BrowserWindow, ipcMain } from "electron";
import type { SubtitleState } from "@protocol";
import type { RealtimePipeline } from "./realtime-pipeline";
import {
  loadSettings,
  maskSecret,
  normalizeSubtitleBackgroundOpacity,
  normalizeSubtitleDisplayMode,
  normalizeSubtitleFontSize,
  normalizeSubtitlePosition,
  normalizeSubtitleTheme,
  saveSettings,
  type AppSettings,
  type SubtitleDisplayMode,
  type SubtitleFontSize,
  type SubtitlePosition,
  type SubtitleTheme
} from "./settings-store";

let translationEnabled = false;

export function registerIpcHandlers(pipeline: RealtimePipeline): void {
  ipcMain.removeAllListeners("toggle-translation");
  ipcMain.removeHandler("settings:get");
  ipcMain.removeHandler("settings:save");

  const settings = loadSettings();

  if (settings.dashscopeApiKey) {
    pipeline.setQwenApiKey(settings.dashscopeApiKey);
  }
  pipeline.setQwenRegion(settings.dashscopeRegion ?? "cn");

  ipcMain.handle("settings:get", () => {
    const currentSettings = loadSettings();
    return serializeSettings(currentSettings);
  });

  ipcMain.handle("settings:save", (_event, nextSettings: SaveSettingsPayload) => {
    const currentSettings = loadSettings();
    const dashscopeApiKey = nextSettings.dashscopeApiKey?.trim();
    const dashscopeRegion: "cn" | "intl" =
      nextSettings.dashscopeRegion === "intl" || nextSettings.dashscopeRegion === "cn"
        ? nextSettings.dashscopeRegion
        : currentSettings.dashscopeRegion ?? "cn";
    const mergedSettings: AppSettings = {
      ...currentSettings,
      dashscopeRegion,
      subtitleTheme:
        nextSettings.subtitleTheme === undefined
          ? normalizeSubtitleTheme(currentSettings.subtitleTheme)
          : normalizeSubtitleTheme(nextSettings.subtitleTheme),
      subtitlePosition:
        nextSettings.subtitlePosition === undefined
          ? normalizeSubtitlePosition(currentSettings.subtitlePosition)
          : normalizeSubtitlePosition(nextSettings.subtitlePosition),
      subtitleDisplayMode:
        nextSettings.subtitleDisplayMode === undefined
          ? normalizeSubtitleDisplayMode(currentSettings.subtitleDisplayMode)
          : normalizeSubtitleDisplayMode(nextSettings.subtitleDisplayMode),
      subtitleFontSize:
        nextSettings.subtitleFontSize === undefined
          ? normalizeSubtitleFontSize(currentSettings.subtitleFontSize)
          : normalizeSubtitleFontSize(nextSettings.subtitleFontSize),
      subtitleBackgroundOpacity:
        nextSettings.subtitleBackgroundOpacity === undefined
          ? normalizeSubtitleBackgroundOpacity(currentSettings.subtitleBackgroundOpacity)
          : normalizeSubtitleBackgroundOpacity(nextSettings.subtitleBackgroundOpacity)
    };

    if (dashscopeApiKey) {
      mergedSettings.dashscopeApiKey = dashscopeApiKey;
    }

    saveSettings(mergedSettings);

    if (mergedSettings.dashscopeApiKey) {
      pipeline.setQwenApiKey(mergedSettings.dashscopeApiKey);
    }
    pipeline.setQwenRegion(mergedSettings.dashscopeRegion ?? "cn");

    const serializedSettings = serializeSettings(mergedSettings);
    broadcastSettings(serializedSettings);
    return serializedSettings;
  });

  ipcMain.on("toggle-translation", (event, enabled?: boolean) => {
    const nextEnabled = typeof enabled === "boolean" ? enabled : !translationEnabled;

    try {
      if (nextEnabled) {
        pipeline.start();
      } else {
        pipeline.stop();
      }

      translationEnabled = nextEnabled;
      event.sender.send("translation-state", translationEnabled);
    } catch (error) {
      translationEnabled = false;
      event.sender.send("translation-state", translationEnabled);
      event.sender.send("translation-error", error instanceof Error ? error.message : "Failed to toggle translation");
    }
  });

  pipeline.onSubtitleUpdate((state) => {
    sendSubtitleState(state);
  });

  pipeline.onStatusUpdate((message) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("pipeline-status", message);
    }
  });
}

export function sendSubtitleState(state: SubtitleState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("subtitle-update", state);
  }
}

type SaveSettingsPayload = {
  dashscopeApiKey?: string;
  dashscopeRegion?: "cn" | "intl";
  subtitleTheme?: SubtitleTheme;
  subtitlePosition?: SubtitlePosition;
  subtitleDisplayMode?: SubtitleDisplayMode;
  subtitleFontSize?: SubtitleFontSize;
  subtitleBackgroundOpacity?: number;
};

type SerializedSettings = {
  hasDashscopeApiKey: boolean;
  maskedDashscopeApiKey: string;
  dashscopeRegion: "cn" | "intl";
  subtitleTheme: SubtitleTheme;
  subtitlePosition: SubtitlePosition;
  subtitleDisplayMode: SubtitleDisplayMode;
  subtitleFontSize: SubtitleFontSize;
  subtitleBackgroundOpacity: number;
};

function serializeSettings(settings: AppSettings): SerializedSettings {
  return {
    hasDashscopeApiKey: Boolean(settings.dashscopeApiKey),
    maskedDashscopeApiKey: maskSecret(settings.dashscopeApiKey),
    dashscopeRegion: settings.dashscopeRegion ?? "cn",
    subtitleTheme: normalizeSubtitleTheme(settings.subtitleTheme),
    subtitlePosition: normalizeSubtitlePosition(settings.subtitlePosition),
    subtitleDisplayMode: normalizeSubtitleDisplayMode(settings.subtitleDisplayMode),
    subtitleFontSize: normalizeSubtitleFontSize(settings.subtitleFontSize),
    subtitleBackgroundOpacity: normalizeSubtitleBackgroundOpacity(settings.subtitleBackgroundOpacity)
  };
}

function broadcastSettings(settings: SerializedSettings): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("settings-updated", settings);
  }
}

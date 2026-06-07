import { BrowserWindow, ipcMain } from "electron";
import type { SubtitleState } from "@protocol";
import type { RealtimePipeline } from "./realtime-pipeline";
import { loadSettings, maskSecret, saveSettings } from "./settings-store";

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

    return {
      hasDashscopeApiKey: Boolean(currentSettings.dashscopeApiKey),
      maskedDashscopeApiKey: maskSecret(currentSettings.dashscopeApiKey),
      dashscopeRegion: currentSettings.dashscopeRegion ?? "cn"
    };
  });

  ipcMain.handle("settings:save", (_event, nextSettings: { dashscopeApiKey?: string; dashscopeRegion?: "cn" | "intl" }) => {
    const currentSettings = loadSettings();
    const dashscopeApiKey = nextSettings.dashscopeApiKey?.trim();
    const dashscopeRegion: "cn" | "intl" = nextSettings.dashscopeRegion === "intl" ? "intl" : "cn";
    const mergedSettings = dashscopeApiKey
      ? { ...currentSettings, dashscopeApiKey, dashscopeRegion }
      : { ...currentSettings, dashscopeRegion };

    saveSettings(mergedSettings);

    if (mergedSettings.dashscopeApiKey) {
      pipeline.setQwenApiKey(mergedSettings.dashscopeApiKey);
    }
    pipeline.setQwenRegion(mergedSettings.dashscopeRegion ?? "cn");

    return {
      hasDashscopeApiKey: Boolean(mergedSettings.dashscopeApiKey),
      maskedDashscopeApiKey: maskSecret(mergedSettings.dashscopeApiKey),
      dashscopeRegion: mergedSettings.dashscopeRegion ?? "cn"
    };
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

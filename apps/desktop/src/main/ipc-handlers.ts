import { BrowserWindow, ipcMain } from "electron";
import type { SubtitleState } from "@protocol";
import type { RealtimePipeline } from "./realtime-pipeline";

let translationEnabled = false;

export function registerIpcHandlers(pipeline: RealtimePipeline): void {
  ipcMain.removeAllListeners("toggle-translation");

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
}

export function sendSubtitleState(state: SubtitleState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("subtitle-update", state);
  }
}

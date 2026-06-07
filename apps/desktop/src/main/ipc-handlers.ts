import { BrowserWindow, ipcMain } from "electron";
import type { SubtitleState } from "@protocol";
import type { RealtimePipeline } from "./realtime-pipeline";
import type { QwenRealtimeOptions } from "./qwen-provider";
import {
  loadSettings,
  maskSecret,
  defaultQwenInputAudioFormat,
  defaultQwenOutputAudioFormat,
  defaultQwenRealtimeEnabled,
  defaultQwenSampleRate,
  defaultQwenSilenceDurationMs,
  defaultQwenSourceLanguage,
  defaultQwenTargetLanguage,
  defaultQwenVadThreshold,
  defaultVoiceOutputEnabled,
  defaultQwenVoiceCloneEnabled,
  normalizeBooleanSetting,
  normalizeQwenLanguageSetting,
  normalizeNumberSetting,
  normalizeOptionalStringSetting,
  normalizeQwenPhrases,
  normalizeQwenTurnDetectionType,
  normalizeQwenVoiceCloneFrequency,
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
  pipeline.setQwenRealtimeOptions(buildRealtimeOptions(settings));

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
      qwenRealtimeEnabled: defaultQwenRealtimeEnabled,
      voiceOutputEnabled:
        nextSettings.voiceOutputEnabled === undefined
          ? normalizeBooleanSetting(currentSettings.voiceOutputEnabled, defaultVoiceOutputEnabled)
          : normalizeBooleanSetting(nextSettings.voiceOutputEnabled, defaultVoiceOutputEnabled),
      qwenVoice:
        nextSettings.qwenVoice === undefined
          ? normalizeOptionalStringSetting(currentSettings.qwenVoice)
          : normalizeOptionalStringSetting(nextSettings.qwenVoice),
      qwenSourceLanguage:
        nextSettings.qwenSourceLanguage === undefined
          ? normalizeQwenLanguageSetting(currentSettings.qwenSourceLanguage, defaultQwenSourceLanguage)
          : normalizeQwenLanguageSetting(nextSettings.qwenSourceLanguage, defaultQwenSourceLanguage),
      qwenTargetLanguage:
        nextSettings.qwenTargetLanguage === undefined
          ? normalizeQwenLanguageSetting(currentSettings.qwenTargetLanguage, defaultQwenTargetLanguage)
          : normalizeQwenLanguageSetting(nextSettings.qwenTargetLanguage, defaultQwenTargetLanguage),
      qwenSampleRate: defaultQwenSampleRate,
      qwenInputAudioFormat: defaultQwenInputAudioFormat,
      qwenOutputAudioFormat: defaultQwenOutputAudioFormat,
      qwenVoiceCloneEnabled:
        nextSettings.qwenVoiceCloneEnabled === undefined
          ? normalizeBooleanSetting(currentSettings.qwenVoiceCloneEnabled, defaultQwenVoiceCloneEnabled)
          : normalizeBooleanSetting(nextSettings.qwenVoiceCloneEnabled, defaultQwenVoiceCloneEnabled),
      qwenVoiceCloneFrequency:
        nextSettings.qwenVoiceCloneFrequency === undefined
          ? normalizeQwenVoiceCloneFrequency(currentSettings.qwenVoiceCloneFrequency)
          : normalizeQwenVoiceCloneFrequency(nextSettings.qwenVoiceCloneFrequency),
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
    pipeline.setQwenRealtimeOptions(buildRealtimeOptions(mergedSettings));

    if (!mergedSettings.voiceOutputEnabled) {
      broadcastVoiceAudioReset();
    }

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

  pipeline.onVoiceAudio((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!isOverlayWindow(window)) {
        window.webContents.send("voice-audio-delta", event);
      }
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
  voiceOutputEnabled?: boolean;
  qwenVoice?: string;
  qwenSourceLanguage?: string;
  qwenTargetLanguage?: string;
  qwenVoiceCloneEnabled?: boolean;
  qwenVoiceCloneFrequency?: "never" | "once" | "always";
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
  qwenRealtimeEnabled: boolean;
  voiceOutputEnabled: boolean;
  qwenVoice: string;
  qwenEffectiveVoice: string;
  qwenSourceLanguage: string;
  qwenTargetLanguage: string;
  qwenSampleRate: number;
  qwenInputAudioFormat: "pcm" | "opus";
  qwenOutputAudioFormat: "pcm";
  qwenVoiceCloneEnabled: boolean;
  qwenVoiceCloneFrequency: "never" | "once" | "always";
  subtitleTheme: SubtitleTheme;
  subtitlePosition: SubtitlePosition;
  subtitleDisplayMode: SubtitleDisplayMode;
  subtitleFontSize: SubtitleFontSize;
  subtitleBackgroundOpacity: number;
};

function serializeSettings(settings: AppSettings): SerializedSettings {
  const realtimeOptions = buildRealtimeOptions(settings);

  return {
    hasDashscopeApiKey: Boolean(settings.dashscopeApiKey),
    maskedDashscopeApiKey: maskSecret(settings.dashscopeApiKey),
    dashscopeRegion: settings.dashscopeRegion ?? "cn",
    qwenRealtimeEnabled: realtimeOptions.enableQwenRealtime,
    voiceOutputEnabled: realtimeOptions.enableVoiceOutput,
    qwenVoice: settings.qwenVoice ?? "",
    qwenEffectiveVoice: settings.qwenVoice ?? process.env.QWEN_REALTIME_VOICE ?? "",
    qwenSourceLanguage: realtimeOptions.sourceLanguage,
    qwenTargetLanguage: realtimeOptions.targetLanguage,
    qwenSampleRate: realtimeOptions.sampleRate,
    qwenInputAudioFormat: realtimeOptions.inputAudioFormat,
    qwenOutputAudioFormat: realtimeOptions.outputAudioFormat,
    qwenVoiceCloneEnabled: realtimeOptions.enableVoiceClone ?? false,
    qwenVoiceCloneFrequency: realtimeOptions.voiceCloneFrequency ?? "never",
    subtitleTheme: normalizeSubtitleTheme(settings.subtitleTheme),
    subtitlePosition: normalizeSubtitlePosition(settings.subtitlePosition),
    subtitleDisplayMode: normalizeSubtitleDisplayMode(settings.subtitleDisplayMode),
    subtitleFontSize: normalizeSubtitleFontSize(settings.subtitleFontSize),
    subtitleBackgroundOpacity: normalizeSubtitleBackgroundOpacity(settings.subtitleBackgroundOpacity)
  };
}

function buildRealtimeOptions(settings: AppSettings): QwenRealtimeOptions {
  return {
    enableQwenRealtime: defaultQwenRealtimeEnabled,
    enableVoiceOutput: normalizeBooleanSetting(settings.voiceOutputEnabled, defaultVoiceOutputEnabled),
    voice: normalizeOptionalStringSetting(settings.qwenVoice),
    sourceLanguage: normalizeQwenLanguageSetting(settings.qwenSourceLanguage, defaultQwenSourceLanguage),
    targetLanguage: normalizeQwenLanguageSetting(settings.qwenTargetLanguage, defaultQwenTargetLanguage),
    sampleRate: defaultQwenSampleRate,
    inputAudioFormat: defaultQwenInputAudioFormat,
    outputAudioFormat: defaultQwenOutputAudioFormat,
    turnDetection: {
      type: normalizeQwenTurnDetectionType(settings.qwenTurnDetectionType),
      threshold: normalizeNumberSetting(settings.qwenVadThreshold, defaultQwenVadThreshold, 0, 1),
      silence_duration_ms: Math.round(
        normalizeNumberSetting(settings.qwenSilenceDurationMs, defaultQwenSilenceDurationMs, 0, 5000)
      )
    },
    phrases: normalizeQwenPhrases(settings.qwenPhrases),
    enableVoiceClone: normalizeBooleanSetting(settings.qwenVoiceCloneEnabled, defaultQwenVoiceCloneEnabled),
    voiceCloneFrequency: normalizeQwenVoiceCloneFrequency(settings.qwenVoiceCloneFrequency)
  };
}

function broadcastSettings(settings: SerializedSettings): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("settings-updated", settings);
  }
}

function broadcastVoiceAudioReset(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("voice-audio-reset");
  }
}

function isOverlayWindow(window: BrowserWindow): boolean {
  return window.webContents.getURL().includes("overlay=1");
}

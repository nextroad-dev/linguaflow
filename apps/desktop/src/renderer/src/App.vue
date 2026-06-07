<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { SubtitleState } from "@protocol";
import FluentIcon from "./FluentIcon.vue";
import bugIcon from "@fluentui/svg-icons/icons/bug_20_regular.svg?raw";
import chevronDownIcon from "@fluentui/svg-icons/icons/chevron_down_20_regular.svg?raw";
import chevronLeftIcon from "@fluentui/svg-icons/icons/chevron_left_20_regular.svg?raw";
import chevronRightIcon from "@fluentui/svg-icons/icons/chevron_right_20_regular.svg?raw";
import closedCaptionIcon from "@fluentui/svg-icons/icons/closed_caption_20_regular.svg?raw";
import homeIcon from "@fluentui/svg-icons/icons/home_20_regular.svg?raw";
import playIcon from "@fluentui/svg-icons/icons/play_20_regular.svg?raw";
import settingsIcon from "@fluentui/svg-icons/icons/settings_20_regular.svg?raw";
import stopIcon from "@fluentui/svg-icons/icons/stop_20_regular.svg?raw";

type AppView = "control" | "audio-output" | "subtitles" | "settings" | "diagnostics";
type SubtitleTheme = "classic-white" | "stroke-dark" | "light-bar" | "high-contrast";
type SubtitlePosition = "top" | "center" | "bottom" | "bottom-left" | "bottom-right";
type SubtitleDisplayMode = "bilingual" | "translated-only";
type SubtitleFontSize = "small" | "medium" | "large";
type LanguageSelectId = "home-source" | "home-target" | "audio-source" | "audio-target";
type TranslationPhase = "idle" | "starting" | "running" | "stopping" | "error";

type SettingsResponse = {
  hasDashscopeApiKey: boolean;
  maskedDashscopeApiKey: string;
  dashscopeRegion: "cn" | "intl";
  voiceOutputEnabled: boolean;
  qwenVoice: string;
  qwenEffectiveVoice: string;
  qwenSourceLanguage: string;
  qwenTargetLanguage: string;
  qwenVoiceCloneEnabled: boolean;
  qwenVoiceCloneFrequency: "never" | "once" | "always";
  subtitleTheme: SubtitleTheme;
  subtitlePosition: SubtitlePosition;
  subtitleDisplayMode: SubtitleDisplayMode;
  subtitleFontSize: SubtitleFontSize;
  subtitleBackgroundOpacity: number;
};

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    electron: {
      ipcRenderer: {
        send: (channel: string, ...args: unknown[]) => void;
        invoke: <T>(channel: string, ...args: unknown[]) => Promise<T>;
        on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
      };
    };
  }
}

const navigationItems: Array<{ id: AppView; label: string; description: string; icon: string }> = [
  { id: "control", label: "主页", description: "选择语言并开始", icon: homeIcon },
  { id: "audio-output", label: "音频输出", description: "语音与会话", icon: settingsIcon },
  { id: "subtitles", label: "字幕", description: "样式与位置", icon: closedCaptionIcon },
  { id: "settings", label: "连接", description: "密钥与区域", icon: settingsIcon },
  { id: "diagnostics", label: "诊断", description: "状态与事件", icon: bugIcon }
];

const subtitleThemes: Array<{ id: SubtitleTheme; label: string; description: string }> = [
  { id: "classic-white", label: "经典白字", description: "通用场景" },
  { id: "stroke-dark", label: "深色描边", description: "复杂画面" },
  { id: "light-bar", label: "浅色字幕条", description: "浅色背景" },
  { id: "high-contrast", label: "高对比", description: "远距离" }
];

const subtitlePositions: Array<{ id: SubtitlePosition; label: string }> = [
  { id: "top", label: "顶部" },
  { id: "center", label: "居中" },
  { id: "bottom", label: "底部" },
  { id: "bottom-left", label: "左下" },
  { id: "bottom-right", label: "右下" }
];

const subtitleDisplayModes: Array<{ id: SubtitleDisplayMode; label: string; description: string }> = [
  { id: "bilingual", label: "双语", description: "保留原文" },
  { id: "translated-only", label: "只显示中文", description: "更清爽" }
];

const subtitleFontSizes: Array<{ id: SubtitleFontSize; label: string; description: string }> = [
  { id: "small", label: "小", description: "紧凑" },
  { id: "medium", label: "中", description: "默认" },
  { id: "large", label: "大", description: "远看" }
];

const subtitleOpacityOptions: Array<{ value: number; label: string }> = [
  { value: 0.35, label: "35%" },
  { value: 0.5, label: "50%" },
  { value: 0.65, label: "65%" }
];

const voicePresets = ["", "Tina", "Ethan", "Cherry"];
const languageOptions = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Português" },
  { value: "ru", label: "Русский" },
  { value: "ar", label: "العربية" }
];
const targetLanguageOptions = languageOptions;
const isOverlay = new URLSearchParams(window.location.search).get("overlay") === "1";
const activeView = ref<AppView>("control");
const sidebarCollapsed = ref(false);
const isTranslating = ref(false);
const apiKey = ref("");
const maskedApiKey = ref("");
const hasApiKey = ref(false);
const dashscopeRegion = ref<"cn" | "intl">("cn");
const voiceOutputEnabled = ref(false);
const qwenVoice = ref("");
const qwenEffectiveVoice = ref("");
const qwenSourceLanguage = ref("en");
const qwenTargetLanguage = ref("zh");
const openLanguageSelect = ref<LanguageSelectId | null>(null);
const qwenVoiceCloneEnabled = ref(false);
const qwenVoiceCloneFrequency = ref<"never" | "once" | "always">("never");
const subtitleTheme = ref<SubtitleTheme>("classic-white");
const subtitlePosition = ref<SubtitlePosition>("bottom");
const subtitleDisplayMode = ref<SubtitleDisplayMode>("bilingual");
const subtitleFontSize = ref<SubtitleFontSize>("medium");
const subtitleBackgroundOpacity = ref(0.5);
const settingsMessage = ref("");
const subtitleSettingsMessage = ref("");
const translationError = ref("");
const translationPhase = ref<TranslationPhase>("idle");
const pipelineStatus = ref("待启动");
const qwenStatus = ref("未连接");
const sidecarStatus = ref("未启动");
const audioDevice = ref("等待音频");
const audioRms = ref(0);
const audioPeak = ref(0);
const statusLog = ref<string[]>([]);
const subtitleState = ref<SubtitleState>({
  isListening: false,
  history: []
});

const subtitleUpdateThrottleMs = 120;
const overlaySourceTextMaxChars = 72;
const overlayTranslatedTextMaxChars = 60;
const activeSubtitle = computed(() => subtitleState.value.visible ?? subtitleState.value.current);
const sourceText = computed(() => activeSubtitle.value?.sourceText ?? "");
const translatedText = computed(() => activeSubtitle.value?.translatedText ?? "");
const overlaySourceText = computed(() => clipOverlaySubtitleText(sourceText.value, overlaySourceTextMaxChars));
const overlayTranslatedText = computed(() =>
  clipOverlaySubtitleText(translatedText.value, overlayTranslatedTextMaxChars)
);
const audioLevelPercent = computed(() => Math.min(100, Math.round(audioRms.value * 500)));
const activeNavigationItem = computed(() => navigationItems.find((item) => item.id === activeView.value) ?? navigationItems[0]);
const selectedSubtitleTheme = computed(
  () => subtitleThemes.find((theme) => theme.id === subtitleTheme.value) ?? subtitleThemes[0]
);
const selectedSubtitlePosition = computed(
  () => subtitlePositions.find((position) => position.id === subtitlePosition.value) ?? subtitlePositions[2]
);
const selectedSubtitleDisplayMode = computed(
  () => subtitleDisplayModes.find((mode) => mode.id === subtitleDisplayMode.value) ?? subtitleDisplayModes[0]
);
const selectedSubtitleFontSize = computed(
  () => subtitleFontSizes.find((fontSize) => fontSize.id === subtitleFontSize.value) ?? subtitleFontSizes[1]
);
const selectedVoiceLabel = computed(() => qwenVoice.value || qwenEffectiveVoice.value || "模型默认");
const selectedSourceLanguage = computed(
  () => languageOptions.find((language) => language.value === qwenSourceLanguage.value) ?? languageOptions[1]
);
const selectedTargetLanguage = computed(
  () => targetLanguageOptions.find((language) => language.value === qwenTargetLanguage.value) ?? targetLanguageOptions[0]
);
const desktopShellClass = computed(() => ["desktop-shell", { "sidebar-collapsed": sidebarCollapsed.value }]);
const overlayShellClass = computed(() => [
  "overlay-shell",
  `theme-${subtitleTheme.value}`,
  `position-${subtitlePosition.value}`,
  `mode-${subtitleDisplayMode.value}`,
  `size-${subtitleFontSize.value}`
]);
const qwenStatusTone = computed(() => {
  if (qwenStatus.value.includes("失败") || qwenStatus.value.includes("断开")) {
    return "danger";
  }

  if (qwenStatus.value.includes("就绪")) {
    return "good";
  }

  return "idle";
});
const primaryActionLabel = computed(() => {
  if (translationPhase.value === "starting") {
    return "正在连接…";
  }

  if (translationPhase.value === "stopping") {
    return "正在停止…";
  }

  return isTranslating.value ? "翻译中" : "开始实时字幕";
});
const primaryActionIcon = computed(() => (isTranslating.value ? stopIcon : playIcon));
const primaryActionDisabled = computed(
  () => translationPhase.value === "starting" || translationPhase.value === "stopping"
);
const subtitlePreviewClass = computed(() => [
  "subtitle-preview-stage",
  `theme-${subtitleTheme.value}`,
  `position-${subtitlePosition.value}`,
  `mode-${subtitleDisplayMode.value}`,
  `size-${subtitleFontSize.value}`
]);
const subtitleSurfaceStyle = computed(() => ({
  "--subtitle-bg-alpha": subtitleBackgroundOpacity.value.toFixed(2)
}));
const showSourceLine = computed(() => subtitleDisplayMode.value === "bilingual");
const hasVisibleOverlaySubtitle = computed(() =>
  Boolean(overlayTranslatedText.value || (showSourceLine.value && overlaySourceText.value))
);
let cleanupSubtitleListener: (() => void) | undefined;
let cleanupTranslationStateListener: (() => void) | undefined;
let cleanupTranslationErrorListener: (() => void) | undefined;
let cleanupPipelineStatusListener: (() => void) | undefined;
let cleanupSettingsListener: (() => void) | undefined;
let cleanupVoiceAudioListener: (() => void) | undefined;
let cleanupVoiceAudioResetListener: (() => void) | undefined;
let cleanupDocumentPointerListener: (() => void) | undefined;
let lastSubtitleUpdateAt = 0;
let pendingSubtitleState: SubtitleState | undefined;
let subtitleUpdateTimer: ReturnType<typeof setTimeout> | undefined;
let voiceAudioContext: AudioContext | undefined;
let nextVoiceAudioStartTime = 0;
let activeVoiceSources: AudioBufferSourceNode[] = [];

function toggleTranslation(): void {
  if (primaryActionDisabled.value) {
    return;
  }

  translationError.value = "";
  const nextEnabled = !isTranslating.value;
  translationPhase.value = nextEnabled ? "starting" : "stopping";
  window.electron.ipcRenderer.send("toggle-translation", nextEnabled);
}

async function loadSettings(): Promise<void> {
  const settings = await window.electron.ipcRenderer.invoke<SettingsResponse>("settings:get");
  applySettings(settings);
}

async function saveApiKey(): Promise<void> {
  settingsMessage.value = "";
  translationError.value = "";

  if (!apiKey.value.trim()) {
    settingsMessage.value = "请输入服务密钥";
    return;
  }

  const settings = await window.electron.ipcRenderer.invoke<SettingsResponse>("settings:save", {
    dashscopeApiKey: apiKey.value,
    dashscopeRegion: dashscopeRegion.value
  });

  applySettings(settings);
  apiKey.value = "";
  settingsMessage.value = "已保存";
}

async function saveRegion(region: "cn" | "intl"): Promise<void> {
  dashscopeRegion.value = region;
  const settings = await window.electron.ipcRenderer.invoke<SettingsResponse>("settings:save", {
    dashscopeRegion: region
  });

  applySettings(settings);
  settingsMessage.value = "已保存";
}

async function saveAudioOutputSettings(nextSettings: {
  voiceOutputEnabled?: boolean;
  qwenVoice?: string;
  qwenSourceLanguage?: string;
  qwenTargetLanguage?: string;
  qwenVoiceCloneEnabled?: boolean;
  qwenVoiceCloneFrequency?: "never" | "once" | "always";
}): Promise<void> {
  if (typeof nextSettings.voiceOutputEnabled === "boolean") {
    voiceOutputEnabled.value = nextSettings.voiceOutputEnabled;

    if (!nextSettings.voiceOutputEnabled) {
      resetVoiceAudio();
    }
  }

  if (typeof nextSettings.qwenVoice === "string") {
    qwenVoice.value = nextSettings.qwenVoice;
  }

  if (typeof nextSettings.qwenSourceLanguage === "string") {
    qwenSourceLanguage.value = nextSettings.qwenSourceLanguage;
  }

  if (typeof nextSettings.qwenTargetLanguage === "string") {
    qwenTargetLanguage.value = nextSettings.qwenTargetLanguage;
  }

  if (typeof nextSettings.qwenVoiceCloneEnabled === "boolean") {
    qwenVoiceCloneEnabled.value = nextSettings.qwenVoiceCloneEnabled;
  }

  if (nextSettings.qwenVoiceCloneFrequency) {
    qwenVoiceCloneFrequency.value = nextSettings.qwenVoiceCloneFrequency;
  }

  const settings = await window.electron.ipcRenderer.invoke<SettingsResponse>("settings:save", {
    voiceOutputEnabled: voiceOutputEnabled.value,
    qwenVoice: qwenVoice.value,
    qwenSourceLanguage: qwenSourceLanguage.value,
    qwenTargetLanguage: qwenTargetLanguage.value,
    qwenVoiceCloneEnabled: qwenVoiceCloneEnabled.value,
    qwenVoiceCloneFrequency: qwenVoiceCloneFrequency.value
  });

  applySettings(settings);
  settingsMessage.value = "已保存";
}

function toggleVoiceOutput(): void {
  void saveAudioOutputSettings({ voiceOutputEnabled: !voiceOutputEnabled.value });
}

function toggleVoiceClone(): void {
  const nextEnabled = !qwenVoiceCloneEnabled.value;

  void saveAudioOutputSettings({
    qwenVoiceCloneEnabled: nextEnabled,
    qwenVoiceCloneFrequency: nextEnabled ? "once" : "never"
  });
}

function toggleLanguageSelect(selectId: LanguageSelectId): void {
  openLanguageSelect.value = openLanguageSelect.value === selectId ? null : selectId;
}

function selectSourceLanguage(value: string): void {
  qwenSourceLanguage.value = value;
  openLanguageSelect.value = null;
  saveAudioOutputForm();
}

function selectTargetLanguage(value: string): void {
  qwenTargetLanguage.value = value;
  openLanguageSelect.value = null;
  saveAudioOutputForm();
}

function handleVoicePreset(voice: string): void {
  void saveAudioOutputSettings({ qwenVoice: voice });
}

function saveAudioOutputForm(): void {
  void saveAudioOutputSettings({});
}

async function saveSubtitleAppearance(nextSettings: {
  subtitleTheme?: SubtitleTheme;
  subtitlePosition?: SubtitlePosition;
  subtitleDisplayMode?: SubtitleDisplayMode;
  subtitleFontSize?: SubtitleFontSize;
  subtitleBackgroundOpacity?: number;
}): Promise<void> {
  if (nextSettings.subtitleTheme) {
    subtitleTheme.value = nextSettings.subtitleTheme;
  }

  if (nextSettings.subtitlePosition) {
    subtitlePosition.value = nextSettings.subtitlePosition;
  }

  if (nextSettings.subtitleDisplayMode) {
    subtitleDisplayMode.value = nextSettings.subtitleDisplayMode;
  }

  if (nextSettings.subtitleFontSize) {
    subtitleFontSize.value = nextSettings.subtitleFontSize;
  }

  if (typeof nextSettings.subtitleBackgroundOpacity === "number") {
    subtitleBackgroundOpacity.value = nextSettings.subtitleBackgroundOpacity;
  }

  const settings = await window.electron.ipcRenderer.invoke<SettingsResponse>("settings:save", {
    subtitleTheme: subtitleTheme.value,
    subtitlePosition: subtitlePosition.value,
    subtitleDisplayMode: subtitleDisplayMode.value,
    subtitleFontSize: subtitleFontSize.value,
    subtitleBackgroundOpacity: subtitleBackgroundOpacity.value
  });

  applySettings(settings);
  subtitleSettingsMessage.value = "已保存";
}

function applySettings(settings: SettingsResponse): void {
  hasApiKey.value = settings.hasDashscopeApiKey;
  maskedApiKey.value = settings.maskedDashscopeApiKey;
  dashscopeRegion.value = settings.dashscopeRegion;

  if (voiceOutputEnabled.value && !settings.voiceOutputEnabled) {
    resetVoiceAudio();
  }

  voiceOutputEnabled.value = settings.voiceOutputEnabled;
  qwenVoice.value = settings.qwenVoice;
  qwenEffectiveVoice.value = settings.qwenEffectiveVoice;
  qwenSourceLanguage.value = settings.qwenSourceLanguage;
  qwenTargetLanguage.value = settings.qwenTargetLanguage;
  qwenVoiceCloneEnabled.value = settings.qwenVoiceCloneEnabled;
  qwenVoiceCloneFrequency.value = settings.qwenVoiceCloneFrequency;
  subtitleTheme.value = settings.subtitleTheme;
  subtitlePosition.value = settings.subtitlePosition;
  subtitleDisplayMode.value = settings.subtitleDisplayMode;
  subtitleFontSize.value = settings.subtitleFontSize;
  subtitleBackgroundOpacity.value = settings.subtitleBackgroundOpacity;
}

function playVoiceAudio(base64Pcm16: string): void {
  if (isOverlay || !voiceOutputEnabled.value) {
    return;
  }

  const audioContext = getVoiceAudioContext();

  if (!audioContext) {
    return;
  }

  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }

  const samples = decodePcm16Base64(base64Pcm16);

  if (samples.length === 0) {
    return;
  }

  const buffer = audioContext.createBuffer(1, samples.length, 24000);
  const channel = buffer.getChannelData(0);

  for (let index = 0; index < samples.length; index += 1) {
    channel[index] = Math.max(-1, Math.min(1, samples[index] / 32768));
  }

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.onended = () => {
    activeVoiceSources = activeVoiceSources.filter((item) => item !== source);
  };

  const startAt = Math.max(audioContext.currentTime + 0.03, nextVoiceAudioStartTime);
  source.start(startAt);
  nextVoiceAudioStartTime = startAt + buffer.duration;
  activeVoiceSources.push(source);
}

function getVoiceAudioContext(): AudioContext | undefined {
  if (voiceAudioContext) {
    return voiceAudioContext;
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextCtor) {
    translationError.value = "当前环境暂不支持语音播放。";
    return undefined;
  }

  voiceAudioContext = new AudioContextCtor();
  nextVoiceAudioStartTime = voiceAudioContext.currentTime;
  return voiceAudioContext;
}

function decodePcm16Base64(base64Data: string): Int16Array {
  const binary = window.atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}

function resetVoiceAudio(): void {
  for (const source of activeVoiceSources) {
    try {
      source.stop();
    } catch {
      // Already ended.
    }
  }

  activeVoiceSources = [];

  if (voiceAudioContext) {
    nextVoiceAudioStartTime = voiceAudioContext.currentTime;
  }
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!(event.target instanceof Element)) {
    return;
  }

  if (!event.target.closest(".language-select")) {
    openLanguageSelect.value = null;
  }
}

function handlePipelineStatus(message: string): void {
  pipelineStatus.value = formatPipelineStatus(message);
  statusLog.value = [formatStatusLogItem(message), ...statusLog.value].slice(0, 8);

  if (message.startsWith("[audio]")) {
    parseAudioStatus(message);
    return;
  }

  if (message.startsWith("[qwen]")) {
    qwenStatus.value = formatQwenStatus(message.replace("[qwen] ", ""));
    return;
  }

  if (message.startsWith("[sidecar]")) {
    sidecarStatus.value = formatSidecarStatus(message.replace("[sidecar] ", ""));
    return;
  }

  if (message.includes("starting realtime pipeline")) {
    translationPhase.value = "starting";
    qwenStatus.value = "连接中";
    sidecarStatus.value = "启动中";
  }

  if (message.includes("stopping realtime pipeline")) {
    translationPhase.value = "stopping";
  }
}

function parseAudioStatus(message: string): void {
  const rmsMatch = /rms=([0-9.]+)/.exec(message);
  const peakMatch = /peak=([0-9.]+)/.exec(message);
  const deviceName = message.split(" · ")[1];

  audioRms.value = rmsMatch ? Number(rmsMatch[1]) : 0;
  audioPeak.value = peakMatch ? Number(peakMatch[1]) : 0;
  audioDevice.value = deviceName ?? "系统音频";
}

function queueSubtitleState(nextState: SubtitleState): void {
  pendingSubtitleState = nextState;

  const elapsedMs = Date.now() - lastSubtitleUpdateAt;
  const waitMs = Math.max(0, subtitleUpdateThrottleMs - elapsedMs);

  if (waitMs === 0) {
    applyPendingSubtitleState();
    return;
  }

  if (!subtitleUpdateTimer) {
    subtitleUpdateTimer = setTimeout(applyPendingSubtitleState, waitMs);
  }
}

function applyPendingSubtitleState(): void {
  if (subtitleUpdateTimer) {
    clearTimeout(subtitleUpdateTimer);
    subtitleUpdateTimer = undefined;
  }

  if (!pendingSubtitleState) {
    return;
  }

  subtitleState.value = pendingSubtitleState;
  pendingSubtitleState = undefined;
  lastSubtitleUpdateAt = Date.now();
}

function clipOverlaySubtitleText(text: string, maxChars: number): string {
  const normalizedText = text.replace(/\s+/g, " ").trim();

  if (normalizedText.length <= maxChars) {
    return normalizedText;
  }

  return `…${normalizedText.slice(-(maxChars - 1))}`;
}

function formatPipelineStatus(message: string): string {
  if (message.includes("starting realtime pipeline")) {
    return "正在连接实时字幕服务";
  }

  if (message.includes("stopping realtime pipeline")) {
    return "正在停止实时字幕";
  }

  if (message.startsWith("[audio]")) {
    return "正在接收系统音频";
  }

  if (message.includes("[qwen] connected") || message.includes("[qwen] session.updated")) {
    return "实时翻译服务已就绪";
  }

  if (message.includes("[qwen] closed")) {
    return "实时翻译服务已断开";
  }

  if (message.includes("[qwen] error")) {
    return "实时翻译服务连接失败";
  }

  if (message.includes("[sidecar] error")) {
    return "音频捕获服务启动失败";
  }

  if (message.includes("[sidecar] closed")) {
    return "音频捕获服务已停止";
  }

  return message;
}

function formatStatusLogItem(message: string): string {
  if (message.startsWith("[audio]")) {
    return "检测到系统音频输入。";
  }

  return formatPipelineStatus(message);
}

function formatQwenStatus(status: string): string {
  if (status.includes("connected") || status.includes("session.updated")) {
    return "已就绪";
  }

  if (status.includes("error")) {
    return "连接失败";
  }

  if (status.includes("closed")) {
    return "已断开";
  }

  return status || "未连接";
}

function formatSidecarStatus(status: string): string {
  if (status.includes("error")) {
    return "启动失败";
  }

  if (status.includes("closed")) {
    return "已停止";
  }

  return status || "未启动";
}

function formatUserError(message: string): string {
  if (message.includes("DASHSCOPE_API_KEY") || message.toLowerCase().includes("api key")) {
    return "实时翻译服务连接失败，请检查服务密钥或网络。";
  }

  if (message.includes("sidecar") || message.includes("AudioSidecar") || message.includes(".NET")) {
    return "音频捕获服务启动失败，请确认 .NET 环境是否可用。";
  }

  if (message.includes("audio") || message.includes("device")) {
    return "未检测到系统音频，请确认正在播放声音。";
  }

  if (message.includes("WebSocket") || message.includes("Qwen")) {
    return "实时翻译服务连接失败，请检查服务密钥或网络。";
  }

  return message || "出现异常，请稍后重试。";
}

onMounted(() => {
  void loadSettings();

  cleanupSubtitleListener = window.electron.ipcRenderer.on("subtitle-update", (state) => {
    queueSubtitleState(state as SubtitleState);
  });

  cleanupTranslationStateListener = window.electron.ipcRenderer.on("translation-state", (enabled) => {
    isTranslating.value = Boolean(enabled);
    translationPhase.value = isTranslating.value ? "running" : "idle";

    if (!isTranslating.value) {
      resetVoiceAudio();
    }
  });

  cleanupTranslationErrorListener = window.electron.ipcRenderer.on("translation-error", (message) => {
    translationPhase.value = "error";
    translationError.value = formatUserError(String(message));
  });

  cleanupPipelineStatusListener = window.electron.ipcRenderer.on("pipeline-status", (message) => {
    handlePipelineStatus(String(message));
  });

  cleanupSettingsListener = window.electron.ipcRenderer.on("settings-updated", (settings) => {
    applySettings(settings as SettingsResponse);
  });

  cleanupVoiceAudioListener = window.electron.ipcRenderer.on("voice-audio-delta", (event) => {
    const audioEvent = event as { pcm16Base64?: unknown };

    if (typeof audioEvent.pcm16Base64 === "string") {
      playVoiceAudio(audioEvent.pcm16Base64);
    }
  });

  cleanupVoiceAudioResetListener = window.electron.ipcRenderer.on("voice-audio-reset", () => {
    resetVoiceAudio();
  });

  document.addEventListener("pointerdown", handleDocumentPointerDown);
  cleanupDocumentPointerListener = () => {
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
  };
});

onBeforeUnmount(() => {
  if (subtitleUpdateTimer) {
    clearTimeout(subtitleUpdateTimer);
  }

  cleanupSubtitleListener?.();
  cleanupTranslationStateListener?.();
  cleanupTranslationErrorListener?.();
  cleanupPipelineStatusListener?.();
  cleanupSettingsListener?.();
  cleanupVoiceAudioListener?.();
  cleanupVoiceAudioResetListener?.();
  cleanupDocumentPointerListener?.();
  resetVoiceAudio();
});
</script>

<template>
  <main v-if="!isOverlay" :class="desktopShellClass">
    <aside class="app-sidebar">
      <div class="brand-block">
        <div class="brand-copy">
          <p class="brand-name">LinguaFlow</p>
          <p class="brand-subtitle">实时字幕与同声传译</p>
        </div>
        <button
          class="sidebar-toggle"
          type="button"
          :aria-label="sidebarCollapsed ? '展开侧边菜单' : '折叠侧边菜单'"
          :aria-expanded="!sidebarCollapsed"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <FluentIcon :svg="sidebarCollapsed ? chevronRightIcon : chevronLeftIcon" />
        </button>
      </div>

      <nav class="side-nav" aria-label="主菜单">
        <button
          v-for="item in navigationItems"
          :key="item.id"
          class="nav-item"
          :class="{ selected: activeView === item.id }"
          type="button"
          :aria-current="activeView === item.id ? 'page' : undefined"
          :title="item.label"
          @click="activeView = item.id"
        >
          <span class="nav-icon">
            <FluentIcon :svg="item.icon" />
          </span>
          <span class="nav-label">{{ item.label }}</span>
          <span class="nav-description">{{ item.description }}</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <span class="status-dot" :class="{ active: isTranslating }"></span>
        <div>
          <span>{{ isTranslating ? "运行中" : "待机" }}</span>
          <small>{{ hasApiKey ? "已连接" : "未配置" }}</small>
        </div>
      </div>
    </aside>

    <section class="app-main">
      <header class="command-bar">
        <div>
          <p class="eyebrow">LinguaFlow</p>
          <h1>{{ activeNavigationItem.label }}</h1>
          <p class="page-subtitle">{{ activeNavigationItem.description }}</p>
        </div>
        <div class="command-actions">
          <button class="secondary-command" type="button" @click="activeView = 'subtitles'">
            <FluentIcon :svg="closedCaptionIcon" />
            <span>字幕设置</span>
          </button>
          <button
            class="primary-command"
            :class="{ active: isTranslating, pending: primaryActionDisabled }"
            type="button"
            :disabled="primaryActionDisabled"
            @click="toggleTranslation"
          >
            <FluentIcon :svg="primaryActionIcon" />
            <span>{{ primaryActionLabel }}</span>
          </button>
        </div>
      </header>

      <section class="content-surface">
        <section v-if="activeView === 'control'" class="control-layout">
          <div class="hero-panel">
            <div class="hero-copy">
              <p class="section-title">快速开始</p>
              <h2>{{ selectedSourceLanguage.label }} → {{ selectedTargetLanguage.label }}</h2>
              <p class="body-copy">选择源语言和目标语言，开始后会在桌面显示悬浮字幕。</p>
              <div class="language-route">
                <div class="field-block">
                  <span>源语言</span>
                  <div class="language-select">
                    <button
                      class="language-select-trigger"
                      type="button"
                      :aria-expanded="openLanguageSelect === 'home-source'"
                      @click="toggleLanguageSelect('home-source')"
                    >
                      <span>{{ selectedSourceLanguage.label }}</span>
                      <FluentIcon :svg="chevronDownIcon" />
                    </button>
                    <div v-if="openLanguageSelect === 'home-source'" class="language-select-menu" role="listbox">
                      <button
                        v-for="language in languageOptions"
                        :key="language.value"
                        class="language-select-option"
                        :class="{ selected: qwenSourceLanguage === language.value }"
                        type="button"
                        role="option"
                        :aria-selected="qwenSourceLanguage === language.value"
                        @click="selectSourceLanguage(language.value)"
                      >
                        {{ language.label }}
                      </button>
                    </div>
                  </div>
                </div>
                <span class="route-arrow" aria-hidden="true">→</span>
                <div class="field-block">
                  <span>目标语言</span>
                  <div class="language-select">
                    <button
                      class="language-select-trigger"
                      type="button"
                      :aria-expanded="openLanguageSelect === 'home-target'"
                      @click="toggleLanguageSelect('home-target')"
                    >
                      <span>{{ selectedTargetLanguage.label }}</span>
                      <FluentIcon :svg="chevronDownIcon" />
                    </button>
                    <div v-if="openLanguageSelect === 'home-target'" class="language-select-menu" role="listbox">
                      <button
                        v-for="language in targetLanguageOptions"
                        :key="language.value"
                        class="language-select-option"
                        :class="{ selected: qwenTargetLanguage === language.value }"
                        type="button"
                        role="option"
                        :aria-selected="qwenTargetLanguage === language.value"
                        @click="selectTargetLanguage(language.value)"
                      >
                        {{ language.label }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div class="hero-actions">
                <button
                  class="toggle-button"
                  :class="{ active: isTranslating, pending: primaryActionDisabled }"
                  type="button"
                  :disabled="primaryActionDisabled"
                  @click="toggleTranslation"
                >
                  <FluentIcon :svg="primaryActionIcon" />
                  <span>{{ primaryActionLabel }}</span>
                </button>
                <button class="text-command" type="button" @click="activeView = 'settings'">
                  <FluentIcon :svg="settingsIcon" />
                  <span>{{ hasApiKey ? "查看连接" : "配置密钥" }}</span>
                </button>
              </div>
              <p v-if="translationError" class="error-message">{{ translationError }}</p>
              <p v-else class="settings-hint">
                {{ hasApiKey ? "连接已就绪，可以开始实时字幕。" : "首次使用前，请先保存 DashScope 服务密钥。" }}
              </p>
            </div>

            <div class="hero-preview" aria-label="字幕预览">
              <div :class="subtitlePreviewClass" :style="subtitleSurfaceStyle">
                <section class="subtitle-card preview-card">
                  <p v-if="showSourceLine" class="source-line">{{ sourceText || "会议现在开始，请确认音频正常" }}</p>
                  <p class="translated-line">{{ translatedText || "中文翻译会显示在这里" }}</p>
                </section>
              </div>
            </div>
          </div>

          <div class="quick-start-strip">
            <button class="quick-step" type="button" @click="activeView = 'settings'">
              <span class="step-index">1</span>
              <span>
                <strong>{{ hasApiKey ? "连接已就绪" : "保存服务密钥" }}</strong>
                <small>{{ hasApiKey ? maskedApiKey : "DashScope 服务密钥" }}</small>
              </span>
            </button>
            <button class="quick-step" type="button" @click="activeView = 'subtitles'">
              <span class="step-index">2</span>
              <span>
                <strong>字幕样式</strong>
                <small>{{ selectedSubtitleTheme.label }} · {{ selectedSubtitlePosition.label }}</small>
              </span>
            </button>
            <button class="quick-step" type="button" @click="activeView = 'audio-output'">
              <span class="step-index">3</span>
              <span>
                <strong>输出方式</strong>
                <small>{{ voiceOutputEnabled ? "字幕 + 语音" : "字幕" }}</small>
              </span>
            </button>
          </div>
        </section>

        <section v-else-if="activeView === 'audio-output'" class="audio-output-layout">
          <div class="panel audio-output-panel">
            <div class="section-heading compact">
              <div>
                <p class="section-title">音频输出</p>
                <h2>{{ voiceOutputEnabled ? "已启用" : "已关闭" }}</h2>
              </div>
            </div>
            <div class="voice-output-actions">
              <button
                class="voice-output-command"
                :class="{ active: voiceOutputEnabled }"
                type="button"
                :aria-pressed="voiceOutputEnabled"
                @click="toggleVoiceOutput"
              >
                {{ voiceOutputEnabled ? "关闭音频输出" : "启用音频输出" }}
              </button>
              <p>开启后播放模型生成的中文语音，字幕会继续显示。</p>
            </div>
          </div>

          <div class="panel audio-output-panel">
            <div class="section-heading">
              <div>
                <p class="section-title">音色</p>
                <h2>{{ selectedVoiceLabel }}</h2>
              </div>
            </div>
            <div class="form-grid">
              <label class="field-block wide">
                <span>音色</span>
                <input
                  v-model="qwenVoice"
                  type="text"
                  placeholder="模型默认"
                  @blur="saveAudioOutputForm"
                  @keydown.enter="saveAudioOutputForm"
                />
              </label>
              <div class="control-group">
                <p class="control-label">常用音色</p>
                <div class="segmented-control compact voice-preset-control" aria-label="常用音色">
                  <button
                    v-for="voice in voicePresets"
                    :key="voice || 'default'"
                    type="button"
                    :class="{ selected: qwenVoice === voice }"
                    @click="handleVoicePreset(voice)"
                  >
                    <strong>{{ voice || "默认" }}</strong>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="panel audio-output-panel">
            <div class="section-heading">
              <div>
                <p class="section-title">语言</p>
                <h2>{{ selectedSourceLanguage.label }} → {{ selectedTargetLanguage.label }}</h2>
              </div>
            </div>
            <div class="form-grid">
              <div class="field-block">
                <span>输入语言</span>
                <div class="language-select">
                  <button
                    class="language-select-trigger"
                    type="button"
                    :aria-expanded="openLanguageSelect === 'audio-source'"
                    @click="toggleLanguageSelect('audio-source')"
                  >
                    <span>{{ selectedSourceLanguage.label }}</span>
                    <FluentIcon :svg="chevronDownIcon" />
                  </button>
                  <div v-if="openLanguageSelect === 'audio-source'" class="language-select-menu" role="listbox">
                    <button
                      v-for="language in languageOptions"
                      :key="language.value"
                      class="language-select-option"
                      :class="{ selected: qwenSourceLanguage === language.value }"
                      type="button"
                      role="option"
                      :aria-selected="qwenSourceLanguage === language.value"
                      @click="selectSourceLanguage(language.value)"
                    >
                      {{ language.label }}
                    </button>
                  </div>
                </div>
              </div>
              <div class="field-block">
                <span>目标语言</span>
                <div class="language-select">
                  <button
                    class="language-select-trigger"
                    type="button"
                    :aria-expanded="openLanguageSelect === 'audio-target'"
                    @click="toggleLanguageSelect('audio-target')"
                  >
                    <span>{{ selectedTargetLanguage.label }}</span>
                    <FluentIcon :svg="chevronDownIcon" />
                  </button>
                  <div v-if="openLanguageSelect === 'audio-target'" class="language-select-menu" role="listbox">
                    <button
                      v-for="language in targetLanguageOptions"
                      :key="language.value"
                      class="language-select-option"
                      :class="{ selected: qwenTargetLanguage === language.value }"
                      type="button"
                      role="option"
                      :aria-selected="qwenTargetLanguage === language.value"
                      @click="selectTargetLanguage(language.value)"
                    >
                      {{ language.label }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="panel audio-output-panel">
            <div class="section-heading">
              <div>
                <p class="section-title">声音复刻</p>
                <h2>{{ qwenVoiceCloneEnabled ? "已启用" : "不复刻" }}</h2>
              </div>
            </div>
            <div class="audio-feature-actions">
              <button
                class="audio-feature-command"
                :class="{ active: qwenVoiceCloneEnabled }"
                type="button"
                :aria-pressed="qwenVoiceCloneEnabled"
                @click="toggleVoiceClone"
              >
                {{ qwenVoiceCloneEnabled ? "关闭声音复刻" : "启用声音复刻" }}
              </button>
              <p>使用当前音色设置生成更接近原声的语音。</p>
            </div>
          </div>
        </section>

        <section v-else-if="activeView === 'subtitles'" class="subtitles-layout">
          <section class="panel preview-panel">
            <div class="section-heading">
              <div>
                <p class="section-title">预览</p>
                <h2>{{ selectedSubtitleTheme.label }} · {{ selectedSubtitlePosition.label }}</h2>
              </div>
            </div>
            <div :class="subtitlePreviewClass" :style="subtitleSurfaceStyle">
              <section class="subtitle-card preview-card">
                <p v-if="showSourceLine" class="source-line">{{ sourceText || "The meeting is starting now" }}</p>
                <p class="translated-line">{{ translatedText || "会议现在开始" }}</p>
              </section>
            </div>
          </section>

          <div class="panel">
            <div class="section-heading">
              <div>
                <p class="section-title">显示</p>
                <h2>{{ selectedSubtitleDisplayMode.label }} · {{ selectedSubtitleFontSize.label }}号字</h2>
              </div>
            </div>

            <div class="control-row">
              <div class="control-group">
                <p class="control-label">内容</p>
                <div class="segmented-control" aria-label="字幕显示内容">
                  <button
                    v-for="mode in subtitleDisplayModes"
                    :key="mode.id"
                    type="button"
                    :class="{ selected: subtitleDisplayMode === mode.id }"
                    @click="saveSubtitleAppearance({ subtitleDisplayMode: mode.id })"
                  >
                    <strong>{{ mode.label }}</strong>
                    <span>{{ mode.description }}</span>
                  </button>
                </div>
              </div>

              <div class="control-group">
                <p class="control-label">字号</p>
                <div class="segmented-control compact" aria-label="字幕字号">
                  <button
                    v-for="fontSize in subtitleFontSizes"
                    :key="fontSize.id"
                    type="button"
                    :class="{ selected: subtitleFontSize === fontSize.id }"
                    @click="saveSubtitleAppearance({ subtitleFontSize: fontSize.id })"
                  >
                    <strong>{{ fontSize.label }}</strong>
                    <span>{{ fontSize.description }}</span>
                  </button>
                </div>
              </div>

              <div class="control-group">
                <p class="control-label">背景</p>
                <div class="segmented-control compact" aria-label="字幕背景透明度">
                  <button
                    v-for="option in subtitleOpacityOptions"
                    :key="option.value"
                    type="button"
                    :class="{ selected: subtitleBackgroundOpacity === option.value }"
                    @click="saveSubtitleAppearance({ subtitleBackgroundOpacity: option.value })"
                  >
                    <strong>{{ option.label }}</strong>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="section-heading">
              <div>
                <p class="section-title">主题</p>
                <h2>显示风格</h2>
              </div>
            </div>
            <div class="option-grid">
              <button
                v-for="theme in subtitleThemes"
                :key="theme.id"
                class="option-card"
                :class="[{ selected: subtitleTheme === theme.id }, `swatch-${theme.id}`]"
                type="button"
                @click="saveSubtitleAppearance({ subtitleTheme: theme.id })"
              >
                <span class="subtitle-swatch">Aa 字幕</span>
                <strong>{{ theme.label }}</strong>
                <span>{{ theme.description }}</span>
              </button>
            </div>
          </div>

          <div class="panel">
            <div class="section-heading">
              <div>
                <p class="section-title">位置</p>
                <h2>字幕位置</h2>
              </div>
            </div>
            <div class="position-grid">
              <button
                v-for="position in subtitlePositions"
                :key="position.id"
                class="position-option"
                :class="{ selected: subtitlePosition === position.id }"
                type="button"
                @click="saveSubtitleAppearance({ subtitlePosition: position.id })"
              >
                {{ position.label }}
              </button>
            </div>
            <p class="settings-hint">
              {{ subtitleSettingsMessage || "会自动保存。" }}
            </p>
          </div>
        </section>

        <section v-else-if="activeView === 'settings'" class="settings-layout">
          <div class="panel settings-panel">
            <div class="section-heading compact">
              <div>
                <p class="section-title">服务密钥</p>
                <h2>连接实时翻译服务</h2>
              </div>
            </div>
            <div class="api-key-box">
              <input
                id="api-key"
                v-model="apiKey"
                type="password"
                placeholder="sk-..."
                autocomplete="off"
                @keydown.enter="saveApiKey"
              />
              <button class="save-button" type="button" @click="saveApiKey">保存</button>
            </div>
            <p class="settings-hint">{{ hasApiKey ? maskedApiKey : "尚未保存服务密钥" }}</p>
          </div>

          <div class="panel settings-panel">
            <div class="section-heading compact">
              <div>
                <p class="section-title">区域</p>
                <h2>服务区域</h2>
              </div>
            </div>
            <div class="region-toggle" aria-label="DashScope 服务区域">
              <button
                type="button"
                :class="{ selected: dashscopeRegion === 'cn' }"
                @click="saveRegion('cn')"
              >
                中国站
              </button>
              <button
                type="button"
                :class="{ selected: dashscopeRegion === 'intl' }"
                @click="saveRegion('intl')"
              >
                国际站
              </button>
            </div>
            <p class="settings-hint">
              {{ dashscopeRegion === "cn" ? "dashscope.aliyuncs.com" : "dashscope-intl.aliyuncs.com" }}
              <span v-if="settingsMessage"> · {{ settingsMessage }}</span>
            </p>
          </div>

        </section>

        <section v-else class="diagnostics-layout">
          <div class="metrics-grid">
            <div class="metric-card">
              <p class="metric-label">系统音频</p>
              <strong>{{ audioDevice }}</strong>
              <div class="level-meter" aria-label="音频电平">
                <span :style="{ width: `${audioLevelPercent}%` }"></span>
              </div>
              <p class="metric-note">输入电平 {{ audioLevelPercent }}%</p>
            </div>

            <div class="metric-card">
              <p class="metric-label">实时翻译</p>
              <strong :class="['state-text', qwenStatusTone]">{{ qwenStatus }}</strong>
              <p class="metric-note">就绪后开始处理系统音频</p>
            </div>

            <div class="metric-card">
              <p class="metric-label">音频捕获</p>
              <strong>{{ sidecarStatus }}</strong>
              <p class="metric-note">捕获 Windows 系统声音</p>
            </div>
          </div>

          <div class="panel event-panel">
            <p class="section-title">运行记录</p>
            <ol>
              <li v-for="item in statusLog" :key="item">{{ item }}</li>
            </ol>
          </div>
        </section>
      </section>
    </section>
  </main>

  <main v-else :class="overlayShellClass" :style="subtitleSurfaceStyle">
    <Transition name="subtitle-fade" mode="out-in">
      <section
        v-if="hasVisibleOverlaySubtitle"
        :key="activeSubtitle?.id"
        class="subtitle-card"
      >
        <p v-if="showSourceLine && overlaySourceText" class="source-line">{{ overlaySourceText }}</p>
        <p v-if="overlayTranslatedText" class="translated-line">{{ overlayTranslatedText }}</p>
      </section>
    </Transition>
  </main>
</template>

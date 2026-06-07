<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { SubtitleState } from "@protocol";
import FluentIcon from "./FluentIcon.vue";
import bugIcon from "@fluentui/svg-icons/icons/bug_20_regular.svg?raw";
import chevronLeftIcon from "@fluentui/svg-icons/icons/chevron_left_20_regular.svg?raw";
import chevronRightIcon from "@fluentui/svg-icons/icons/chevron_right_20_regular.svg?raw";
import closedCaptionIcon from "@fluentui/svg-icons/icons/closed_caption_20_regular.svg?raw";
import homeIcon from "@fluentui/svg-icons/icons/home_20_regular.svg?raw";
import playIcon from "@fluentui/svg-icons/icons/play_20_regular.svg?raw";
import settingsIcon from "@fluentui/svg-icons/icons/settings_20_regular.svg?raw";
import stopIcon from "@fluentui/svg-icons/icons/stop_20_regular.svg?raw";

type AppView = "control" | "subtitles" | "settings" | "diagnostics";
type SubtitleTheme = "classic-white" | "stroke-dark" | "light-bar" | "high-contrast";
type SubtitlePosition = "top" | "center" | "bottom" | "bottom-left" | "bottom-right";
type SubtitleDisplayMode = "bilingual" | "translated-only";
type SubtitleFontSize = "small" | "medium" | "large";

type SettingsResponse = {
  hasDashscopeApiKey: boolean;
  maskedDashscopeApiKey: string;
  dashscopeRegion: "cn" | "intl";
  subtitleTheme: SubtitleTheme;
  subtitlePosition: SubtitlePosition;
  subtitleDisplayMode: SubtitleDisplayMode;
  subtitleFontSize: SubtitleFontSize;
  subtitleBackgroundOpacity: number;
};

declare global {
  interface Window {
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
  { id: "control", label: "控制", description: "开始与音频", icon: homeIcon },
  { id: "subtitles", label: "字幕", description: "样式与位置", icon: closedCaptionIcon },
  { id: "settings", label: "设置", description: "密钥与区域", icon: settingsIcon },
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

const isOverlay = new URLSearchParams(window.location.search).get("overlay") === "1";
const activeView = ref<AppView>("control");
const sidebarCollapsed = ref(false);
const isTranslating = ref(false);
const apiKey = ref("");
const maskedApiKey = ref("");
const hasApiKey = ref(false);
const dashscopeRegion = ref<"cn" | "intl">("cn");
const subtitleTheme = ref<SubtitleTheme>("classic-white");
const subtitlePosition = ref<SubtitlePosition>("bottom");
const subtitleDisplayMode = ref<SubtitleDisplayMode>("bilingual");
const subtitleFontSize = ref<SubtitleFontSize>("medium");
const subtitleBackgroundOpacity = ref(0.5);
const settingsMessage = ref("");
const subtitleSettingsMessage = ref("");
const translationError = ref("");
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
const subtitleClearDebounceMs = 700;
const activeSubtitle = computed(() => subtitleState.value.visible ?? subtitleState.value.current);
const sourceText = computed(() => activeSubtitle.value?.sourceText ?? "");
const translatedText = computed(() => activeSubtitle.value?.translatedText ?? "");
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
const desktopShellClass = computed(() => ["desktop-shell", { "sidebar-collapsed": sidebarCollapsed.value }]);
const overlayShellClass = computed(() => [
  "overlay-shell",
  `theme-${subtitleTheme.value}`,
  `position-${subtitlePosition.value}`,
  `mode-${subtitleDisplayMode.value}`,
  `size-${subtitleFontSize.value}`
]);
const qwenStatusTone = computed(() => {
  if (qwenStatus.value.includes("error") || qwenStatus.value.includes("closed")) {
    return "danger";
  }

  if (qwenStatus.value.includes("session.updated") || qwenStatus.value.includes("connected")) {
    return "good";
  }

  return "idle";
});
const primaryActionLabel = computed(() => (isTranslating.value ? "停止翻译" : "开始翻译"));
const primaryActionIcon = computed(() => (isTranslating.value ? stopIcon : playIcon));
const runtimeTone = computed(() => (isTranslating.value ? "good" : "idle"));
const apiKeyTone = computed(() => (hasApiKey.value ? "good" : "idle"));
const runtimeSummary = computed(() => [
  {
    label: "翻译",
    value: isTranslating.value ? "运行中" : "待机",
    tone: runtimeTone.value
  },
  {
    label: "密钥",
    value: hasApiKey.value ? "已配置" : "待配置",
    tone: apiKeyTone.value
  },
  {
    label: "会话",
    value: qwenStatus.value,
    tone: qwenStatusTone.value
  }
]);
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
const hasVisibleOverlaySubtitle = computed(() => Boolean(translatedText.value || (showSourceLine.value && sourceText.value)));
let cleanupSubtitleListener: (() => void) | undefined;
let cleanupTranslationStateListener: (() => void) | undefined;
let cleanupTranslationErrorListener: (() => void) | undefined;
let cleanupPipelineStatusListener: (() => void) | undefined;
let cleanupSettingsListener: (() => void) | undefined;
let lastSubtitleUpdateAt = 0;
let pendingSubtitleState: SubtitleState | undefined;
let subtitleUpdateTimer: ReturnType<typeof setTimeout> | undefined;
let subtitleClearTimer: ReturnType<typeof setTimeout> | undefined;

function toggleTranslation(): void {
  translationError.value = "";
  window.electron.ipcRenderer.send("toggle-translation", !isTranslating.value);
}

async function loadSettings(): Promise<void> {
  const settings = await window.electron.ipcRenderer.invoke<SettingsResponse>("settings:get");
  applySettings(settings);
}

async function saveApiKey(): Promise<void> {
  settingsMessage.value = "";
  translationError.value = "";

  if (!apiKey.value.trim()) {
    settingsMessage.value = "请输入 API Key";
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
  subtitleTheme.value = settings.subtitleTheme;
  subtitlePosition.value = settings.subtitlePosition;
  subtitleDisplayMode.value = settings.subtitleDisplayMode;
  subtitleFontSize.value = settings.subtitleFontSize;
  subtitleBackgroundOpacity.value = settings.subtitleBackgroundOpacity;
}

function handlePipelineStatus(message: string): void {
  pipelineStatus.value = message;
  statusLog.value = [message, ...statusLog.value].slice(0, 8);

  if (message.startsWith("[audio]")) {
    parseAudioStatus(message);
    return;
  }

  if (message.startsWith("[qwen]")) {
    qwenStatus.value = message.replace("[qwen] ", "");
    return;
  }

  if (message.startsWith("[sidecar]")) {
    sidecarStatus.value = message.replace("[sidecar] ", "");
    return;
  }

  if (message.includes("starting realtime pipeline")) {
    qwenStatus.value = "连接中";
    sidecarStatus.value = "启动中";
  }
}

function parseAudioStatus(message: string): void {
  const rmsMatch = /rms=([0-9.]+)/.exec(message);
  const peakMatch = /peak=([0-9.]+)/.exec(message);
  const deviceName = message.split(" · ")[1];

  audioRms.value = rmsMatch ? Number(rmsMatch[1]) : 0;
  audioPeak.value = peakMatch ? Number(peakMatch[1]) : 0;
  audioDevice.value = deviceName ?? "默认输出";
}

function queueSubtitleState(nextState: SubtitleState): void {
  const stableState = stabilizeSubtitleState(nextState);

  if (!hasVisibleSubtitle(stableState)) {
    debounceSubtitleClear(stableState);
    return;
  }

  if (subtitleClearTimer) {
    clearTimeout(subtitleClearTimer);
    subtitleClearTimer = undefined;
  }

  pendingSubtitleState = stableState;

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

function debounceSubtitleClear(nextState: SubtitleState): void {
  pendingSubtitleState = undefined;

  if (subtitleUpdateTimer) {
    clearTimeout(subtitleUpdateTimer);
    subtitleUpdateTimer = undefined;
  }

  if (subtitleClearTimer) {
    clearTimeout(subtitleClearTimer);
  }

  subtitleClearTimer = setTimeout(() => {
    subtitleState.value = nextState;
    subtitleClearTimer = undefined;
    lastSubtitleUpdateAt = Date.now();
  }, subtitleClearDebounceMs);
}

function hasVisibleSubtitle(state: SubtitleState): boolean {
  const subtitle = state.visible ?? state.current;
  return Boolean(subtitle?.sourceText || subtitle?.translatedText);
}

function stabilizeSubtitleState(nextState: SubtitleState): SubtitleState {
  const currentSubtitle = subtitleState.value.visible ?? subtitleState.value.current;
  const nextSubtitle = nextState.visible ?? nextState.current;

  if (!currentSubtitle || !nextSubtitle || currentSubtitle.id !== nextSubtitle.id) {
    return nextState;
  }

  if (nextSubtitle.sourceText && nextSubtitle.translatedText) {
    return nextState;
  }

  const stableSubtitle = {
    ...nextSubtitle,
    sourceText: nextSubtitle.sourceText || currentSubtitle.sourceText,
    translatedText: nextSubtitle.translatedText || currentSubtitle.translatedText
  };

  if (nextState.visible?.id === stableSubtitle.id) {
    return { ...nextState, visible: stableSubtitle };
  }

  if (nextState.current?.id === stableSubtitle.id) {
    return { ...nextState, current: stableSubtitle };
  }

  return nextState;
}

onMounted(() => {
  void loadSettings();

  cleanupSubtitleListener = window.electron.ipcRenderer.on("subtitle-update", (state) => {
    queueSubtitleState(state as SubtitleState);
  });

  cleanupTranslationStateListener = window.electron.ipcRenderer.on("translation-state", (enabled) => {
    isTranslating.value = Boolean(enabled);
  });

  cleanupTranslationErrorListener = window.electron.ipcRenderer.on("translation-error", (message) => {
    translationError.value = String(message);
  });

  cleanupPipelineStatusListener = window.electron.ipcRenderer.on("pipeline-status", (message) => {
    handlePipelineStatus(String(message));
  });

  cleanupSettingsListener = window.electron.ipcRenderer.on("settings-updated", (settings) => {
    applySettings(settings as SettingsResponse);
  });
});

onBeforeUnmount(() => {
  if (subtitleUpdateTimer) {
    clearTimeout(subtitleUpdateTimer);
  }

  if (subtitleClearTimer) {
    clearTimeout(subtitleClearTimer);
  }

  cleanupSubtitleListener?.();
  cleanupTranslationStateListener?.();
  cleanupTranslationErrorListener?.();
  cleanupPipelineStatusListener?.();
  cleanupSettingsListener?.();
});
</script>

<template>
  <main v-if="!isOverlay" :class="desktopShellClass">
    <aside class="app-sidebar">
      <div class="brand-block">
        <div class="brand-copy">
          <p class="brand-name">LinguaFlow</p>
          <p class="brand-subtitle">Live Interpreter</p>
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
          <button class="primary-command" :class="{ active: isTranslating }" type="button" @click="toggleTranslation">
            <FluentIcon :svg="primaryActionIcon" />
            <span>{{ primaryActionLabel }}</span>
          </button>
        </div>
      </header>

      <section class="content-surface">
        <section v-if="activeView === 'control'" class="control-layout">
          <div class="hero-panel">
            <div class="hero-copy">
              <p class="section-title">控制</p>
              <h2>{{ isTranslating ? "正在翻译" : "准备就绪" }}</h2>
              <p class="body-copy">开启后，字幕会显示在 overlay 窗口。</p>
              <div class="hero-actions">
                <button class="toggle-button" :class="{ active: isTranslating }" type="button" @click="toggleTranslation">
                  <FluentIcon :svg="primaryActionIcon" />
                  <span>{{ primaryActionLabel }}</span>
                </button>
                <button class="text-command" type="button" @click="activeView = 'settings'">
                  <FluentIcon :svg="settingsIcon" />
                  <span>连接设置</span>
                </button>
              </div>
              <p v-if="translationError" class="error-message">{{ translationError }}</p>
            </div>

            <div class="hero-preview" aria-label="字幕预览">
              <div :class="subtitlePreviewClass" :style="subtitleSurfaceStyle">
                <section class="subtitle-card preview-card">
                  <p v-if="showSourceLine" class="source-line">{{ sourceText || "Realtime speech appears here" }}</p>
                  <p class="translated-line">{{ translatedText || "中文翻译会显示在这里" }}</p>
                </section>
              </div>
            </div>
          </div>

          <div class="summary-grid">
            <article v-for="item in runtimeSummary" :key="item.label" class="metric-card">
              <p class="metric-label">{{ item.label }}</p>
              <strong :class="['state-text', item.tone]">{{ item.value }}</strong>
            </article>
          </div>

          <div class="detail-grid">
            <section class="panel audio-panel">
              <div class="section-heading compact">
                <div>
                  <p class="section-title">音频</p>
                  <h2>{{ audioDevice }}</h2>
                </div>
                <span class="value-badge">{{ audioLevelPercent }}%</span>
              </div>
              <div class="level-meter" aria-label="audio level">
                <span :style="{ width: `${audioLevelPercent}%` }"></span>
              </div>
              <p class="metric-note">RMS {{ audioRms.toFixed(4) }} · Peak {{ audioPeak.toFixed(4) }}</p>
            </section>

            <section class="panel event-panel compact-events">
              <p class="section-title">事件</p>
              <ol>
                <li v-for="item in statusLog.slice(0, 4)" :key="item">{{ item }}</li>
                <li v-if="statusLog.length === 0">暂无事件</li>
              </ol>
            </section>
          </div>

          <p class="pipeline-status">{{ pipelineStatus }}</p>
        </section>

        <section v-else-if="activeView === 'subtitles'" class="subtitles-layout">
          <section class="panel preview-panel">
            <div class="section-heading">
              <div>
                <p class="section-title">预览</p>
                <h2>{{ selectedSubtitleTheme.label }} · {{ selectedSubtitlePosition.label }}</h2>
              </div>
              <p class="selection-summary">Overlay</p>
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
              <p class="selection-summary">背景 {{ Math.round(subtitleBackgroundOpacity * 100) }}%</p>
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
              <p class="selection-summary">{{ selectedSubtitleTheme.label }}</p>
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
                <span class="check-mark" aria-hidden="true"></span>
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
              <p class="selection-summary">{{ selectedSubtitlePosition.label }}</p>
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
                <p class="section-title">API Key</p>
                <h2>连接服务</h2>
              </div>
              <span class="value-badge" :class="{ good: hasApiKey }">{{ hasApiKey ? "已保存" : "未配置" }}</span>
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
            <p class="settings-hint">{{ hasApiKey ? maskedApiKey : "未保存" }}</p>
          </div>

          <div class="panel settings-panel">
            <div class="section-heading compact">
              <div>
                <p class="section-title">区域</p>
                <h2>服务区域</h2>
              </div>
            </div>
            <div class="region-toggle" aria-label="DashScope service region">
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
              <p class="metric-label">音频</p>
              <strong>{{ audioDevice }}</strong>
              <div class="level-meter" aria-label="audio level">
                <span :style="{ width: `${audioLevelPercent}%` }"></span>
              </div>
              <p class="metric-note">RMS {{ audioRms.toFixed(4) }} · Peak {{ audioPeak.toFixed(4) }}</p>
            </div>

            <div class="metric-card">
              <p class="metric-label">会话</p>
              <strong :class="['state-text', qwenStatusTone]">{{ qwenStatus }}</strong>
              <p class="metric-note">就绪后发送音频</p>
            </div>

            <div class="metric-card">
              <p class="metric-label">采集</p>
              <strong>{{ sidecarStatus }}</strong>
              <p class="metric-note">系统输出</p>
            </div>
          </div>

          <div class="panel event-panel">
            <p class="section-title">事件</p>
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
        <p v-if="showSourceLine && sourceText" class="source-line">{{ sourceText }}</p>
        <p v-if="translatedText" class="translated-line">{{ translatedText }}</p>
      </section>
    </Transition>
  </main>
</template>

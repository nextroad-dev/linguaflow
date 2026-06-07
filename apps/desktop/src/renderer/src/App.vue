<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { SubtitleState } from "@protocol";

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

const isOverlay = new URLSearchParams(window.location.search).get("overlay") === "1";
const isTranslating = ref(false);
const apiKey = ref("");
const maskedApiKey = ref("");
const hasApiKey = ref(false);
const dashscopeRegion = ref<"cn" | "intl">("cn");
const settingsMessage = ref("");
const translationError = ref("");
const pipelineStatus = ref("待启动");
const qwenStatus = ref("未连接");
const sidecarStatus = ref("未启动");
const audioDevice = ref("等待音频设备");
const audioRms = ref(0);
const audioPeak = ref(0);
const statusLog = ref<string[]>([]);
const subtitleState = ref<SubtitleState>({
  isListening: false,
  history: []
});

const activeSubtitle = computed(() => subtitleState.value.current ?? subtitleState.value.history.at(-1));
const sourceText = computed(() => activeSubtitle.value?.sourceText ?? "");
const translatedText = computed(() => activeSubtitle.value?.translatedText ?? "");
const audioLevelPercent = computed(() => Math.min(100, Math.round(audioRms.value * 500)));
const qwenStatusTone = computed(() => {
  if (qwenStatus.value.includes("error") || qwenStatus.value.includes("closed")) {
    return "danger";
  }

  if (qwenStatus.value.includes("session.updated") || qwenStatus.value.includes("connected")) {
    return "good";
  }

  return "idle";
});
let cleanupSubtitleListener: (() => void) | undefined;
let cleanupTranslationStateListener: (() => void) | undefined;
let cleanupTranslationErrorListener: (() => void) | undefined;
let cleanupPipelineStatusListener: (() => void) | undefined;

function toggleTranslation(): void {
  translationError.value = "";
  window.electron.ipcRenderer.send("toggle-translation", !isTranslating.value);
}

async function loadSettings(): Promise<void> {
  const settings = await window.electron.ipcRenderer.invoke<{
    hasDashscopeApiKey: boolean;
    maskedDashscopeApiKey: string;
    dashscopeRegion: "cn" | "intl";
  }>("settings:get");

  hasApiKey.value = settings.hasDashscopeApiKey;
  maskedApiKey.value = settings.maskedDashscopeApiKey;
  dashscopeRegion.value = settings.dashscopeRegion;
}

async function saveApiKey(): Promise<void> {
  settingsMessage.value = "";
  translationError.value = "";

  if (!apiKey.value.trim()) {
    settingsMessage.value = "请输入 DashScope API Key";
    return;
  }

  const settings = await window.electron.ipcRenderer.invoke<{
    hasDashscopeApiKey: boolean;
    maskedDashscopeApiKey: string;
    dashscopeRegion: "cn" | "intl";
  }>("settings:save", {
    dashscopeApiKey: apiKey.value,
    dashscopeRegion: dashscopeRegion.value
  });

  hasApiKey.value = settings.hasDashscopeApiKey;
  maskedApiKey.value = settings.maskedDashscopeApiKey;
  dashscopeRegion.value = settings.dashscopeRegion;
  apiKey.value = "";
  settingsMessage.value = "已保存";
}

function handlePipelineStatus(message: string): void {
  pipelineStatus.value = message;
  statusLog.value = [message, ...statusLog.value].slice(0, 6);

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
  audioDevice.value = deviceName ?? "默认系统输出设备";
}

onMounted(() => {
  if (!isOverlay) {
    void loadSettings();
  }

  cleanupSubtitleListener = window.electron.ipcRenderer.on("subtitle-update", (state) => {
    subtitleState.value = state as SubtitleState;
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
});

onBeforeUnmount(() => {
  cleanupSubtitleListener?.();
  cleanupTranslationStateListener?.();
  cleanupTranslationErrorListener?.();
  cleanupPipelineStatusListener?.();
});
</script>

<template>
  <main v-if="!isOverlay" class="control-shell">
    <section class="dashboard">
      <header class="dashboard-header">
        <div>
          <p class="eyebrow">AI Live Interpreter</p>
          <h1>实时字幕控制台</h1>
        </div>
        <p class="status-pill" :class="{ active: isTranslating }">
          {{ isTranslating ? "运行中" : "待机" }}
        </p>
      </header>

      <section class="hero-row">
        <div class="control-card primary-card">
          <p class="section-title">翻译控制</p>
          <button class="toggle-button" :class="{ active: isTranslating }" type="button" @click="toggleTranslation">
            {{ isTranslating ? "停止翻译" : "开始翻译" }}
          </button>
          <p class="pipeline-status">{{ pipelineStatus }}</p>

          <div class="settings-row">
            <label for="api-key">DashScope API Key</label>
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
            <div class="region-toggle" aria-label="DashScope service region">
              <button
                type="button"
                :class="{ selected: dashscopeRegion === 'cn' }"
                @click="dashscopeRegion = 'cn'"
              >
                中国站
              </button>
              <button
                type="button"
                :class="{ selected: dashscopeRegion === 'intl' }"
                @click="dashscopeRegion = 'intl'"
              >
                国际站
              </button>
            </div>
            <p class="settings-hint">
              {{ hasApiKey ? `当前：${maskedApiKey}` : "尚未保存 API Key" }}
              · {{ dashscopeRegion === "cn" ? "dashscope.aliyuncs.com" : "dashscope-intl.aliyuncs.com" }}
              <span v-if="settingsMessage"> · {{ settingsMessage }}</span>
            </p>
          </div>

          <p v-if="translationError" class="error-message">{{ translationError }}</p>
        </div>

        <div class="control-card subtitle-preview">
          <p class="section-title">字幕预览</p>
          <div class="preview-lines">
            <p class="preview-source">{{ sourceText || "等待原文识别结果" }}</p>
            <p class="preview-translation">{{ translatedText || "等待译文输出" }}</p>
          </div>
        </div>
      </section>

      <section class="metrics-grid">
        <div class="metric-card">
          <p class="metric-label">音频输入</p>
          <strong>{{ audioDevice }}</strong>
          <div class="level-meter" aria-label="audio level">
            <span :style="{ width: `${audioLevelPercent}%` }"></span>
          </div>
          <p class="metric-note">RMS {{ audioRms.toFixed(4) }} · Peak {{ audioPeak.toFixed(4) }}</p>
        </div>

        <div class="metric-card">
          <p class="metric-label">Qwen 会话</p>
          <strong :class="['state-text', qwenStatusTone]">{{ qwenStatus }}</strong>
          <p class="metric-note">收到 session.updated 后才会发送音频</p>
        </div>

        <div class="metric-card">
          <p class="metric-label">Sidecar</p>
          <strong>{{ sidecarStatus }}</strong>
          <p class="metric-note">C# WASAPI Loopback 捕获系统默认输出设备</p>
        </div>
      </section>

      <section class="event-panel">
        <p class="section-title">最近事件</p>
        <ol>
          <li v-for="item in statusLog" :key="item">{{ item }}</li>
        </ol>
      </section>
    </section>
  </main>

  <main v-else class="overlay-shell">
    <Transition name="subtitle-fade" mode="out-in">
      <section
        v-if="sourceText || translatedText"
        :key="`${sourceText}-${translatedText}`"
        class="subtitle-card"
      >
        <p v-if="sourceText" class="source-line">{{ sourceText }}</p>
        <p v-if="translatedText" class="translated-line">{{ translatedText }}</p>
      </section>
    </Transition>
  </main>
</template>

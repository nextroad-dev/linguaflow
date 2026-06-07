<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { SubtitleState } from "@protocol";

declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        send: (channel: string, ...args: unknown[]) => void;
        on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
      };
    };
  }
}

const isOverlay = new URLSearchParams(window.location.search).get("overlay") === "1";
const isTranslating = ref(false);
const subtitleState = ref<SubtitleState>({
  isListening: false,
  history: []
});

const activeSubtitle = computed(() => subtitleState.value.current ?? subtitleState.value.history.at(-1));
const sourceText = computed(() => activeSubtitle.value?.sourceText ?? "");
const translatedText = computed(() => activeSubtitle.value?.translatedText ?? "");
let cleanupSubtitleListener: (() => void) | undefined;
let cleanupTranslationStateListener: (() => void) | undefined;

function toggleTranslation(): void {
  window.electron.ipcRenderer.send("toggle-translation", !isTranslating.value);
}

onMounted(() => {
  cleanupSubtitleListener = window.electron.ipcRenderer.on("subtitle-update", (state) => {
    subtitleState.value = state as SubtitleState;
  });

  cleanupTranslationStateListener = window.electron.ipcRenderer.on("translation-state", (enabled) => {
    isTranslating.value = Boolean(enabled);
  });
});

onBeforeUnmount(() => {
  cleanupSubtitleListener?.();
  cleanupTranslationStateListener?.();
});
</script>

<template>
  <main v-if="!isOverlay" class="control-shell">
    <section class="control-panel">
      <p class="eyebrow">AI Live Interpreter</p>
      <h1>实时字幕控制台</h1>
      <p class="status" :class="{ active: isTranslating }">
        {{ isTranslating ? "正在监听系统音频" : "已暂停" }}
      </p>

      <button class="toggle-button" :class="{ active: isTranslating }" type="button" @click="toggleTranslation">
        {{ isTranslating ? "停止翻译" : "开始翻译" }}
      </button>
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

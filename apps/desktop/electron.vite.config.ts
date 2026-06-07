import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@main": resolve("src/main"),
        "@protocol": resolve("../../packages/protocol/src")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@preload": resolve("src/preload"),
        "@protocol": resolve("../../packages/protocol/src")
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@protocol": resolve("../../packages/protocol/src")
      }
    },
    plugins: [vue()]
  }
});

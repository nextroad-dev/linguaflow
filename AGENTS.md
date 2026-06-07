# AGENTS.md

本文件给后续 coding agent 使用。开始改动前先读这里，再结合当前任务查看相关源码。

## 项目概览

- LinguaFlow 是一个 AI 实时音频翻译桌面应用，目标是把单向音频流实时翻译成中文，并以字幕或语音形式呈现。
- 仓库是 pnpm workspace：
  - `apps/desktop`: Electron + Vue 桌面端，是主要应用入口。
  - `apps/audio-sidecar`: .NET 8/NAudio 音频采集 sidecar，当前面向 `win-x64`。
  - `packages/protocol`: 主进程与 sidecar/渲染端共享的 TypeScript 协议类型。
  - `doc`: 产品和技术调研文档。

## 常用命令

在仓库根目录优先使用 pnpm workspace 命令：

```powershell
pnpm --filter ai-live-interpreter-desktop dev
pnpm --filter ai-live-interpreter-desktop typecheck
pnpm --filter ai-live-interpreter-desktop build
pnpm --filter ai-live-interpreter-desktop pack
pnpm --filter ai-live-interpreter-desktop dist
pnpm --filter @ai-live-interpreter/protocol build
```

桌面端脚本会调用 sidecar 构建：

```powershell
dotnet build apps/audio-sidecar/AudioSidecar.csproj -c Release -r win-x64
dotnet publish apps/audio-sidecar/AudioSidecar.csproj -c Release -r win-x64 --self-contained true
```

说明：

- 根 `package.json` 暂时没有脚本，命令集中在 `apps/desktop/package.json` 和 `packages/protocol/package.json`。
- 桌面端 `dev` 会先运行 `build:sidecar:dev`，所以需要本机可用 .NET SDK。
- 项目已有 `pnpm-lock.yaml` 和 `pnpm-workspace.yaml`，不要混用新的包管理器锁文件。

## 代码结构和边界

- Electron 主进程在 `apps/desktop/src/main`：
  - `index.ts`: 创建主窗口、overlay 窗口并注册 IPC。
  - `ipc-handlers.ts`: 渲染端请求入口。
  - `realtime-pipeline.ts`: 实时翻译流程协调。
  - `sidecar-bridge.ts`: 与 .NET sidecar 通信。
  - `qwen-provider.ts`: AI 服务适配。
  - `settings-store.ts`: 本地设置持久化。
- Preload 在 `apps/desktop/src/preload/index.ts`，通过 `contextBridge` 暴露 `window.electron.ipcRenderer`。
- Vue 渲染端在 `apps/desktop/src/renderer/src`，入口为 `main.ts`，主界面为 `App.vue`，样式在 `styles.css`。
- 共享协议类型在 `packages/protocol/src`。修改协议时优先改源码类型，然后运行 protocol build；不要手写 `dist` 产物。
- C# sidecar 在 `apps/audio-sidecar`，主要入口是 `Program.cs`，消息模型在 `Models/BridgeMessages.cs`，音频采集服务在 `Services/AudioCaptureService.cs`。

## 别名

`apps/desktop/electron.vite.config.ts` 定义了这些别名：

- 主进程：`@main` -> `apps/desktop/src/main`
- 预加载：`@preload` -> `apps/desktop/src/preload`
- 渲染端：`@renderer` -> `apps/desktop/src/renderer/src`
- 共享协议：`@protocol` -> `packages/protocol/src`

新增导入时优先沿用这些别名。

## 开发约定

- 保持 TypeScript 类型边界清晰。跨进程、跨 sidecar 的消息结构应放进 `packages/protocol/src` 或对应 C# message model，而不是散落在调用点。
- 渲染端不要直接使用 Node/Electron API；通过 preload 暴露的 IPC 能力访问主进程。
- 使用 `ipcRenderer.on` 时保留并调用返回的取消订阅函数，避免 Vue 组件卸载后泄漏监听器。
- 修改音频链路时同时检查 TypeScript 协议、C# bridge message、主进程解析逻辑三处是否一致。
- 生成目录和依赖目录不要手工编辑：`node_modules`, `out`, `dist`, `bin`, `obj`。
- 现有代码使用 Prettier/ESLint；提交前尽量跑对应包的 `typecheck`，大改动再跑 `build`。

## 验证建议

- 只改渲染层 UI：运行 `pnpm --filter ai-live-interpreter-desktop typecheck`，必要时启动 `dev` 做人工检查。
- 改 Electron 主进程、preload 或协议：运行桌面端 `typecheck`，并视情况运行 protocol `build`。
- 改 sidecar 或音频采集：运行 `dotnet build apps/audio-sidecar/AudioSidecar.csproj -c Release -r win-x64`，再运行桌面端 `dev` 检查主进程能否启动 sidecar。
- 改打包配置：至少运行 `pnpm --filter ai-live-interpreter-desktop build`，发布相关改动再运行 `pack` 或 `dist`。

## 工作区注意事项

- 当前仓库可能存在用户未提交改动；开始编辑前用 `git status --short` 看清楚，避免覆盖不相关文件。
- 如果只需要新增或修改少量文件，保持改动范围小，不顺手重排无关代码。
- 文档和注释可以使用中文；代码标识符、类型名和 IPC channel 名保持现有英文风格。

# LinguaFlow

**AI 驱动的实时音频翻译桌面应用**

LinguaFlow 是一个基于 AI 技术的实时音频翻译系统，能够将单向音频流实时、流畅地翻译成中文，并以字幕或语音形式呈现，帮助用户轻松跟上内容节奏。

## 当前版本

- 最新版本：`v1.0.0`
- 已构建平台：Windows x64
- Release 包：`LinguaFlow-v1.0.0-win-x64.zip`
- 下载地址：[GitHub Releases](https://github.com/nextroad-dev/linguaflow/releases/tag/v1.0.0)

Windows 用户可以下载压缩包，解压后运行其中的 `LinguaFlow.exe`。

## 演示视频

- Bilibili：[LinguaFlow 演示视频](https://www.bilibili.com/video/BV1KHEt6qEUt/)

## 功能概览

- 实时处理单向音频流，并将内容翻译成中文。
- 通过桌面主窗口与字幕 overlay 呈现翻译结果。
- 使用独立音频 sidecar 采集 Windows 音频，主应用负责实时翻译流程协调。

## 技术栈

- pnpm workspace
- Electron + Vue + TypeScript
- .NET 8 + NAudio 音频采集 sidecar
- 共享 TypeScript 协议包

## 项目结构

```text
LinguaFlow/
├─ apps/
│  ├─ desktop/                  Electron + Vue 桌面端
│  │  ├─ src/main/              Electron 主进程
│  │  │  ├─ index.ts            应用入口，创建主窗口并注册 IPC
│  │  │  ├─ ipc-handlers.ts     渲染端 IPC 请求处理
│  │  │  ├─ overlay-window.ts   字幕 overlay 窗口管理
│  │  │  ├─ realtime-pipeline.ts 实时翻译流程协调
│  │  │  ├─ sidecar-bridge.ts   与音频 sidecar 通信
│  │  │  ├─ qwen-provider.ts    AI 翻译服务适配
│  │  │  ├─ settings-store.ts   本地设置持久化
│  │  │  ├─ audio-sentence-segmenter.ts 音频转写句段切分
│  │  │  └─ subtitle-assembler.ts 字幕文本组装
│  │  ├─ src/preload/
│  │  │  └─ index.ts            通过 contextBridge 暴露安全 IPC 能力
│  │  ├─ src/renderer/src/      Vue 渲染端
│  │  │  ├─ App.vue             主界面
│  │  │  ├─ FluentIcon.vue      Fluent 图标组件
│  │  │  ├─ main.ts             渲染端入口
│  │  │  └─ styles.css          全局样式
│  │  ├─ electron.vite.config.ts Electron/Vite 构建配置与路径别名
│  │  └─ package.json           桌面端脚本与依赖
│  └─ audio-sidecar/            .NET 8/NAudio 音频采集 sidecar
│     ├─ Program.cs             sidecar 进程入口
│     ├─ Models/BridgeMessages.cs 主进程与 sidecar 的消息模型
│     ├─ Services/AudioCaptureService.cs 音频采集服务
│     └─ AudioSidecar.csproj    .NET 项目配置
├─ packages/
│  └─ protocol/                 共享 TypeScript 协议包
│     └─ src/
│        ├─ index.ts            协议包导出入口
│        └─ types.ts            跨进程/跨 sidecar 的共享类型
├─ doc/                         产品和技术调研文档
├─ .github/workflows/
│  └─ release.yml               Windows release 自动化工作流
├─ pnpm-workspace.yaml          pnpm workspace 配置
├─ pnpm-lock.yaml               依赖锁文件
└─ package.json                 workspace 根 package
```

核心链路大致是：渲染端 `App.vue` 通过 preload 暴露的 IPC 调用主进程，主进程的 `realtime-pipeline.ts` 协调 sidecar 音频输入、AI 翻译服务和字幕输出，`packages/protocol` 负责沉淀这些跨边界消息的 TypeScript 类型。

## 本地开发

推荐环境：

- Windows x64
- Node.js 20
- pnpm 9
- .NET 8 SDK

安装依赖：

```powershell
pnpm install
```

启动桌面端开发环境：

```powershell
pnpm --filter ai-live-interpreter-desktop dev
```

类型检查：

```powershell
pnpm --filter ai-live-interpreter-desktop typecheck
```

构建桌面端：

```powershell
pnpm --filter ai-live-interpreter-desktop build
```

构建共享协议包：

```powershell
pnpm --filter @ai-live-interpreter/protocol build
```

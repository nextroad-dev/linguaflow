import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import type { ControlCommand, SidecarToMainMessage } from "@protocol";

type SidecarManagerEvents = {
  message: [message: SidecarToMainMessage];
  close: [code: number | null, signal: NodeJS.Signals | null];
  error: [error: Error];
  stderr: [line: string];
};

export type SidecarManagerOptions = {
  executablePath?: string;
  cwd?: string;
  autoRestart?: boolean;
  restartDelayMs?: number;
  maxRestartAttempts?: number;
};

export declare interface SidecarManager {
  on<K extends keyof SidecarManagerEvents>(event: K, listener: (...args: SidecarManagerEvents[K]) => void): this;
  once<K extends keyof SidecarManagerEvents>(event: K, listener: (...args: SidecarManagerEvents[K]) => void): this;
  off<K extends keyof SidecarManagerEvents>(event: K, listener: (...args: SidecarManagerEvents[K]) => void): this;
  emit<K extends keyof SidecarManagerEvents>(event: K, ...args: SidecarManagerEvents[K]): boolean;
}

export class SidecarManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private restartAttempts = 0;
  private stopping = false;
  private restartTimer: NodeJS.Timeout | null = null;

  private readonly executablePath: string;
  private readonly cwd: string;
  private readonly autoRestart: boolean;
  private readonly restartDelayMs: number;
  private readonly maxRestartAttempts: number;

  constructor(options: SidecarManagerOptions = {}) {
    super();

    this.executablePath = options.executablePath ?? getDefaultSidecarExecutablePath();
    this.cwd = options.cwd ?? resolve(this.executablePath, "..");
    this.autoRestart = options.autoRestart ?? true;
    this.restartDelayMs = options.restartDelayMs ?? 1000;
    this.maxRestartAttempts = options.maxRestartAttempts ?? 3;
  }

  start(): void {
    if (this.child) {
      return;
    }

    this.clearRestartTimer();
    this.stopping = false;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";

    if (!existsSync(this.executablePath)) {
      const error = new Error(`Audio sidecar executable not found: ${this.executablePath}`);
      this.emit("error", error);
      this.scheduleRestart();
      return;
    }

    const child = spawn(this.executablePath, [], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    this.child = child;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string | Buffer) => {
      this.handleStdoutChunk(chunk.toString());
    });

    child.stderr.on("data", (chunk: string | Buffer) => {
      this.handleStderrChunk(chunk.toString());
    });

    child.on("error", (error) => {
      this.emit("error", error);
    });

    child.on("close", (code, signal) => {
      this.child = null;
      this.flushStdoutBuffer();
      this.flushStderrBuffer();
      this.emit("close", code, signal);

      if (!this.stopping) {
        this.scheduleRestart();
      }
    });
  }

  sendCommand(cmd: ControlCommand): void {
    if (!this.child || this.child.stdin.destroyed || !this.child.stdin.writable) {
      throw new Error("Audio sidecar process is not running");
    }

    this.child.stdin.write(`${JSON.stringify(cmd)}\n`, "utf8");
  }

  stop(): void {
    this.stopping = true;
    this.clearRestartTimer();

    if (!this.child) {
      return;
    }

    try {
      this.sendCommand({
        direction: "main-to-sidecar",
        type: "control.shutdown",
        requestId: randomUUID()
      });
    } catch {
      this.child.kill();
    }
  }

  kill(): void {
    this.stopping = true;
    this.clearRestartTimer();
    this.child?.kill();
  }

  private handleStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;

    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      this.handleStdoutLine(line);
    }
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      return;
    }

    try {
      const message = JSON.parse(trimmed) as SidecarToMainMessage;
      this.emit("message", message);
    } catch (cause) {
      this.emit("error", new Error(`Failed to parse sidecar JSONL: ${trimmed}`, { cause }));
    }
  }

  private flushStdoutBuffer(): void {
    const line = this.stdoutBuffer;
    this.stdoutBuffer = "";
    this.handleStdoutLine(line);
  }

  private handleStderrChunk(chunk: string): void {
    this.stderrBuffer += chunk;

    const lines = this.stderrBuffer.split(/\r?\n/);
    this.stderrBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.length > 0) {
        this.emit("stderr", trimmed);
      }
    }
  }

  private flushStderrBuffer(): void {
    const line = this.stderrBuffer.trim();
    this.stderrBuffer = "";

    if (line.length > 0) {
      this.emit("stderr", line);
    }
  }

  private scheduleRestart(): void {
    if (!this.autoRestart || this.restartAttempts >= this.maxRestartAttempts) {
      return;
    }

    this.restartAttempts += 1;
    this.clearRestartTimer();

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, this.restartDelayMs);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }
}

function getDefaultSidecarExecutablePath(): string {
  if (app.isPackaged) {
    return resolve(process.resourcesPath, "audio-sidecar", "AudioSidecar.exe");
  }

  const candidates = [
    resolve(
      __dirname,
      "..",
      "..",
      "..",
      "audio-sidecar",
      "bin",
      "Release",
      "net8.0",
      "win-x64",
      "AudioSidecar.exe"
    ),
    resolve(
      process.cwd(),
      "..",
      "audio-sidecar",
      "bin",
      "Release",
      "net8.0",
      "win-x64",
      "AudioSidecar.exe"
    ),
    resolve(
      process.cwd(),
      "apps",
      "audio-sidecar",
      "bin",
      "Release",
      "net8.0",
      "win-x64",
      "AudioSidecar.exe"
    ),
    resolve(
      __dirname,
      "..",
      "..",
      "..",
      "audio-sidecar",
      "bin",
      "Release",
      "net8.0",
      "win-x64",
      "publish",
      "AudioSidecar.exe"
    ),
    resolve(
      process.cwd(),
      "..",
      "audio-sidecar",
      "bin",
      "Release",
      "net8.0",
      "win-x64",
      "publish",
      "AudioSidecar.exe"
    ),
    resolve(
      process.cwd(),
      "apps",
      "audio-sidecar",
      "bin",
      "Release",
      "net8.0",
      "win-x64",
      "publish",
      "AudioSidecar.exe"
    ),
    resolve(__dirname, "..", "..", "..", "audio-sidecar", "bin", "Release", "net8.0", "AudioSidecar.exe"),
    resolve(process.cwd(), "..", "audio-sidecar", "bin", "Release", "net8.0", "AudioSidecar.exe"),
    resolve(process.cwd(), "apps", "audio-sidecar", "bin", "Release", "net8.0", "AudioSidecar.exe")
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

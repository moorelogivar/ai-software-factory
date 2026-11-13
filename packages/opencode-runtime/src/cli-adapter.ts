
import { spawn } from "node:child_process";

import {
  buildModelQueue,
  toProviderModel,
} from "../../model-router/src/index";

import type {
  Agent,
  Task,
  TaskResult,
} from "../../shared/src/index";

export interface OpenCodeAdapterConfig {
  binary?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  // Model cadangan yang dipakai bila model utama gagal. Kosongkan untuk
  // memakai daftar model gratis dari model-router.
  fallbackModels?: string[];
  resolveProjectDirectory: (
    projectId: string,
  ) => Promise<string>;
}

interface OpenCodeEvent {
  type?: string;
  sessionID?: string;
  part?: {
    text?: string;
    reason?: string;
    cost?: number;
    tokens?: {
      input?: number;
      output?: number;
    };
  };
  error?: unknown;
}

export interface OpenCodeErrorDetail {
  type?: string;
  message?: string;
  status?: number;
  retryAfterMs?: number;
  raw: unknown;
}

export interface ParseResult {
  sessionID: string | undefined;
  text: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  events: string[];
  error: OpenCodeErrorDetail | undefined;
}

function readErrorDetail(error: unknown): OpenCodeErrorDetail {
  if (!error || typeof error !== "object") {
    return { raw: error };
  }

  const record = error as Record<string, unknown>;

  return {
    type: typeof record.type === "string" ? record.type : undefined,
    message:
      typeof record.message === "string" ? record.message : undefined,
    status: typeof record.status === "number" ? record.status : undefined,
    retryAfterMs:
      typeof record.retryAfterMs === "number"
        ? record.retryAfterMs
        : undefined,
    raw: error,
  };
}

// Error yang bersifat sementara: kuota model habis atau rate limit.
// Layak dicoba lagi baik dengan model lain maupun dengan menunggu.
function isRetryableError(detail: OpenCodeErrorDetail): boolean {
  if (detail.type === "provider.free-limit") return true;

  if (detail.type === "provider.rate-limit") return true;

  if (detail.status === 429 || detail.status === 503) return true;

  const message = detail.message?.toLowerCase() ?? "";

  return (
    message.includes("rate limit") ||
    message.includes("free usage limit") ||
    message.includes("overloaded")
  );
}

export function parseOutput(stdout: string): ParseResult {
  let sessionID: string | undefined;
  const textParts: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  const events: string[] = [];
  let error: OpenCodeErrorDetail | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;

    try {
      const event = JSON.parse(line) as OpenCodeEvent;

      if (event.sessionID) {
        sessionID = event.sessionID;
      }

      if (event.type) {
        events.push(event.type);
      }

      if (event.type === "text" && event.part?.text) {
        textParts.push(event.part.text);
      }

      if (event.type === "step_finish" && event.part) {
        inputTokens += event.part.tokens?.input ?? 0;
        outputTokens += event.part.tokens?.output ?? 0;
        cost += event.part.cost ?? 0;
      }

      if (event.type === "error") {
        error = readErrorDetail(event.error ?? event.part);
      }
    } catch {
      // Abaikan baris yang bukan JSON valid.
    }
  }

  return {
    sessionID,
    text: textParts.join("\n\n"),
    inputTokens,
    outputTokens,
    cost,
    events,
    error,
  };
}

export class OpenCodeCLIAdapter {
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(
    private readonly config: OpenCodeAdapterConfig,
  ) {
    this.binary =
      config.binary ?? process.env.OPENCODE_BIN ?? "opencode";

    this.timeoutMs = config.timeoutMs ?? 15 * 60 * 1000;
    this.maxOutputBytes = config.maxOutputBytes ?? 1024 * 1024;
  }

  async execute(
    task: Task,
    agent: Agent,
  ): Promise<TaskResult> {
    try {
      const workingDirectory =
        await this.config.resolveProjectDirectory(task.projectId);

      const prompt = this.buildPrompt(task, agent);

      const modelQueue = buildModelQueue({
        primary: agent.model,
        provider: agent.provider,
        fallbacks: this.config.fallbackModels,
      });

      let lastFailure: TaskResult | undefined;
      let longestWaitMs = 0;

      // Coba model utama dulu, lalu model cadangan satu per satu.
      // Berpindah model tidak menunggu apa pun karena kuota tiap model
      // terpisah; menunggu hanya diperlukan bila semua model gagal.
      for (const model of modelQueue) {
        const result = await this.runProcess(
          workingDirectory,
          prompt,
          agent,
          model,
        );

        if (result.success) {
          return result;
        }

        lastFailure = result;

        if (result.retryable) {
          longestWaitMs = Math.max(
            longestWaitMs,
            result.retryAfterMs ?? 0,
          );
        } else {
          // Kegagalan permanen, pindah model tidak akan membantu.
          break;
        }
      }

      if (lastFailure?.retryable) {
        // Semua model gagal. Serahkan penjadwalan ulang ke orchestrator,
        // yang akan memilih waktu tunggu terpanjang dari semua model.
        return {
          ...lastFailure,
          output: {
            ...lastFailure.output,
            attemptedModels: modelQueue,
          },
          retryAfterMs: longestWaitMs,
        };
      }

      return lastFailure ?? {
        success: false,
        error: "Tidak ada model yang dapat dijalankan",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error
          ? error.message
          : String(error),
      };
    }
  }

  private buildPrompt(task: Task, agent: Agent): string {
    return [
      `You are acting as the ${agent.role} agent.`,
      `Agent name: ${agent.name}`,
      "",
      "TASK INFORMATION",
      `Task ID: ${task.id}`,
      `Title: ${task.title}`,
      `Description: ${task.description ?? "No description provided"}`,
      "",
      "TASK INPUT",
      JSON.stringify(task.input ?? {}, null, 2),
      "",
      "INSTRUCTIONS",
      "1. Analyze the task before making changes.",
      "2. Work only inside the current project directory.",
      "3. Follow the existing project conventions.",
      "4. Do not deploy to production.",
      "5. Report the changes and remaining issues.",
    ].join("\n");
  }

  private runProcess(
    workingDirectory: string,
    prompt: string,
    agent: Agent,
    model: string,
  ): Promise<TaskResult> {
    return new Promise((resolve) => {
      const args = [
        "run",
        "--agent", agent.name,
        "--model", toProviderModel(agent.provider, model),
        "--format", "json",
        prompt,
      ];

      const child = spawn(this.binary, args, {
        cwd: workingDirectory,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let truncated = false;

      const appendOutput = (
        current: string,
        chunk: Buffer,
      ): string => {
        const remaining =
          this.maxOutputBytes - Buffer.byteLength(current);

        if (remaining <= 0) {
          truncated = true;
          return current;
        }

        if (chunk.length > remaining) {
          truncated = true;
        }

        return current + chunk
          .subarray(0, remaining)
          .toString("utf8");
      };

      const finish = (result: TaskResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");

        setTimeout(() => {
          if (child.exitCode === null) {
            child.kill("SIGKILL");
          }
        }, 5000);
      }, this.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendOutput(stdout, chunk);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendOutput(stderr, chunk);
      });

      child.on("error", (error) => {
        finish({
          success: false,
          error: `Gagal menjalankan OpenCode: ${error.message}`,
        });
      });

      child.on("close", (code) => {
        if (timedOut) {
          finish({
            success: false,
            error: `OpenCode timeout setelah ${this.timeoutMs}ms`,
            output: { stdout, stderr },
          });
          return;
        }

        // Output yang terpotong berarti event terakhir (jawaban akhir)
        // bisa hilang. Jangan tandai task sukses, karena hasilnya parsial.
        if (truncated) {
          finish({
            success: false,
            error:
              `Output OpenCode melebihi batas ${this.maxOutputBytes} byte ` +
              `dan dipotong. Hasil eksekusi tidak dapat dipercaya.`,
            output: { stdout, stderr, truncated: true },
          });
          return;
        }

        const parsed: ParseResult = parseOutput(stdout);

        const output = {
          sessionID: parsed.sessionID,
          text: parsed.text,
          inputTokens: parsed.inputTokens,
          outputTokens: parsed.outputTokens,
          cost: parsed.cost,
          events: parsed.events,
          stderr,
          exitCode: code,
        };

        // OpenCode melaporkan kegagalan lewat event `error`.
        if (parsed.error) {
          const detail = parsed.error;
          const retryable = isRetryableError(detail);

          finish({
            success: false,
            error:
              `OpenCode reported an error: ` +
              JSON.stringify(detail.raw),
            retryable,
            retryAfterMs: detail.retryAfterMs,
            output,
          });
          return;
        }

        if (parsed.events.length === 0) {
          finish({
            success: false,
            error:
              "OpenCode tidak menghasilkan event apa pun. " +
              "Kemungkinan format output tidak dikenali.",
            output: { stdout, stderr },
          });
          return;
        }

        if (code !== 0) {
          finish({
            success: false,
            error: stderr || `OpenCode exit code: ${code}`,
            output,
          });
          return;
        }

        finish({
          success: true,
          output,
        });
      });
    });
  }
}

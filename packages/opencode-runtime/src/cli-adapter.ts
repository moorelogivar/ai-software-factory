
import { spawn } from "node:child_process";

import type {
  Agent,
  Task,
  TaskResult,
} from "../../shared/src/index";

export interface OpenCodeAdapterConfig {
  binary?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
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

function parseOutput(stdout: string) {
  let sessionID: string | undefined;
  let textOutput = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  const events: string[] = [];

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
        textOutput += event.part.text;
      }

      if (event.type === "step_finish" && event.part) {
        inputTokens += event.part.tokens?.input ?? 0;
        outputTokens += event.part.tokens?.output ?? 0;
        cost += event.part.cost ?? 0;
      }

      if (event.type === "error") {
        throw new Error(
          `OpenCode reported an error: ${JSON.stringify(event.error ?? event.part)}`,
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("OpenCode reported an error:")
      ) {
        throw error;
      }

      // Abaikan baris yang bukan JSON valid.
    }
  }

  return {
    sessionID,
    text: textOutput,
    inputTokens,
    outputTokens,
    cost,
    events,
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

      return await this.runProcess(
        workingDirectory,
        prompt,
        agent,
      );
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
  ): Promise<TaskResult> {
    return new Promise((resolve) => {
      const args = [
        "run",
        "--agent", agent.name,
        "--model", `${agent.provider}/${agent.model}`,
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

      const appendOutput = (
        current: string,
        chunk: Buffer,
      ): string => {
        const remaining =
          this.maxOutputBytes - Buffer.byteLength(current);

        if (remaining <= 0) return current;

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

        let parsed;

        try {
          parsed = parseOutput(stdout);
        } catch (error) {
          finish({
            success: false,
            error: error instanceof Error
              ? error.message
              : String(error),
            output: { stdout, stderr },
          });
          return;
        }

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

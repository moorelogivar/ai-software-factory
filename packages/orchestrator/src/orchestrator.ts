
import { eq, sql } from "drizzle-orm";

import { db } from "../../database/src/client";
import { tasks, agents } from "../../database/src/schema";

import { agentRegistry } from "./agent-registry";
import { taskManager } from "./task-manager";
import { executionManager } from "./execution-manager";

import {
  TaskScheduler,
  type ScheduledTask,
} from "./task-scheduler";

import type {
  Agent,
  AgentRegistration,
  OrchestratorConfig,
  OrchestratorStatus,
  Task,
  TaskResult,
} from "../../shared/src/index";

export interface TaskExecutor {
  execute(task: Task, agent: Agent): Promise<TaskResult>;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxConcurrentAgents: 2,
  maxConcurrentAgentsPerProject: 2,
  pollingIntervalMs: 3000,
};

function getOutputValue(
  output: Record<string, unknown> | undefined,
  key: string,
): unknown {
  return output?.[key];
}

function getNumber(
  output: Record<string, unknown> | undefined,
  key: string,
): number {
  const value = getOutputValue(output, key);

  return typeof value === "number" && Number.isFinite(value)
    ? value
    : 0;
}

export class OrchestratorCore {
  private running = false;
  private loopPromise?: Promise<void>;

  private readonly scheduler: TaskScheduler;
  private readonly activeExecutions = new Map<string, Promise<void>>();

  constructor(
    private readonly executor: TaskExecutor,
    private readonly config: OrchestratorConfig = DEFAULT_CONFIG,
  ) {
    if (
      config.maxConcurrentAgents < 1 ||
      config.maxConcurrentAgentsPerProject < 1 ||
      config.pollingIntervalMs < 100
    ) {
      throw new Error("Konfigurasi Orchestrator tidak valid");
    }

    this.scheduler = new TaskScheduler(config);
  }

  async registerAgent(input: AgentRegistration): Promise<Agent> {
    return agentRegistry.register(input);
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.loopPromise = this.runLoop();

    console.log("[Orchestrator] Started");
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = undefined;
    }

    console.log("[Orchestrator] Stopped polling");
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.poll();
      } catch (error) {
        console.error("[Orchestrator] Polling error:", error);
      }

      if (!this.running) break;

      await new Promise<void>((resolve) => {
        setTimeout(resolve, this.config.pollingIntervalMs);
      });
    }
  }

  private async poll(): Promise<void> {
    const assignments = await this.scheduler.dispatchAvailable();

    for (const assignment of assignments) {
      this.launchExecution(assignment);
    }
  }

  private launchExecution(assignment: ScheduledTask): void {
    const execution = this.executeAssignment(assignment);

    this.activeExecutions.set(assignment.task.id, execution);

    void execution.then(() => {
      this.activeExecutions.delete(assignment.task.id);
    });
  }

  private async executeAssignment(
    assignment: ScheduledTask,
  ): Promise<void> {
    const { task, agent } = assignment;

    let executionId: string | undefined;
    let sessionID: string | undefined;
    let taskStarted = false;

    try {
      const startedTask = await taskManager.start(task.id);

      if (!startedTask) {
        throw new Error(`Task ${task.id} gagal dimulai`);
      }

      taskStarted = true;

      const execution = await executionManager.start(
        startedTask,
        agent,
      );

      executionId = execution.id;

      console.log(
        `[Orchestrator] Task ${task.id} dijalankan oleh ${agent.name}`,
      );

      const result = await this.executor.execute(
        startedTask,
        agent,
      );

      const output = result.output;

      const rawSessionID = getOutputValue(output, "sessionID");

      if (typeof rawSessionID === "string" && rawSessionID.length > 0) {
        sessionID = rawSessionID;

        await executionManager.createSession(
          startedTask,
          agent,
          sessionID,
          executionId,
        );
      }

      await executionManager.finish(
        executionId,
        result.success ? "succeeded" : "failed",
        {
          errorMessage: result.success
            ? undefined
            : result.error ?? "Task execution failed",
          sessionID,
          inputTokens: getNumber(output, "inputTokens"),
          outputTokens: getNumber(output, "outputTokens"),
          cost: getNumber(output, "cost"),
          metadata: {
            events: getOutputValue(output, "events") ?? [],
            exitCode: getOutputValue(output, "exitCode") ?? null,
            text: getOutputValue(output, "text") ?? null,
          },
        },
      );

      if (sessionID) {
        await executionManager.closeSession(
          sessionID,
          result.success ? "closed" : "error",
        );
      }

      if (result.success) {
        await taskManager.complete(task.id, result);

        console.log(
          `[Orchestrator] Task ${task.id} completed`,
        );
      } else {
        await taskManager.fail(
          task.id,
          result.error ?? "Task execution failed",
        );

        console.error(
          `[Orchestrator] Task ${task.id} failed`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      console.error(
        `[Orchestrator] Execution error ${task.id}:`,
        message,
      );

      if (executionId) {
        try {
          await executionManager.finish(
            executionId,
            "failed",
            { errorMessage: message },
          );
        } catch (finishError) {
          console.error(
            `[Orchestrator] Gagal menyimpan execution:`,
            finishError,
          );
        }
      }

      if (sessionID) {
        try {
          await executionManager.closeSession(sessionID, "error");
        } catch (sessionError) {
          console.error(
            `[Orchestrator] Gagal menutup session:`,
            sessionError,
          );
        }
      }

      if (taskStarted) {
        try {
          await taskManager.fail(task.id, message);
        } catch (failError) {
          console.error(
            `[Orchestrator] Gagal memperbarui task:`,
            failError,
          );
        }
      }
    }
  }

  async waitForIdle(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.activeExecutions.values()),
    );
  }

  async getStatus(): Promise<OrchestratorStatus> {
    const [
      activeAgents,
      queuedTasks,
      completedTasks,
      failedTasks,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` })
        .from(agents)
        .where(eq(agents.status, "busy")),

      db.select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(eq(tasks.status, "queued")),

      db.select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(eq(tasks.status, "completed")),

      db.select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(eq(tasks.status, "failed")),
    ]);

    return {
      running: this.running,
      activeAgents: activeAgents[0]?.count ?? 0,
      queuedTasks: queuedTasks[0]?.count ?? 0,
      completedTasks: completedTasks[0]?.count ?? 0,
      failedTasks: failedTasks[0]?.count ?? 0,
    };
  }
}

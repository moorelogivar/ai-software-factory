
import { eq, sql } from "drizzle-orm";

import { db } from "../../database/src/client";
import {
  executions,
  agentSessions,
} from "../../database/src/schema";

import type {
  Agent,
  Task,
} from "../../shared/src/index";

export type ExecutionFinalStatus =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

export class ExecutionManager {
  async start(task: Task, agent: Agent) {
    const [execution] = await db
      .insert(executions)
      .values({
        taskId: task.id,
        agentId: agent.id,
        status: "running",
        attemptNumber: task.attempts + 1,
        metadata: {
          agentName: agent.name,
          agentRole: agent.role,
          provider: agent.provider,
          model: agent.model,
        },
      })
      .returning();

    if (!execution) {
      throw new Error("Gagal membuat execution record");
    }

    return execution;
  }

  async createSession(
    task: Task,
    agent: Agent,
    sessionID: string,
    executionId: string,
  ) {
    const [session] = await db
      .insert(agentSessions)
      .values({
        projectId: task.projectId,
        agentId: agent.id,
        taskId: task.id,
        opencodeSessionId: sessionID,
        status: "active",
        metadata: { executionId },
      })
      .returning();

    if (!session) {
      throw new Error("Gagal membuat agent session");
    }

    await db
      .update(executions)
      .set({ opencodeSessionId: sessionID })
      .where(eq(executions.id, executionId));

    return session;
  }

  async closeSession(
    sessionID: string,
    status: "closed" | "error",
  ) {
    const [session] = await db
      .update(agentSessions)
      .set({
        status,
        endedAt: new Date(),
      })
      .where(eq(agentSessions.opencodeSessionId, sessionID))
      .returning();

    return session;
  }

  
  async finish(
    executionId: string,
    status: ExecutionFinalStatus,
    options?: {
      errorMessage?: string;
      sessionID?: string;
      inputTokens?: number;
      outputTokens?: number;
      cost?: number;
      metadata?: Record<string, unknown>;
    },
  ) {
    const updates = {
      status,
      errorMessage: options?.errorMessage ?? null,
      inputTokens: options?.inputTokens ?? 0,
      outputTokens: options?.outputTokens ?? 0,
      cost: String(options?.cost ?? 0),
      metadata: sql`COALESCE(${executions.metadata}, '{}'::jsonb)
        || ${JSON.stringify(options?.metadata ?? {})}::jsonb`,
      finishedAt: new Date(),
      ...(options?.sessionID
        ? { opencodeSessionId: options.sessionID }
        : {}),
    };

    const [execution] = await db
      .update(executions)
      .set(updates)
      .where(eq(executions.id, executionId))
      .returning();

    if (!execution) {
      throw new Error(`Execution ${executionId} tidak ditemukan`);
    }

    return execution;
  }


  async getById(executionId: string) {
    const [execution] = await db
      .select()
      .from(executions)
      .where(eq(executions.id, executionId))
      .limit(1);

    return execution;
  }

  async listByTask(taskId: string) {
    return db
      .select()
      .from(executions)
      .where(eq(executions.taskId, taskId));
  }
}

export const executionManager = new ExecutionManager();

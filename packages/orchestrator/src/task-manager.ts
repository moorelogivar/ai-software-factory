import {
  and,
  asc,
  eq,
  inArray,
  sql
} from "drizzle-orm";

import { db } from "../../database/src/client";
import { agents, tasks } from "../../database/src/schema";

import type {
  CreateTaskInput,
  Task,
  TaskResult,
  TaskStatus,
} from "../../shared/src/index";

// ========================================
// TASK MANAGER
// ========================================

export class TaskManager {
  // Create a new task
  async create(input: CreateTaskInput): Promise<Task> {
    const [task] = await db
      .insert(tasks)
      .values({
        ...input,
        status: "backlog",
      })
      .returning();

    if (!task) {
      throw new Error("Gagal membuat task");
    }

    return task;
  }

  // Get task by ID
  async getById(id: string): Promise<Task | undefined> {
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);

    return task;
  }

  // List tasks by project
  async listByProject(
    projectId: string,
    status?: TaskStatus,
  ): Promise<Task[]> {
    const conditions = status
      ? and(
          eq(tasks.projectId, projectId),
          eq(tasks.status, status),
        )
      : eq(tasks.projectId, projectId);

    return db
      .select()
      .from(tasks)
      .where(conditions)
      .orderBy(asc(tasks.createdAt));
  }

  // Move backlog task into queue
  async enqueue(id: string): Promise<Task> {
    const [task] = await db
      .update(tasks)
      .set({
        status: "queued",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tasks.id, id),
          eq(tasks.status, "backlog"),
        ),
      )
      .returning();

    if (!task) {
      throw new Error(
        "Task tidak ditemukan atau bukan berstatus backlog",
      );
    }

    return task;
  }

  // Atomically assign task and reserve agent
  async assign(
    taskId: string,
    agentId: string,
  ): Promise<Task> {
    return db.transaction(async (tx) => {
      const [agent] = await tx
        .update(agents)
        .set({
          status: "busy",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agents.id, agentId),
            eq(agents.status, "idle"),
          ),
        )
        .returning();

      if (!agent) {
        throw new Error(
          "Agent tidak ditemukan atau sedang tidak tersedia",
        );
      }

      const [task] = await tx
        .update(tasks)
        .set({
          assignedAgentId: agentId,
          status: "assigned",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.id, taskId),
            eq(tasks.status, "queued"),
          ),
        )
        .returning();

      if (!task) {
        throw new Error(
          "Task tidak ditemukan atau bukan berstatus queued",
        );
      }

      return task;
    });
  }

  // Start assigned task
  async start(id: string): Promise<Task> {
    const [task] = await db
      .update(tasks)
      .set({
        status: "running",
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tasks.id, id),
          eq(tasks.status, "assigned"),
        ),
      )
      .returning();

    if (!task) {
      throw new Error(
        "Task tidak ditemukan atau belum di-assign",
      );
    }

    return task;
  }

  // Complete running task
  async complete(
    id: string,
    result: TaskResult,
  ): Promise<Task> {
    if (!result.success) {
      throw new Error(
        "Gunakan fail() untuk menyelesaikan task yang gagal",
      );
    }

    return db.transaction(async (tx) => {
      const [task] = await tx
        .update(tasks)
        .set({
          status: "completed",
          result: result.output ?? {},
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.id, id),
            eq(tasks.status, "running"),
          ),
        )
        .returning();

      if (!task) {
        throw new Error(
          "Task tidak ditemukan atau tidak sedang running",
        );
      }

      if (task.assignedAgentId) {
        await tx
          .update(agents)
          .set({
            status: "idle",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agents.id, task.assignedAgentId),
              eq(agents.status, "busy"),
            ),
          );
      }

      return task;
    });
  }

  // Fail running or assigned task
  async fail(
    id: string,
    error: string,
  ): Promise<Task> {
    return db.transaction(async (tx) => {
      const [task] = await tx
        .update(tasks)
        .set({
          status: "failed",
          attempts: sql`${tasks.attempts} + 1`,
          result: {
            success: false,
            error,
          },
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.id, id),
            inArray(tasks.status, ["assigned", "running"]),
          ),
        )
        .returning();

      if (!task) {
        throw new Error(
          "Task tidak ditemukan atau tidak dapat ditandai failed",
        );
      }

      if (task.assignedAgentId) {
        await tx
          .update(agents)
          .set({
            status: "idle",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agents.id, task.assignedAgentId),
              eq(agents.status, "busy"),
            ),
          );
      }

      return task;
    });
  }

  // Kembalikan task ke antrean setelah kegagalan sementara.
  // Bila sisa percobaan sudah habis, task ditandai failed permanen.
  async retry(
    id: string,
    reason: string,
    retryAfterMs = DEFAULT_RETRY_DELAY_MS,
  ): Promise<Task> {
    const task = await this.getById(id);

    if (!task) {
      throw new Error(`Task tidak ditemukan: ${id}`);
    }

    const attemptsUsed = task.attempts + 1;

    if (attemptsUsed >= (task.maxAttempts ?? 3)) {
      return this.fail(id, reason);
    }

    const scheduledAt = new Date(
      Date.now() + Math.max(retryAfterMs, 0),
    );

    const [retried] = await db
      .update(tasks)
      .set({
        status: "queued",
        attempts: sql`${tasks.attempts} + 1`,
        scheduledAt,
        assignedAgentId: null,
        startedAt: null,
        result: {
          success: false,
          error: reason,
          retry: true,
          retryAfterMs,
          nextAttemptAt: scheduledAt.toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tasks.id, id),
          inArray(tasks.status, ["assigned", "running", "failed"]),
        ),
      )
      .returning();

    if (!retried) {
      throw new Error(
        "Task tidak ditemukan atau tidak dapat dijadwalkan ulang",
      );
    }

    // Lepas agent yang sebelumnya mengerjakan task ini.
    if (task.assignedAgentId) {
      await db
        .update(agents)
        .set({
          status: "idle",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agents.id, task.assignedAgentId),
            eq(agents.status, "busy"),
          ),
        );
    }

    return retried;
  }
}

// Tunggu default sebelum mencoba lagi, bila provider tidak
// memberikan `retryAfterMs`.
const DEFAULT_RETRY_DELAY_MS = 60_000;

export const taskManager = new TaskManager();

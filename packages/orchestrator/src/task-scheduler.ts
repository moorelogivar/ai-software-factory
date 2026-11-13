import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../../database/src/client";
import { agents, tasks } from "../../database/src/schema";

import type {
  Agent,
  AgentRole,
  OrchestratorConfig,
  Task,
} from "../../shared/src/index";

// ========================================
// TYPES
// ========================================

export interface ScheduledTask {
  task: Task;
  agent: Agent;
}

const VALID_AGENT_ROLES: AgentRole[] = [
  "orchestrator",
  "planner",
  "architect",
  "developer",
  "reviewer",
  "tester",
  "devops",
];

// Serializes claims made through this scheduler.
const SCHEDULER_LOCK_ID = 73120261113;

// ========================================
// TASK SCHEDULER
// ========================================

export class TaskScheduler {
  constructor(
    private readonly config: OrchestratorConfig = {
      maxConcurrentAgents: 2,
      maxConcurrentAgentsPerProject: 2,
      pollingIntervalMs: 3000,
    },
  ) {
    if (
      config.maxConcurrentAgents < 1 ||
      config.maxConcurrentAgentsPerProject < 1 ||
      config.pollingIntervalMs < 100
    ) {
      throw new Error("Konfigurasi Task Scheduler tidak valid");
    }
  }

  // Claim one eligible task and reserve one agent.
  async claimNext(): Promise<ScheduledTask | null> {
    return db.transaction(async (tx) => {
      // Prevent concurrent scheduler instances from exceeding limits.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${SCHEDULER_LOCK_ID}::bigint)`,
      );

      const now = new Date();

      // Count globally active tasks.
      const [globalCount] = await tx
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(tasks)
        .where(
          inArray(tasks.status, ["assigned", "running"]),
        );

      if (
        (globalCount?.count ?? 0) >=
        this.config.maxConcurrentAgents
      ) {
        return null;
      }

      // Find eligible queued tasks in priority order.
      const candidates = await tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.status, "queued"),
            // Batasi ke satu project bila scheduler dijalankan
            // untuk project tertentu.
            this.config.projectId
              ? eq(tasks.projectId, this.config.projectId)
              : undefined,
            or(
              isNull(tasks.scheduledAt),
              lte(tasks.scheduledAt, now),
            ),
          ),
        )
        .orderBy(
          sql`CASE ${tasks.priority}
            WHEN 'urgent' THEN 0
            WHEN 'high' THEN 1
            WHEN 'normal' THEN 2
            WHEN 'low' THEN 3
            ELSE 4
          END`,
          asc(tasks.createdAt),
        )
        .limit(50)
        .for("update", { skipLocked: true });

      for (const candidate of candidates) {
        // Enforce the per-project concurrency limit.
        const [projectCount] = await tx
          .select({
            count: sql<number>`count(*)::int`,
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.projectId, candidate.projectId),
              inArray(tasks.status, ["assigned", "running"]),
            ),
          );

        if (
          (projectCount?.count ?? 0) >=
          this.config.maxConcurrentAgentsPerProject
        ) {
          continue;
        }

        // Read the optional required agent role.
        const input = candidate.input as Record<
          string,
          unknown
        >;

        const rawRole = input?.requiredRole;

        let requiredRole: AgentRole | undefined;

        if (rawRole !== undefined) {
          if (
            typeof rawRole !== "string" ||
            !VALID_AGENT_ROLES.includes(rawRole as AgentRole)
          ) {
            throw new Error(
              `requiredRole tidak valid pada task ${candidate.id}`,
            );
          }

          requiredRole = rawRole as AgentRole;
        }

        // Lock one available agent.
        const [agent] = await tx
          .select()
          .from(agents)
          .where(
            requiredRole
              ? and(
                  eq(agents.status, "idle"),
                  eq(agents.role, requiredRole),
                )
              : eq(agents.status, "idle"),
          )
          .orderBy(asc(agents.createdAt))
          .limit(1)
          .for("update", { skipLocked: true });

        if (!agent) {
          continue;
        }

        // Reserve the agent.
        const [reservedAgent] = await tx
          .update(agents)
          .set({
            status: "busy",
            updatedAt: now,
          })
          .where(
            and(
              eq(agents.id, agent.id),
              eq(agents.status, "idle"),
            ),
          )
          .returning();

        if (!reservedAgent) {
          continue;
        }

        // Assign the task.
        const [assignedTask] = await tx
          .update(tasks)
          .set({
            status: "assigned",
            assignedAgentId: reservedAgent.id,
            updatedAt: now,
          })
          .where(
            and(
              eq(tasks.id, candidate.id),
              eq(tasks.status, "queued"),
            ),
          )
          .returning();

        if (!assignedTask) {
          throw new Error(
            `Gagal mengklaim task ${candidate.id}`,
          );
        }

        return {
          task: assignedTask,
          agent: reservedAgent,
        };
      }

      return null;
    });
  }

  // Dispatch tasks until no more capacity is available.
  async dispatchAvailable(
    maxDispatches = this.config.maxConcurrentAgents,
  ): Promise<ScheduledTask[]> {
    const dispatched: ScheduledTask[] = [];

    while (dispatched.length < maxDispatches) {
      const assignment = await this.claimNext();

      if (!assignment) {
        break;
      }

      dispatched.push(assignment);
    }

    return dispatched;
  }

  // Get current scheduler capacity.
  async getCapacity(): Promise<{
    active: number;
    available: number;
    maximum: number;
  }> {
    const [result] = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .where(
        inArray(tasks.status, ["assigned", "running"]),
      );

    const active = result?.count ?? 0;

    return {
      active,
      available: Math.max(
        0,
        this.config.maxConcurrentAgents - active,
      ),
      maximum: this.config.maxConcurrentAgents,
    };
  }
}

export const taskScheduler = new TaskScheduler();

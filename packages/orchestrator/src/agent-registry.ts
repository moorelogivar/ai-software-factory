import { and, eq, asc } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../database/src/client";
import { agents } from "../../database/src/schema";

import type {
  Agent,
  AgentRegistration,
  AgentRole,
} from "../../shared/src/index";

// ========================================
// VALIDATION
// ========================================

const agentRegistrationSchema = z.object({
  name: z.string().min(2).max(120),
  role: z.enum([
    "orchestrator",
    "planner",
    "architect",
    "developer",
    "reviewer",
    "tester",
    "devops",
  ]),
  provider: z.string().min(1).max(80),
  model: z.string().min(1).max(150),
  systemPrompt: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

// ========================================
// AGENT REGISTRY
// ========================================

export class AgentRegistry {
  async register(input: AgentRegistration): Promise<Agent> {
    const validated = agentRegistrationSchema.parse(input);

    const [agent] = await db
      .insert(agents)
      .values({
        ...validated,
        status: "idle",
      })
      .returning();

    if (!agent) {
      throw new Error("Gagal mendaftarkan agent");
    }

    return agent;
  }

  async getById(id: string): Promise<Agent | undefined> {
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, id))
      .limit(1);

    return agent;
  }

  async list(): Promise<Agent[]> {
    return db
      .select()
      .from(agents)
      .orderBy(asc(agents.createdAt));
  }

  async listByRole(role: AgentRole): Promise<Agent[]> {
    return db
      .select()
      .from(agents)
      .where(eq(agents.role, role))
      .orderBy(asc(agents.createdAt));
  }

  async listAvailable(role?: AgentRole): Promise<Agent[]> {
    const conditions = role
      ? and(eq(agents.status, "idle"), eq(agents.role, role))
      : eq(agents.status, "idle");

    return db
      .select()
      .from(agents)
      .where(conditions)
      .orderBy(asc(agents.createdAt));
  }

  async updateStatus(
    id: string,
    status: "idle" | "busy" | "disabled",
  ): Promise<Agent | undefined> {
    const [agent] = await db
      .update(agents)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, id))
      .returning();

    return agent;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await db
      .delete(agents)
      .where(eq(agents.id, id))
      .returning({ id: agents.id });

    return deleted.length > 0;
  }
}

export const agentRegistry = new AgentRegistry();

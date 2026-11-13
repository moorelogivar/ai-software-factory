import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../packages/database/src/client";
import {
  agents,
  factoryProjects,
  tasks,
} from "../packages/database/src/schema";

import type {
  Agent,
  FactoryProject,
} from "../packages/shared/src/index";

// Helper untuk test integrasi terhadap PostgreSQL lokal.
// Setiap test memakai slug unik dan membersihkan data-nya sendiri.

let counter = 0;

export function uniqueSlug(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export async function createTestProject(
  overrides: Partial<{
    slug: string;
    name: string;
    repositoryPath: string;
    status: FactoryProject["status"];
  }> = {},
): Promise<FactoryProject> {
  const slug = overrides.slug ?? uniqueSlug("test-project");

  const [project] = await db
    .insert(factoryProjects)
    .values({
      slug,
      name: overrides.name ?? slug,
      repositoryPath: overrides.repositoryPath ?? slug,
      status: overrides.status ?? "active",
    })
    .returning();

  if (!project) {
    throw new Error("Gagal membuat project untuk test");
  }

  return project;
}

export async function deleteTestProject(id: string): Promise<void> {
  await db
    .delete(factoryProjects)
    .where(eq(factoryProjects.id, id));
}

export async function getIdleAgent(
  role: Agent["role"],
): Promise<Agent | undefined> {
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.role, role))
    .limit(1);

  return agent;
}

export async function resetAgentStatus(
  id: string,
  status: Agent["status"] = "idle",
): Promise<void> {
  await db
    .update(agents)
    .set({ status })
    .where(eq(agents.id, id));
}

// Jumlah task yang sedang aktif (assigned atau running) di seluruh
// database. Scheduler menerapkan batas concurrency global, jadi test
// perlu tahu angka ini agar tidak bergantung pada sisa state.
export async function countActiveTasks(): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(inArray(tasks.status, ["assigned", "running"]));

  return result?.count ?? 0;
}

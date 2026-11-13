
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";

import { db } from "../../database/src/client";
import { agents } from "../../database/src/schema";
import { AGENT_DEFINITIONS } from "./agent-config";

function buildAgentFile(
  definition: (typeof AGENT_DEFINITIONS)[number],
): string {
  const permissions = definition.permissions
    .map(
      (permission) =>
        `  - action: ${JSON.stringify(permission.action)}\n` +
        `    resource: ${JSON.stringify(permission.resource)}\n` +
        `    effect: ${permission.effect}`,
    )
    .join("\n");

  return [
    "---",
    `description: ${JSON.stringify(definition.description)}`,
    `mode: ${definition.mode}`,
    `model: ${definition.provider}/${definition.model}`,
    "permissions:",
    permissions,
    "---",
    "",
    definition.systemPrompt?.trim() ?? "",
    "",
  ].join("\n");
}

async function writeAgentFile(
  directory: string,
  name: string,
  content: string,
): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`Nama agent tidak valid: ${name}`);
  }

  const target = path.join(directory, `${name}.md`);
  const temporary = `${target}.${process.pid}.tmp`;

  await writeFile(temporary, content, {
    encoding: "utf8",
    mode: 0o600,
  });

  await rename(temporary, target);
}

export interface AgentSyncResult {
  created: number;
  updated: number;
  filesWritten: number;
  directory: string;
}

export async function syncAgents(): Promise<AgentSyncResult> {
  const directory = path.resolve(
    process.env.OPENCODE_AGENTS_DIR ??
      path.join(homedir(), ".config", "opencode", "agents"),
  );

  await mkdir(directory, { recursive: true });

  let created = 0;
  let updated = 0;

  await db.transaction(async (tx) => {
    // Serialize concurrent sync operations.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(73120261114)`,
    );

    for (const definition of AGENT_DEFINITIONS) {
      const [existing] = await tx
        .select()
        .from(agents)
        .where(eq(agents.name, definition.name))
        .limit(1);

      const values = {
        name: definition.name,
        role: definition.role,
        provider: definition.provider,
        model: definition.model,
        systemPrompt: definition.systemPrompt,
        config: {
          ...definition.config,
          description: definition.description,
          mode: definition.mode,
          permissions: definition.permissions,
          managedBy: "ai-software-factory",
        },
        updatedAt: new Date(),
      };

      if (existing) {
        await tx
          .update(agents)
          .set(values)
          .where(eq(agents.id, existing.id));

        updated++;
      } else {
        await tx.insert(agents).values({
          ...values,
          status: "idle",
        });

        created++;
      }
    }
  });

  let filesWritten = 0;

  for (const definition of AGENT_DEFINITIONS) {
    await writeAgentFile(
      directory,
      definition.name,
      buildAgentFile(definition),
    );

    filesWritten++;
  }

  return {
    created,
    updated,
    filesWritten,
    directory,
  };
}

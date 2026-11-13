import { syncAgents } from "../../../packages/orchestrator/src/agent-sync";
import { agentRegistry } from "../../../packages/orchestrator/src/agent-registry";
import { projectManager } from "../../../packages/orchestrator/src/project-manager";
import { taskManager } from "../../../packages/orchestrator/src/task-manager";
import { closeDatabase } from "../../../packages/database/src/client";
import {
  resolveProjectsRoot,
} from "../../../packages/opencode-runtime/src/project-resolver";
import { Command } from "commander";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createConnection } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const program = new Command();

type CheckResult = {
  name: string;
  status: "ONLINE" | "OFFLINE";
  detail: string;
};

async function checkPort(
  name: string,
  host: string,
  port: number,
): Promise<CheckResult> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });

    socket.setTimeout(3000);

    socket.once("connect", () => {
      socket.destroy();
      resolve({
        name,
        status: "ONLINE",
        detail: `${host}:${port} reachable`,
      });
    });

    socket.once("timeout", () => {
      socket.destroy();
      resolve({
        name,
        status: "OFFLINE",
        detail: "Connection timeout",
      });
    });

    socket.once("error", (error) => {
      socket.destroy();
      resolve({
        name,
        status: "OFFLINE",
        detail: error.message,
      });
    });
  });
}

async function checkOpenCode(): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync(
      "opencode",
      ["--version"],
      { timeout: 5000 },
    );

    return {
      name: "OpenCode",
      status: "ONLINE",
      detail: stdout.trim(),
    };
  } catch (error) {
    return {
      name: "OpenCode",
      status: "OFFLINE",
      detail: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function runStatus(): Promise<void> {
  console.log("\nAI SOFTWARE FACTORY");
  console.log("==============================");

  const results = await Promise.all([
    checkPort("PostgreSQL", "127.0.0.1", 5433),
    checkPort("Redis", "127.0.0.1", 6379),
    checkOpenCode(),
  ]);

  const nodeVersion = process.version;

  console.log(
    `\n${"Node.js".padEnd(14)} ONLINE    ${nodeVersion}`,
  );

  for (const result of results) {
    const label = result.status.padEnd(9);
    console.log(
      `${result.name.padEnd(14)} ${label} ${result.detail}`,
    );
  }

  const online = results.filter(
    (result) => result.status === "ONLINE",
  ).length;

  console.log("\n==============================");
  console.log(`Services available: ${online}/${results.length}`);
  console.log("==============================\n");

  if (online !== results.length) {
    process.exitCode = 1;
  }
}

program
  .name("factory")
  .description("Autonomous AI Software Factory CLI")
  .version("0.1.0");

program
  .command("status")
  .description("Check AI Factory environment")
  .action(runStatus);


const agentsCommand = program
  .command("agents")
  .description("Manage AI Software Factory agents");

agentsCommand
  .command("sync")
  .description("Synchronize agents with database and OpenCode")
  .action(async () => {
    const result = await syncAgents();

    console.log("\nAGENT SYNCHRONIZATION");
    console.log("==============================");
    console.log(`Created       : ${result.created}`);
    console.log(`Updated       : ${result.updated}`);
    console.log(`Files written : ${result.filesWritten}`);
    console.log(`Directory     : ${result.directory}`);
    console.log("==============================\n");
  });

agentsCommand
  .command("list")
  .description("List registered agents")
  .action(async () => {
    const agents = await agentRegistry.list();

    console.log("\nREGISTERED AGENTS");
    console.log("==============================");

    if (agents.length === 0) {
      console.log("Belum ada agent terdaftar.");
    }

    for (const agent of agents) {
      console.log(
        `${agent.name.padEnd(12)} ${agent.role.padEnd(12)} ` +
        `${agent.provider}/${agent.model} [${agent.status}]`,
      );
    }

    console.log("==============================\n");
  });

// ========================================
// PROJECT
// ========================================

const slugSchema = z
  .string()
  .min(1)
  .max(150)
  .regex(
    /^[a-z0-9][a-z0-9-_]*$/,
    "Slug hanya boleh huruf kecil, angka, tanda hubung, dan underscore",
  );

const projectCommand = program
  .command("project")
  .description("Manage projects handled by AI Software Factory");

projectCommand
  .command("create")
  .description("Register a new project")
  .argument("<slug>", "Unique project slug")
  .option("-n, --name <name>", "Project name")
  .option("-d, --description <description>", "Project description")
  .option("-p, --path <path>", "Path relative to the projects folder")
  .option("-u, --url <url>", "Repository URL")
  .option("-b, --branch <branch>", "Default branch", "main")
  .action(async (slug: string, options: {
    name?: string;
    description?: string;
    path?: string;
    url?: string;
    branch: string;
  }) => {
    const validatedSlug = slugSchema.parse(slug);

    const existing = await projectManager.getBySlug(validatedSlug);

    if (existing) {
      throw new Error(`Project sudah terdaftar: ${validatedSlug}`);
    }

    const repositoryPath = options.path ?? validatedSlug;

    if (path.isAbsolute(repositoryPath)) {
      throw new Error(
        "Path project harus relatif terhadap folder projects",
      );
    }

    const absolutePath = path.resolve(
      resolveProjectsRoot(),
      repositoryPath,
    );

    const relative = path.relative(
      resolveProjectsRoot(),
      absolutePath,
    );

    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        "Path project harus berada di dalam folder projects",
      );
    }

    await mkdir(absolutePath, { recursive: true });

    const project = await projectManager.create({
      slug: validatedSlug,
      name: options.name ?? validatedSlug,
      description: options.description,
      repositoryPath,
      repositoryUrl: options.url,
      defaultBranch: options.branch,
    });

    console.log("\nPROJECT CREATED");
    console.log("==============================");
    console.log(`ID        : ${project.id}`);
    console.log(`Slug      : ${project.slug}`);
    console.log(`Name      : ${project.name}`);
    console.log(`Path      : ${absolutePath}`);
    console.log(`Status    : ${project.status}`);
    console.log("==============================\n");
  });

projectCommand
  .command("list")
  .description("List registered projects")
  .action(async () => {
    const projects = await projectManager.list();

    console.log("\nPROJECTS");
    console.log("==============================");

    if (projects.length === 0) {
      console.log("Belum ada project terdaftar.");
    }

    for (const project of projects) {
      console.log(
        `${project.slug.padEnd(20)} ${project.status.padEnd(10)} ` +
        `${project.repositoryPath ?? "-"}`,
      );
    }

    console.log("==============================\n");
  });

// ========================================
// TASK
// ========================================

const AGENT_ROLES = [
  "planner",
  "architect",
  "developer",
  "reviewer",
  "tester",
  "devops",
] as const;

const taskPrioritySchema = z.enum([
  "low",
  "normal",
  "high",
  "urgent",
]);

const taskStatusSchema = z.enum([
  "backlog",
  "queued",
  "assigned",
  "running",
  "review",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);

const taskCommand = program
  .command("task")
  .description("Manage AI Software Factory tasks");

taskCommand
  .command("add")
  .description("Create a task for a project")
  .argument("<project>", "Project slug")
  .requiredOption("-t, --title <title>", "Task title")
  .requiredOption(
    "-r, --role <role>",
    `Agent role: ${AGENT_ROLES.join(", ")}`,
  )
  .option("-d, --description <description>", "Task description")
  .option("-p, --priority <priority>", "low|normal|high|urgent")
  .option("--backlog", "Keep task in backlog instead of queueing it")
  .action(async (
    projectSlug: string,
    options: {
      title: string;
      role: string;
      description?: string;
      priority?: string;
      backlog?: boolean;
    },
  ) => {
    const project = await projectManager.requireBySlug(projectSlug);

    const role = z.enum(AGENT_ROLES).parse(options.role);

    const priority = taskPrioritySchema.parse(
      options.priority ?? "normal",
    );

    const task = await taskManager.create({
      projectId: project.id,
      title: options.title,
      description: options.description,
      priority,
      input: {
        requiredRole: role,
      },
    });

    const queued = options.backlog ? task : await taskManager.enqueue(task.id);

    console.log("\nTASK CREATED");
    console.log("==============================");
    console.log(`ID        : ${queued.id}`);
    console.log(`Project   : ${project.slug}`);
    console.log(`Title     : ${queued.title}`);
    console.log(`Role      : ${role}`);
    console.log(`Priority  : ${queued.priority}`);
    console.log(`Status    : ${queued.status}`);
    console.log("==============================\n");
  });

taskCommand
  .command("list")
  .description("List tasks of a project")
  .argument("<project>", "Project slug")
  .option("-s, --status <status>", "Filter by task status")
  .action(async (
    projectSlug: string,
    options: { status?: string },
  ) => {
    const project = await projectManager.requireBySlug(projectSlug);

    const status = options.status
      ? taskStatusSchema.parse(options.status)
      : undefined;

    const tasks = await taskManager.listByProject(project.id, status);

    console.log("\nTASKS");
    console.log("==============================");

    if (tasks.length === 0) {
      console.log("Belum ada task untuk project ini.");
    }

    for (const task of tasks) {
      console.log(
        `${task.id.slice(0, 8)} ${task.status.padEnd(10)} ` +
        `${task.priority.padEnd(9)} ${task.title}`,
      );
    }

    console.log("==============================\n");
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error: unknown) {
    console.error("CLI error:", error);
    process.exitCode = 1;
  } finally {
    // Tutup pool PostgreSQL agar proses tidak menggantung sampai idle timeout.
    await closeDatabase();
  }
}

void main();

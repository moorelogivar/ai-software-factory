import { syncAgents } from "../../../packages/orchestrator/src/agent-sync";
import { agentRegistry } from "../../../packages/orchestrator/src/agent-registry";
import { Command } from "commander";
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


program.parseAsync(process.argv).catch((error: unknown) => {
  console.error("CLI error:", error);
  process.exitCode = 1;
});

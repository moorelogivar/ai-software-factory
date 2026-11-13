import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDatabase, db } from "../packages/database/src/client";
import { tasks } from "../packages/database/src/schema";
import { taskManager } from "../packages/orchestrator/src/task-manager";

import {
  createTestProject,
  deleteTestProject,
  getIdleAgent,
  resetAgentStatus,
} from "./helpers";

describe("TaskManager", () => {
  const projectIds: string[] = [];
  const touchedAgentIds: string[] = [];

  // Setiap test memakai project sendiri supaya task yang tertinggal
  // di status 'assigned' tidak mengganggu test lain.
  async function newProject(slug: string): Promise<string> {
    const project = await createTestProject({ slug });
    projectIds.push(project.id);
    return project.id;
  }

  afterEach(async () => {
    for (const agentId of touchedAgentIds) {
      await resetAgentStatus(agentId);
    }

    touchedAgentIds.length = 0;

    for (const id of projectIds) {
      await deleteTestProject(id);
    }

    projectIds.length = 0;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("membuat task baru dengan status backlog", async () => {
    const projectId = await newProject("tm-backlog");

    const task = await taskManager.create({
      projectId,
      title: "Task baru",
    });

    expect(task.status).toBe("backlog");
    expect(task.title).toBe("Task baru");
  });

  it("enqueue hanya berlaku pada task berstatus backlog", async () => {
    const projectId = await newProject("tm-enqueue");

    const task = await taskManager.create({
      projectId,
      title: "Task untuk di-enqueue",
    });

    const queued = await taskManager.enqueue(task.id);

    expect(queued.status).toBe("queued");

    await expect(taskManager.enqueue(task.id)).rejects.toThrow(
      /backlog/,
    );
  });

  it("assign me-reserve agent dan memindahkan task ke assigned", async () => {
    const projectId = await newProject("tm-assign");

    const agent = await getIdleAgent("planner");

    if (!agent) {
      throw new Error("Agent planner tidak ditemukan");
    }

    touchedAgentIds.push(agent.id);

    const task = await taskManager.create({
      projectId,
      title: "Task untuk di-assign",
    });

    await taskManager.enqueue(task.id);

    const assigned = await taskManager.assign(task.id, agent.id);

    expect(assigned.status).toBe("assigned");
    expect(assigned.assignedAgentId).toBe(agent.id);

    const busyAgent = await getIdleAgent("planner");

    expect(busyAgent?.status).toBe("busy");
  });

  it("assign ditolak bila agent tidak tersedia", async () => {
    const projectId = await newProject("tm-assign-gagal");

    const task = await taskManager.create({
      projectId,
      title: "Task tanpa agent",
    });

    await taskManager.enqueue(task.id);

    await expect(
      taskManager.assign(task.id, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(/tidak ditemukan|tidak tersedia/);
  });

  it("complete menandai task selesai dan melepas agent ke idle", async () => {
    const projectId = await newProject("tm-complete");

    const agent = await getIdleAgent("reviewer");

    if (!agent) {
      throw new Error("Agent reviewer tidak ditemukan");
    }

    touchedAgentIds.push(agent.id);

    const task = await taskManager.create({
      projectId,
      title: "Task untuk selesai",
    });

    await taskManager.enqueue(task.id);
    await taskManager.assign(task.id, agent.id);
    await taskManager.start(task.id);

    const completed = await taskManager.complete(task.id, {
      success: true,
      output: { text: "selesai" },
    });

    expect(completed.status).toBe("completed");
    expect(completed.result).toMatchObject({ text: "selesai" });

    const released = await getIdleAgent("reviewer");

    expect(released?.status).toBe("idle");
  });

  it("fail menandai task gagal dan melepas agent ke idle", async () => {
    const projectId = await newProject("tm-fail");

    const agent = await getIdleAgent("tester");

    if (!agent) {
      throw new Error("Agent tester tidak ditemukan");
    }

    touchedAgentIds.push(agent.id);

    const task = await taskManager.create({
      projectId,
      title: "Task untuk gagal",
    });

    await taskManager.enqueue(task.id);
    await taskManager.assign(task.id, agent.id);
    await taskManager.start(task.id);

    const failed = await taskManager.fail(task.id, "boom");

    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(1);

    const released = await getIdleAgent("tester");

    expect(released?.status).toBe("idle");
  });

  it("complete ditolak bila result.success bernilai false", async () => {
    const projectId = await newProject("tm-complete-invalid");

    const task = await taskManager.create({
      projectId,
      title: "Task salah",
    });

    await expect(
      taskManager.complete(task.id, { success: false }),
    ).rejects.toThrow(/fail\(\)/);
  });

  it("start hanya berlaku pada task berstatus assigned", async () => {
    const projectId = await newProject("tm-start");

    const task = await taskManager.create({
      projectId,
      title: "Task tanpa assign",
    });

    await expect(taskManager.start(task.id)).rejects.toThrow(
      /di-assign/,
    );
  });

  it("retry mengembalikan task ke antrean dengan jadwal tunggu", async () => {
    const projectId = await newProject("tm-retry");

    const agent = await getIdleAgent("tester");

    if (!agent) {
      throw new Error("Agent tester tidak ditemukan");
    }

    touchedAgentIds.push(agent.id);

    const task = await taskManager.create({
      projectId,
      title: "Task untuk di-retry",
    });

    await taskManager.enqueue(task.id);
    await taskManager.assign(task.id, agent.id);
    await taskManager.start(task.id);

    const retried = await taskManager.retry(task.id, "rate limit", 5000);

    expect(retried.status).toBe("queued");
    expect(retried.attempts).toBe(1);
    expect(retried.assignedAgentId).toBeNull();

    // scheduledAt di masa depan.
    expect(retried.scheduledAt).toBeInstanceOf(Date);
    expect(retried.scheduledAt!.getTime()).toBeGreaterThan(
      Date.now() - 1000,
    );

    // Agent dilepas supaya bisa mengerjakan task lain.
    const released = await getIdleAgent("tester");

    expect(released?.status).toBe("idle");

    // Status backlog task masih terbaca lewat listByProject.
    const queued = await taskManager.listByProject(projectId, "queued");

    expect(queued).toHaveLength(1);
    expect(queued[0]?.title).toBe("Task untuk di-retry");
  });

  it("retry berhenti dan menandai failed bila percobaan habis", async () => {
    const projectId = await newProject("tm-retry-habis");

    const agent = await getIdleAgent("reviewer");

    if (!agent) {
      throw new Error("Agent reviewer tidak ditemukan");
    }

    touchedAgentIds.push(agent.id);

    const [task] = await db
      .insert(tasks)
      .values({
        projectId,
        title: "Task tanpa sisa percobaan",
        status: "running",
        attempts: 2,
        maxAttempts: 3,
        assignedAgentId: agent.id,
      })
      .returning();

    if (!task) {
      throw new Error("Gagal membuat task untuk test");
    }

    const result = await taskManager.retry(task.id, "masih gagal", 1000);

    expect(result.status).toBe("failed");
    expect(result.attempts).toBe(3);

    const released = await getIdleAgent("reviewer");

    expect(released?.status).toBe("idle");
  });

  it("retry ditolak pada task yang tidak sedang aktif", async () => {
    const projectId = await newProject("tm-retry-invalid");

    const task = await taskManager.create({
      projectId,
      title: "Task backlog",
    });

    await expect(
      taskManager.retry(task.id, "coba"),
    ).rejects.toThrow(/tidak dapat dijadwalkan ulang/);
  });

  it("listByProject memfilter berdasarkan status", async () => {
    const projectId = await newProject("tm-list");

    await taskManager.create({
      projectId,
      title: "Task backlog",
    });

    const queuedTask = await taskManager.create({
      projectId,
      title: "Task queued",
    });

    await taskManager.enqueue(queuedTask.id);

    const backlog = await taskManager.listByProject(
      projectId,
      "backlog",
    );

    expect(backlog).toHaveLength(1);
    expect(backlog[0]?.title).toBe("Task backlog");

    const queued = await taskManager.listByProject(
      projectId,
      "queued",
    );

    expect(queued).toHaveLength(1);
    expect(queued[0]?.title).toBe("Task queued");
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase } from "../packages/database/src/client";
import { taskManager } from "../packages/orchestrator/src/task-manager";
import { TaskScheduler } from "../packages/orchestrator/src/task-scheduler";

import {
  countActiveTasks,
  createTestProject,
  deleteTestProject,
  getIdleAgent,
  resetAgentStatus,
} from "./helpers";

describe("TaskScheduler", () => {
  const projectIds: string[] = [];
  const touchedAgentIds: string[] = [];

  // Setiap test memakai project sendiri supaya task yang tertinggal
  // di status queued tidak terbawa ke test berikutnya.
  // Batas concurrency global dihitung terhadap seluruh database,
  // jadi nilai batas selalu dihitung relatif terhadap state saat ini.
  async function limitFor(extra: number): Promise<number> {
    return (await countActiveTasks()) + extra;
  }

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

    // Hapus project beserta task-nya (cascade) supaya tidak ada task
    // berstatus 'assigned' yang ikut terhitung pada batas concurrency
    // global di test berikutnya.
    for (const id of projectIds) {
      await deleteTestProject(id);
    }

    projectIds.length = 0;
  });

  afterAll(async () => {
    for (const id of projectIds) {
      await deleteTestProject(id);
    }

    await closeDatabase();
  });

  it("menolak konfigurasi tidak valid", () => {
    expect(
      () =>
        new TaskScheduler({
          maxConcurrentAgents: 0,
          maxConcurrentAgentsPerProject: 1,
          pollingIntervalMs: 1000,
        }),
    ).toThrow(/tidak valid/);

    expect(
      () =>
        new TaskScheduler({
          maxConcurrentAgents: 1,
          maxConcurrentAgentsPerProject: 1,
          pollingIntervalMs: 10,
        }),
    ).toThrow(/tidak valid/);
  });

  it("mengambil task dan me-reserve agent dengan role yang diminta", async () => {
    const projectId = await newProject("ts-role");

    const scheduler = new TaskScheduler({
      maxConcurrentAgents: await limitFor(4),
      maxConcurrentAgentsPerProject: 4,
      pollingIntervalMs: 1000,
      projectId,
    });

    const task = await taskManager.create({
      projectId,
      title: "Task untuk developer",
      input: { requiredRole: "developer" },
    });

    await taskManager.enqueue(task.id);

    const assignment = await scheduler.claimNext();

    expect(assignment).not.toBeNull();
    expect(assignment?.task.id).toBe(task.id);
    expect(assignment?.agent.role).toBe("developer");
    expect(assignment?.task.status).toBe("assigned");

    touchedAgentIds.push(assignment!.agent.id);
  });

  it("tidak mengambil task dari project lain", async () => {
    const projectId = await newProject("ts-isolated-a");
    const otherProjectId = await newProject("ts-isolated-b");

    const scheduler = new TaskScheduler({
      maxConcurrentAgents: await limitFor(4),
      maxConcurrentAgentsPerProject: 4,
      pollingIntervalMs: 1000,
      projectId,
    });

    const foreignTask = await taskManager.create({
      projectId: otherProjectId,
      title: "Task project lain",
      input: { requiredRole: "developer" },
    });

    await taskManager.enqueue(foreignTask.id);

    const assignment = await scheduler.claimNext();

    expect(assignment).toBeNull();
  });

  it("tidak mengambil agent bila role tidak tersedia", async () => {
    const projectId = await newProject("ts-no-candidate");

    const scheduler = new TaskScheduler({
      maxConcurrentAgents: await limitFor(4),
      maxConcurrentAgentsPerProject: 4,
      pollingIntervalMs: 1000,
      projectId,
    });

    const task = await taskManager.create({
      projectId,
      title: "Task tanpa kandidat",
      input: { requiredRole: "architect" },
    });

    await taskManager.enqueue(task.id);

    // Pastikan tidak ada agent architect yang tersedia.
    const architect = await getIdleAgent("architect");

    if (architect) {
      await resetAgentStatus(architect.id, "disabled");
      touchedAgentIds.push(architect.id);
    }

    const assignment = await scheduler.claimNext();

    expect(assignment).toBeNull();
  });

  it("membatasi jumlah agent yang berjalan bersamaan", async () => {
    const projectId = await newProject("ts-concurrency");

    // Batas concurrency dihitung global, jadi sesuaikan dengan task
    // aktif yang mungkin sudah ada. Ini membuat test tidak bergantung
    // pada sisa state di database.
    const activeBefore = await countActiveTasks();

    const scheduler = new TaskScheduler({
      maxConcurrentAgents: activeBefore + 1,
      maxConcurrentAgentsPerProject: 1,
      pollingIntervalMs: 1000,
      projectId,
    });

    const first = await taskManager.create({
      projectId,
      title: "Task paralel 1",
      input: { requiredRole: "planner" },
    });

    const second = await taskManager.create({
      projectId,
      title: "Task paralel 2",
      input: { requiredRole: "planner" },
    });

    await taskManager.enqueue(first.id);
    await taskManager.enqueue(second.id);

    const dispatched = await scheduler.dispatchAvailable();

    expect(dispatched).toHaveLength(1);

    // Agent ke-2 tidak boleh diambil karena batas concurrency sudah tercapai.
    const secondClaim = await scheduler.claimNext();

    expect(secondClaim).toBeNull();

    for (const assignment of dispatched) {
      touchedAgentIds.push(assignment.agent.id);
    }
  });

  it("menolak requiredRole yang tidak valid", async () => {
    const projectId = await newProject("ts-bad-role");

    const scheduler = new TaskScheduler({
      maxConcurrentAgents: await limitFor(2),
      maxConcurrentAgentsPerProject: 2,
      pollingIntervalMs: 1000,
      projectId,
    });

    const task = await taskManager.create({
      projectId,
      title: "Task role ngawur",
      input: { requiredRole: "bukan-role" },
    });

    await taskManager.enqueue(task.id);

    await expect(scheduler.claimNext()).rejects.toThrow(
      /requiredRole tidak valid/,
    );
  });

  it("getCapacity melaporkan slot yang tersedia", async () => {
    const projectId = await newProject("ts-capacity");

    const scheduler = new TaskScheduler({
      maxConcurrentAgents: await limitFor(3),
      maxConcurrentAgentsPerProject: 3,
      pollingIntervalMs: 1000,
      projectId,
    });

    const capacity = await scheduler.getCapacity();

    expect(capacity.maximum).toBe(3);
    expect(capacity.available).toBeGreaterThanOrEqual(0);
    expect(capacity.available).toBeLessThanOrEqual(3);
  });
});

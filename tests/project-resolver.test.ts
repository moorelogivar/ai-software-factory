import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase } from "../packages/database/src/client";
import {
  ProjectDirectoryResolver,
  resolveProjectsRoot,
} from "../packages/opencode-runtime/src/project-resolver";

import {
  createTestProject,
  deleteTestProject,
} from "./helpers";

const projectsRoot = resolveProjectsRoot();

// Folder di luar projectsRoot yang dipakai untuk menguji guard
// path-traversal. Dibuat sungguhan supaya guard bukan sekadar gagal
// karena folder tidak ditemukan.
const outsideDir = path.resolve(projectsRoot, "..", "vitest-outside-dir");

describe("ProjectDirectoryResolver", () => {
  let projectIds: string[] = [];

  beforeAll(async () => {
    await mkdir(path.join(projectsRoot, "resolver-ok"), {
      recursive: true,
    });

    await mkdir(outsideDir, { recursive: true });
  });

  afterAll(async () => {
    for (const id of projectIds) {
      await deleteTestProject(id);
    }

    await rm(path.join(projectsRoot, "resolver-ok"), {
      recursive: true,
      force: true,
    });

    await rm(outsideDir, { recursive: true, force: true });

    await closeDatabase();
  });

  it("resolve mengembalikan folder absolut project", async () => {
    const project = await createTestProject({
      slug: "resolver-ok",
      repositoryPath: "resolver-ok",
    });

    projectIds.push(project.id);

    const resolver = new ProjectDirectoryResolver();

    const resolved = await resolver.resolve(project.id);

    expect(resolved).toBe(
      await (await import("node:fs/promises")).realpath(
        path.join(projectsRoot, "resolver-ok"),
      ),
    );
  });

  it("menolak project yang tidak ditemukan", async () => {
    const resolver = new ProjectDirectoryResolver();

    await expect(
      resolver.resolve("00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(/tidak ditemukan/);
  });

  it("menolak project yang tidak aktif", async () => {
    const project = await createTestProject({
      slug: "resolver-inactive",
      repositoryPath: "resolver-ok",
      status: "paused",
    });

    projectIds.push(project.id);

    const resolver = new ProjectDirectoryResolver();

    await expect(resolver.resolve(project.id)).rejects.toThrow(
      /tidak aktif/,
    );
  });

  it("menolak path di luar projectsRoot", async () => {
    const project = await createTestProject({
      slug: "resolver-escape",
      repositoryPath: "../vitest-outside-dir",
    });

    projectIds.push(project.id);

    const resolver = new ProjectDirectoryResolver();

    await expect(resolver.resolve(project.id)).rejects.toThrow(
      /di luar projectsRoot ditolak/,
    );
  });

  it("menolak path absolut di luar projectsRoot", async () => {
    const project = await createTestProject({
      slug: "resolver-abs",
      repositoryPath: outsideDir,
    });

    projectIds.push(project.id);

    const resolver = new ProjectDirectoryResolver();

    await expect(resolver.resolve(project.id)).rejects.toThrow(
      /di luar projectsRoot ditolak/,
    );
  });

  it("menolak project tanpa repositoryPath", async () => {
    const project = await createTestProject({
      slug: "resolver-nopath",
    });

    projectIds.push(project.id);

    await projectManagerSetPath(project.id, null);

    const resolver = new ProjectDirectoryResolver();

    await expect(resolver.resolve(project.id)).rejects.toThrow(
      /repositoryPath belum dikonfigurasi/,
    );
  });
});

async function projectManagerSetPath(
  id: string,
  value: string | null,
): Promise<void> {
  const { db } = await import("../packages/database/src/client");
  const { factoryProjects } = await import(
    "../packages/database/src/schema"
  );
  const { eq } = await import("drizzle-orm");

  await db
    .update(factoryProjects)
    .set({ repositoryPath: value })
    .where(eq(factoryProjects.id, id));
}

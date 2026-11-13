
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db } from "../../database/src/client";
import { factoryProjects } from "../../database/src/schema";

export interface ProjectResolverConfig {
  projectsRoot?: string;
}

// Akar folder tempat seluruh project yang dikelola factory disimpan.
export function resolveProjectsRoot(): string {
  return path.resolve(
    process.env.AI_FACTORY_PROJECTS_ROOT ??
      path.join(process.cwd(), "projects"),
  );
}

export class ProjectDirectoryResolver {
  private readonly projectsRoot: string;

  constructor(config: ProjectResolverConfig = {}) {
    this.projectsRoot = path.resolve(
      config.projectsRoot ?? resolveProjectsRoot(),
    );
  }

  async resolve(projectId: string): Promise<string> {
    const [project] = await db
      .select({
        id: factoryProjects.id,
        slug: factoryProjects.slug,
        repositoryPath: factoryProjects.repositoryPath,
        status: factoryProjects.status,
      })
      .from(factoryProjects)
      .where(eq(factoryProjects.id, projectId))
      .limit(1);

    if (!project) {
      throw new Error(`Project tidak ditemukan: ${projectId}`);
    }

    if (project.status !== "active") {
      throw new Error(`Project ${project.slug} tidak aktif`);
    }

    if (!project.repositoryPath) {
      throw new Error(
        `repositoryPath belum dikonfigurasi untuk project ${project.slug}`,
      );
    }

    const root = await realpath(this.projectsRoot).catch(() => {
      throw new Error(
        `Folder projects tidak ditemukan: ${this.projectsRoot}. ` +
        `Buat folder tersebut atau set AI_FACTORY_PROJECTS_ROOT.`,
      );
    });

    const requestedPath = path.isAbsolute(project.repositoryPath)
      ? path.resolve(project.repositoryPath)
      : path.resolve(root, project.repositoryPath);

    const resolvedPath = await realpath(requestedPath);

    const relativePath = path.relative(root, resolvedPath);

    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(
        `Akses folder di luar projectsRoot ditolak: ${project.slug}`,
      );
    }

    const directoryInfo = await stat(resolvedPath);

    if (!directoryInfo.isDirectory()) {
      throw new Error(
        `Lokasi project bukan direktori: ${resolvedPath}`,
      );
    }

    return resolvedPath;
  }
}

export const projectDirectoryResolver =
  new ProjectDirectoryResolver();

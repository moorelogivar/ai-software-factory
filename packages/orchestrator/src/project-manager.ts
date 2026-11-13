import { asc, eq } from "drizzle-orm";

import { db } from "../../database/src/client";
import { factoryProjects } from "../../database/src/schema";

import type {
  CreateProjectInput,
  FactoryProject,
  ProjectStatus,
} from "../../shared/src/index";

// ========================================
// PROJECT MANAGER
// ========================================

export class ProjectManager {
  // Create a new project
  async create(input: CreateProjectInput): Promise<FactoryProject> {
    const [project] = await db
      .insert(factoryProjects)
      .values({
        ...input,
        // repositoryPath relatif terhadap projectsRoot.
        repositoryPath: input.repositoryPath ?? input.slug,
        status: input.status ?? "active",
      })
      .returning();

    if (!project) {
      throw new Error("Gagal membuat project");
    }

    return project;
  }

  // Get project by ID
  async getById(id: string): Promise<FactoryProject | undefined> {
    const [project] = await db
      .select()
      .from(factoryProjects)
      .where(eq(factoryProjects.id, id))
      .limit(1);

    return project;
  }

  // Get project by slug
  async getBySlug(slug: string): Promise<FactoryProject | undefined> {
    const [project] = await db
      .select()
      .from(factoryProjects)
      .where(eq(factoryProjects.slug, slug))
      .limit(1);

    return project;
  }

  // Get project by slug, throw if not found
  async requireBySlug(slug: string): Promise<FactoryProject> {
    const project = await this.getBySlug(slug);

    if (!project) {
      throw new Error(`Project tidak ditemukan: ${slug}`);
    }

    return project;
  }

  // List projects
  async list(status?: ProjectStatus): Promise<FactoryProject[]> {
    const condition = status
      ? eq(factoryProjects.status, status)
      : undefined;

    return db
      .select()
      .from(factoryProjects)
      .where(condition)
      .orderBy(asc(factoryProjects.createdAt));
  }

  // Update project status
  async setStatus(
    id: string,
    status: ProjectStatus,
  ): Promise<FactoryProject> {
    const [project] = await db
      .update(factoryProjects)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(factoryProjects.id, id))
      .returning();

    if (!project) {
      throw new Error(`Project tidak ditemukan: ${id}`);
    }

    return project;
  }
}

export const projectManager = new ProjectManager();

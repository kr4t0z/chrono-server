import { db, projects, type Project, type NewProject } from "../db/index.js";
import { eq, desc } from "drizzle-orm";
import type { ProjectInput } from "../types/api.js";

export class ProjectsService {
  // Get all projects
  async getProjects(): Promise<Project[]> {
    return db
      .select()
      .from(projects)
      .orderBy(desc(projects.createdAt));
  }

  // Get active projects only
  async getActiveProjects(): Promise<Project[]> {
    return db
      .select()
      .from(projects)
      .where(eq(projects.isActive, true))
      .orderBy(desc(projects.createdAt));
  }

  // Get a single project by ID
  async getProject(id: string): Promise<Project | null> {
    const result = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    return result[0] ?? null;
  }

  // Get a project by name
  async getProjectByName(name: string): Promise<Project | null> {
    const result = await db
      .select()
      .from(projects)
      .where(eq(projects.name, name))
      .limit(1);

    return result[0] ?? null;
  }

  // Create a new project
  async createProject(input: ProjectInput): Promise<Project> {
    const [created] = await db
      .insert(projects)
      .values({
        name: input.name,
        color: input.color ?? "#3B82F6",
        description: input.description,
        isActive: input.isActive ?? true,
        aiContext: input.aiContext,
        filePaths: input.filePaths,
        urlPatterns: input.urlPatterns,
        appPatterns: input.appPatterns,
        goals: input.goals,
      })
      .returning();

    return created;
  }

  // Update a project
  async updateProject(id: string, input: Partial<ProjectInput>): Promise<Project | null> {
    const [updated] = await db
      .update(projects)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();

    return updated ?? null;
  }

  // Delete a project
  async deleteProject(id: string): Promise<boolean> {
    const result = await db
      .delete(projects)
      .where(eq(projects.id, id))
      .returning({ id: projects.id });

    return result.length > 0;
  }

  // Get project contexts for AI prompt
  getProjectContexts(projectList: Project[]): string {
    if (projectList.length === 0) {
      return "No projects defined.";
    }

    return projectList
      .filter((p) => p.isActive)
      .map((project) => {
        const parts: string[] = [`### ${project.name}`];

        if (project.description) {
          parts.push(`Description: ${project.description}`);
        }

        if (project.aiContext) {
          parts.push(`Context: ${project.aiContext}`);
        }

        if (project.goals) {
          parts.push(`Goals: ${project.goals}`);
        }

        if (project.filePaths && project.filePaths.length > 0) {
          parts.push(`File paths: ${project.filePaths.join(", ")}`);
        }

        if (project.urlPatterns && project.urlPatterns.length > 0) {
          parts.push(`URL patterns: ${project.urlPatterns.join(", ")}`);
        }

        if (project.appPatterns && project.appPatterns.length > 0) {
          parts.push(`Apps: ${project.appPatterns.join(", ")}`);
        }

        return parts.join("\n");
      })
      .join("\n\n");
  }

  // Match an activity event to a project based on patterns
  matchActivityToProject(
    event: { appName: string; url?: string | null; documentPath?: string | null },
    projectList: Project[]
  ): Project | null {
    for (const project of projectList) {
      // Check app patterns
      if (project.appPatterns) {
        for (const pattern of project.appPatterns) {
          if (event.appName.toLowerCase().includes(pattern.toLowerCase())) {
            return project;
          }
        }
      }

      // Check URL patterns
      if (project.urlPatterns && event.url) {
        for (const pattern of project.urlPatterns) {
          if (event.url.toLowerCase().includes(pattern.toLowerCase())) {
            return project;
          }
        }
      }

      // Check file paths
      if (project.filePaths && event.documentPath) {
        for (const pattern of project.filePaths) {
          // Expand ~ to a check for home directory pattern
          const normalizedPattern = pattern.replace(/^~/, "");
          if (event.documentPath.includes(normalizedPattern)) {
            return project;
          }
        }
      }
    }

    return null;
  }
}

export const projectsService = new ProjectsService();

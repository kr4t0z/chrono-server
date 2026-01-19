import { Hono } from "hono";
import { projectsService } from "../services/projects.js";
import { ProjectSchema } from "../types/api.js";

const app = new Hono();

// GET /api/projects - List all projects
app.get("/projects", async (c) => {
  try {
    const activeOnly = c.req.query("active") === "true";

    const projectList = activeOnly
      ? await projectsService.getActiveProjects()
      : await projectsService.getProjects();

    return c.json({
      projects: projectList.map((project) => ({
        id: project.id,
        name: project.name,
        color: project.color,
        description: project.description,
        isActive: project.isActive,
        aiContext: project.aiContext,
        filePaths: project.filePaths ?? [],
        urlPatterns: project.urlPatterns ?? [],
        appPatterns: project.appPatterns ?? [],
        goals: project.goals,
        createdAt: project.createdAt?.toISOString(),
        updatedAt: project.updatedAt?.toISOString(),
      })),
    });
  } catch (error) {
    console.error("List projects error:", error);
    return c.json({ error: "Failed to list projects" }, 500);
  }
});

// GET /api/projects/:id - Get a single project
app.get("/projects/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const project = await projectsService.getProject(id);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    return c.json({
      id: project.id,
      name: project.name,
      color: project.color,
      description: project.description,
      isActive: project.isActive,
      aiContext: project.aiContext,
      filePaths: project.filePaths ?? [],
      urlPatterns: project.urlPatterns ?? [],
      appPatterns: project.appPatterns ?? [],
      goals: project.goals,
      createdAt: project.createdAt?.toISOString(),
      updatedAt: project.updatedAt?.toISOString(),
    });
  } catch (error) {
    console.error("Get project error:", error);
    return c.json({ error: "Failed to get project" }, 500);
  }
});

// POST /api/projects - Create a new project
app.post("/projects", async (c) => {
  try {
    const body = await c.req.json();
    const input = ProjectSchema.parse(body);

    // Check if project with same name exists
    const existing = await projectsService.getProjectByName(input.name);
    if (existing) {
      return c.json({ error: "A project with this name already exists" }, 409);
    }

    const project = await projectsService.createProject(input);

    return c.json({
      success: true,
      project: {
        id: project.id,
        name: project.name,
        color: project.color,
        description: project.description,
        isActive: project.isActive,
        aiContext: project.aiContext,
        filePaths: project.filePaths ?? [],
        urlPatterns: project.urlPatterns ?? [],
        appPatterns: project.appPatterns ?? [],
        goals: project.goals,
        createdAt: project.createdAt?.toISOString(),
        updatedAt: project.updatedAt?.toISOString(),
      },
    }, 201);
  } catch (error) {
    console.error("Create project error:", error);

    if (error instanceof Error && error.name === "ZodError") {
      return c.json({ error: "Invalid project data", details: error }, 400);
    }

    return c.json({ error: "Failed to create project" }, 500);
  }
});

// PUT /api/projects/:id - Update a project
app.put("/projects/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const input = ProjectSchema.partial().parse(body);

    // Check if project exists
    const existing = await projectsService.getProject(id);
    if (!existing) {
      return c.json({ error: "Project not found" }, 404);
    }

    // If changing name, check for conflicts
    if (input.name && input.name !== existing.name) {
      const conflict = await projectsService.getProjectByName(input.name);
      if (conflict) {
        return c.json({ error: "A project with this name already exists" }, 409);
      }
    }

    const project = await projectsService.updateProject(id, input);

    if (!project) {
      return c.json({ error: "Failed to update project" }, 500);
    }

    return c.json({
      success: true,
      project: {
        id: project.id,
        name: project.name,
        color: project.color,
        description: project.description,
        isActive: project.isActive,
        aiContext: project.aiContext,
        filePaths: project.filePaths ?? [],
        urlPatterns: project.urlPatterns ?? [],
        appPatterns: project.appPatterns ?? [],
        goals: project.goals,
        createdAt: project.createdAt?.toISOString(),
        updatedAt: project.updatedAt?.toISOString(),
      },
    });
  } catch (error) {
    console.error("Update project error:", error);

    if (error instanceof Error && error.name === "ZodError") {
      return c.json({ error: "Invalid project data", details: error }, 400);
    }

    return c.json({ error: "Failed to update project" }, 500);
  }
});

// DELETE /api/projects/:id - Delete a project
app.delete("/projects/:id", async (c) => {
  try {
    const id = c.req.param("id");

    const deleted = await projectsService.deleteProject(id);

    if (!deleted) {
      return c.json({ error: "Project not found" }, 404);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Delete project error:", error);
    return c.json({ error: "Failed to delete project" }, 500);
  }
});

export default app;

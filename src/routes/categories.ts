import { Hono } from "hono";
import { categoriesService } from "../services/categories.js";
import { z } from "zod";

const app = new Hono();

// ========== App Categories ==========

// GET /api/categories/apps - List all app categories
app.get("/categories/apps", async (c) => {
  try {
    const categories = await categoriesService.getAllAppCategories();
    return c.json({ categories, count: categories.length });
  } catch (error) {
    console.error("Get app categories error:", error);
    return c.json({ error: "Failed to fetch app categories" }, 500);
  }
});

// POST /api/categories/apps - Add/update app category
const AppCategorySchema = z.object({
  appName: z.string().min(1),
  category: z.string().min(1),
  bundleId: z.string().optional(),
});

app.post("/categories/apps", async (c) => {
  try {
    const body = await c.req.json();
    const { appName, category, bundleId } = AppCategorySchema.parse(body);

    const result = await categoriesService.upsertAppCategory(
      appName,
      category,
      bundleId,
      true
    );

    return c.json({ success: true, category: result });
  } catch (error) {
    console.error("Create app category error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid request body", details: error.errors }, 400);
    }
    return c.json({ error: "Failed to create app category" }, 500);
  }
});

// DELETE /api/categories/apps/:id - Delete app category
app.delete("/categories/apps/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const success = await categoriesService.deleteAppCategory(id);

    if (!success) {
      return c.json({ error: "Category not found" }, 404);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Delete app category error:", error);
    return c.json({ error: "Failed to delete app category" }, 500);
  }
});

// ========== Domain Categories ==========

// GET /api/categories/domains - List all domain categories
app.get("/categories/domains", async (c) => {
  try {
    const categories = await categoriesService.getAllDomainCategories();
    return c.json({ categories, count: categories.length });
  } catch (error) {
    console.error("Get domain categories error:", error);
    return c.json({ error: "Failed to fetch domain categories" }, 500);
  }
});

// POST /api/categories/domains - Add/update domain category
const DomainCategorySchema = z.object({
  domain: z.string().min(1),
  category: z.string().min(1),
  pattern: z.string().optional(),
});

app.post("/categories/domains", async (c) => {
  try {
    const body = await c.req.json();
    const { domain, category, pattern } = DomainCategorySchema.parse(body);

    const result = await categoriesService.upsertDomainCategory(
      domain,
      category,
      pattern,
      true
    );

    return c.json({ success: true, category: result });
  } catch (error) {
    console.error("Create domain category error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid request body", details: error.errors }, 400);
    }
    return c.json({ error: "Failed to create domain category" }, 500);
  }
});

// DELETE /api/categories/domains/:id - Delete domain category
app.delete("/categories/domains/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const success = await categoriesService.deleteDomainCategory(id);

    if (!success) {
      return c.json({ error: "Category not found" }, 404);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Delete domain category error:", error);
    return c.json({ error: "Failed to delete domain category" }, 500);
  }
});

// ========== Category Suggestions ==========

// GET /api/categories/suggestions - List pending AI suggestions
app.get("/categories/suggestions", async (c) => {
  try {
    const suggestions = await categoriesService.getPendingSuggestions();
    return c.json({ suggestions, count: suggestions.length });
  } catch (error) {
    console.error("Get suggestions error:", error);
    return c.json({ error: "Failed to fetch suggestions" }, 500);
  }
});

// POST /api/categories/suggestions/:id/accept - Accept a suggestion
app.post("/categories/suggestions/:id/accept", async (c) => {
  try {
    const id = c.req.param("id");
    const success = await categoriesService.acceptSuggestion(id);

    if (!success) {
      return c.json({ error: "Suggestion not found" }, 404);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Accept suggestion error:", error);
    return c.json({ error: "Failed to accept suggestion" }, 500);
  }
});

// POST /api/categories/suggestions/:id/reject - Reject a suggestion
app.post("/categories/suggestions/:id/reject", async (c) => {
  try {
    const id = c.req.param("id");
    const success = await categoriesService.rejectSuggestion(id);

    if (!success) {
      return c.json({ error: "Suggestion not found" }, 404);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Reject suggestion error:", error);
    return c.json({ error: "Failed to reject suggestion" }, 500);
  }
});

// ========== Uncategorized Items ==========

// GET /api/categories/uncategorized - Get uncategorized apps and domains
app.get("/categories/uncategorized", async (c) => {
  try {
    const limitParam = c.req.query("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    const [apps, domains] = await Promise.all([
      categoriesService.getUncategorizedApps(limit),
      categoriesService.getUncategorizedDomains(limit),
    ]);

    return c.json({
      apps,
      domains,
      totalUncategorized: apps.length + domains.length,
    });
  } catch (error) {
    console.error("Get uncategorized error:", error);
    return c.json({ error: "Failed to fetch uncategorized items" }, 500);
  }
});

// ========== Bulk Operations ==========

// POST /api/categories/bulk/apps - Bulk add app categories
const BulkAppCategoriesSchema = z.object({
  categories: z.array(AppCategorySchema).min(1).max(100),
});

app.post("/categories/bulk/apps", async (c) => {
  try {
    const body = await c.req.json();
    const { categories } = BulkAppCategoriesSchema.parse(body);

    const results = await Promise.all(
      categories.map((cat) =>
        categoriesService.upsertAppCategory(
          cat.appName,
          cat.category,
          cat.bundleId,
          true
        )
      )
    );

    return c.json({ success: true, count: results.length });
  } catch (error) {
    console.error("Bulk create app categories error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid request body", details: error.errors }, 400);
    }
    return c.json({ error: "Failed to bulk create app categories" }, 500);
  }
});

// POST /api/categories/bulk/domains - Bulk add domain categories
const BulkDomainCategoriesSchema = z.object({
  categories: z.array(DomainCategorySchema).min(1).max(100),
});

app.post("/categories/bulk/domains", async (c) => {
  try {
    const body = await c.req.json();
    const { categories } = BulkDomainCategoriesSchema.parse(body);

    const results = await Promise.all(
      categories.map((cat) =>
        categoriesService.upsertDomainCategory(
          cat.domain,
          cat.category,
          cat.pattern,
          true
        )
      )
    );

    return c.json({ success: true, count: results.length });
  } catch (error) {
    console.error("Bulk create domain categories error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid request body", details: error.errors }, 400);
    }
    return c.json({ error: "Failed to bulk create domain categories" }, 500);
  }
});

export default app;

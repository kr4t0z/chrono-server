import { Hono } from "hono";
import { insightsService } from "../services/insights.js";
import {
  InsightQuerySchema,
  GenerateInsightsSchema,
  InsightStatusUpdateSchema,
  AIModelSchema,
} from "../types/api.js";
import type { InsightType, AIModel } from "../db/schema.js";

const app = new Hono();

// GET /api/insights - Get insights (cached or fresh)
app.get("/insights", async (c) => {
  try {
    const deviceId = c.req.query("deviceId");

    if (!deviceId) {
      return c.json({ error: "deviceId is required" }, 400);
    }

    // Parse query params
    const typeParam = c.req.query("type") ?? "daily";
    const scope = c.req.query("scope");
    const modelParam = c.req.query("model");
    const forceRefresh = c.req.query("forceRefresh") === "true";

    // Validate type
    const validTypes = ["daily", "weekly", "project"];
    if (!validTypes.includes(typeParam)) {
      return c.json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` }, 400);
    }

    // Validate model if provided
    let model: AIModel | undefined;
    if (modelParam) {
      const parsed = AIModelSchema.safeParse(modelParam);
      if (!parsed.success) {
        return c.json({ error: "Invalid model. Must be one of: claude-3-5-haiku, claude-3-5-sonnet, gpt-4o-mini, gpt-4o" }, 400);
      }
      model = parsed.data;
    }

    const response = await insightsService.getInsights(
      deviceId,
      typeParam as InsightType,
      scope,
      model,
      forceRefresh
    );

    return c.json(response);
  } catch (error) {
    console.error("Get insights error:", error);

    if (error instanceof Error && error.message.includes("Rate limited")) {
      return c.json({ error: error.message }, 429);
    }

    if (error instanceof Error && error.message.includes("No AI provider")) {
      return c.json({ error: error.message }, 503);
    }

    return c.json({
      error: "Failed to get insights",
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// POST /api/insights/generate - Force generate new insights
app.post("/insights/generate", async (c) => {
  try {
    const deviceId = c.req.query("deviceId");

    if (!deviceId) {
      return c.json({ error: "deviceId is required" }, 400);
    }

    const body = await c.req.json();
    const input = GenerateInsightsSchema.parse(body);

    const response = await insightsService.getInsights(
      deviceId,
      input.type,
      input.scope,
      input.model,
      true // Force refresh
    );

    return c.json(response);
  } catch (error) {
    console.error("Generate insights error:", error);

    if (error instanceof Error && error.message.includes("Rate limited")) {
      return c.json({ error: error.message }, 429);
    }

    if (error instanceof Error && error.message.includes("No AI provider")) {
      return c.json({ error: error.message }, 503);
    }

    if (error instanceof Error && error.name === "ZodError") {
      return c.json({ error: "Invalid request data", details: error }, 400);
    }

    return c.json({ error: "Failed to generate insights" }, 500);
  }
});

// PATCH /api/insights/:id - Mark insight as read/dismissed
app.patch("/insights/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const update = InsightStatusUpdateSchema.parse(body);

    const insight = await insightsService.updateInsightStatus(id, update);

    if (!insight) {
      return c.json({ error: "Insight not found" }, 404);
    }

    return c.json({
      success: true,
      insight: {
        id: insight.id,
        isRead: insight.isRead,
        isDismissed: insight.isDismissed,
      },
    });
  } catch (error) {
    console.error("Update insight error:", error);

    if (error instanceof Error && error.name === "ZodError") {
      return c.json({ error: "Invalid update data", details: error }, 400);
    }

    return c.json({ error: "Failed to update insight" }, 500);
  }
});

// GET /api/insights/usage - Get AI usage stats
app.get("/insights/usage", async (c) => {
  try {
    const deviceId = c.req.query("deviceId");

    if (!deviceId) {
      return c.json({ error: "deviceId is required" }, 400);
    }

    const stats = await insightsService.getUsageStats(deviceId);

    return c.json(stats);
  } catch (error) {
    console.error("Get usage stats error:", error);
    return c.json({ error: "Failed to get usage stats" }, 500);
  }
});

export default app;

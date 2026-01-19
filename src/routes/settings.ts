import { Hono } from "hono";
import { userSettingsService } from "../services/userSettings.js";
import { UserSettingsSchema } from "../types/api.js";

const app = new Hono();

// GET /api/settings - Get user settings
app.get("/settings", async (c) => {
  try {
    const deviceId = c.req.query("deviceId");

    if (!deviceId) {
      return c.json({ error: "deviceId is required" }, 400);
    }

    const settings = await userSettingsService.getSettings(deviceId);

    if (!settings) {
      return c.json({
        deviceId,
        displayName: null,
        timezone: "UTC",
        workDescription: null,
        productivityGoals: null,
        distractionApps: [],
        insightFrequency: "daily",
        preferredModel: "claude-3-5-haiku",
      });
    }

    return c.json({
      deviceId: settings.deviceId,
      displayName: settings.displayName,
      timezone: settings.timezone,
      workDescription: settings.workDescription,
      productivityGoals: settings.productivityGoals,
      distractionApps: settings.distractionApps ?? [],
      insightFrequency: settings.insightFrequency,
      preferredModel: settings.preferredModel,
    });
  } catch (error) {
    console.error("Get settings error:", error);
    return c.json({ error: "Failed to fetch settings" }, 500);
  }
});

// PUT /api/settings - Update user settings
app.put("/settings", async (c) => {
  try {
    const deviceId = c.req.query("deviceId");

    if (!deviceId) {
      return c.json({ error: "deviceId is required" }, 400);
    }

    const body = await c.req.json();
    const input = UserSettingsSchema.parse(body);

    const settings = await userSettingsService.upsertSettings(deviceId, input);

    return c.json({
      success: true,
      settings: {
        deviceId: settings.deviceId,
        displayName: settings.displayName,
        timezone: settings.timezone,
        workDescription: settings.workDescription,
        productivityGoals: settings.productivityGoals,
        distractionApps: settings.distractionApps ?? [],
        insightFrequency: settings.insightFrequency,
        preferredModel: settings.preferredModel,
      },
    });
  } catch (error) {
    console.error("Update settings error:", error);

    if (error instanceof Error && error.name === "ZodError") {
      return c.json({ error: "Invalid settings data", details: error }, 400);
    }

    return c.json({ error: "Failed to update settings" }, 500);
  }
});

export default app;

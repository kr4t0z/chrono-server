import { Hono } from "hono";
import { eventsService } from "../services/events.js";
import { sessionsService } from "../services/sessions.js";
import { SyncRequestSchema, StatsQuerySchema } from "../types/api.js";
import { queueSessionAggregation } from "../jobs/queues.js";
import { db, dailySessions } from "../db/index.js";
import { eq, and } from "drizzle-orm";

const app = new Hono();

// POST /api/sync - Receive events from macOS agent
app.post("/sync", async (c) => {
  try {
    const body = await c.req.json();
    const request = SyncRequestSchema.parse(body);

    const count = await eventsService.ingestEvents(request);

    // Queue session aggregation for affected dates
    const affectedDates = getUniqueDates(request.events);
    const jobsQueued: string[] = [];

    for (const date of affectedDates) {
      try {
        const jobId = await queueSessionAggregation(request.deviceId, date, {
          delay: 30000, // Wait 30s for more events before processing
        });
        if (jobId) {
          jobsQueued.push(jobId);
        }
      } catch (err) {
        // Log but don't fail sync if job queue fails
        console.error(`Failed to queue session aggregation for ${date}:`, err);
      }
    }

    return c.json({
      success: true,
      eventsReceived: count,
      serverTimestamp: new Date().toISOString(),
      jobsQueued: jobsQueued.length,
    });
  } catch (error) {
    console.error("Sync error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      400
    );
  }
});

// Helper to extract unique dates from events
function getUniqueDates(events: { timestamp: string }[]): string[] {
  const dates = new Set<string>();
  for (const event of events) {
    const date = event.timestamp.split("T")[0];
    dates.add(date);
  }
  return Array.from(dates);
}

// GET /api/events - Get raw events
app.get("/events", async (c) => {
  try {
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const deviceId = c.req.query("deviceId");

    if (!startDate || !endDate) {
      return c.json({ error: "startDate and endDate are required" }, 400);
    }

    const events = await eventsService.getEvents(
      new Date(startDate),
      new Date(endDate),
      deviceId
    );

    return c.json({ events, count: events.length });
  } catch (error) {
    console.error("Get events error:", error);
    return c.json({ error: "Failed to fetch events" }, 500);
  }
});

// GET /api/stats/apps - Get stats grouped by app
app.get("/stats/apps", async (c) => {
  try {
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const deviceId = c.req.query("deviceId");

    if (!startDate || !endDate) {
      return c.json({ error: "startDate and endDate are required" }, 400);
    }

    const stats = await eventsService.getStatsByApp(
      new Date(startDate),
      new Date(endDate),
      deviceId
    );

    return c.json({ stats });
  } catch (error) {
    console.error("Get stats error:", error);
    return c.json({ error: "Failed to fetch stats" }, 500);
  }
});

// GET /api/stats/hourly - Get stats grouped by hour
app.get("/stats/hourly", async (c) => {
  try {
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const deviceId = c.req.query("deviceId");

    if (!startDate || !endDate) {
      return c.json({ error: "startDate and endDate are required" }, 400);
    }

    const stats = await eventsService.getStatsByHour(
      new Date(startDate),
      new Date(endDate),
      deviceId
    );

    return c.json({ stats });
  } catch (error) {
    console.error("Get hourly stats error:", error);
    return c.json({ error: "Failed to fetch stats" }, 500);
  }
});

// GET /api/stats/daily/:date - Get daily overview
app.get("/stats/daily/:date", async (c) => {
  try {
    const dateStr = c.req.param("date");
    const deviceId = c.req.query("deviceId");

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return c.json({ error: "Invalid date format" }, 400);
    }

    const overview = await eventsService.getDailyOverview(date, deviceId);

    return c.json(overview);
  } catch (error) {
    console.error("Get daily overview error:", error);
    return c.json({ error: "Failed to fetch daily overview" }, 500);
  }
});

// GET /api/stats/today - Shortcut for today's overview
app.get("/stats/today", async (c) => {
  try {
    const deviceId = c.req.query("deviceId");
    const overview = await eventsService.getDailyOverview(new Date(), deviceId);
    return c.json(overview);
  } catch (error) {
    console.error("Get today overview error:", error);
    return c.json({ error: "Failed to fetch today overview" }, 500);
  }
});

// ========== Session-Based Endpoints (for AI) ==========

// GET /api/stats/sessions/:date - Get daily sessions (AI-ready format)
// Now reads from pre-computed cache, falls back to queuing job
// Optional: startAt & endAt for time window filtering (bypasses cache)
app.get("/stats/sessions/:date", async (c) => {
  try {
    const dateStr = c.req.param("date");
    const deviceId = c.req.query("deviceId");
    const forceCompute = c.req.query("forceCompute") === "true";
    const startAtParam = c.req.query("startAt");
    const endAtParam = c.req.query("endAt");

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return c.json({ error: "Invalid date format" }, 400);
    }

    // Parse optional time window parameters
    let startAt: Date | undefined;
    let endAt: Date | undefined;

    if (startAtParam) {
      startAt = new Date(startAtParam);
      if (isNaN(startAt.getTime())) {
        return c.json({ error: "Invalid startAt format. Use ISO 8601." }, 400);
      }
    }

    if (endAtParam) {
      endAt = new Date(endAtParam);
      if (isNaN(endAt.getTime())) {
        return c.json({ error: "Invalid endAt format. Use ISO 8601." }, 400);
      }
    }

    // If time window is specified, always compute fresh (bypass cache)
    const hasTimeWindow = startAt || endAt;

    // If not forcing compute and no time window, try to get pre-computed sessions from cache
    if (!forceCompute && !hasTimeWindow && deviceId) {
      const cached = await db
        .select()
        .from(dailySessions)
        .where(and(
          eq(dailySessions.deviceId, deviceId),
          eq(dailySessions.date, dateStr)
        ))
        .limit(1);

      if (cached.length > 0) {
        const cachedData = cached[0];
        return c.json({
          date: cachedData.date,
          totalActive: cachedData.totalActive,
          totalIdle: cachedData.totalIdle,
          sessionCount: cachedData.sessionCount,
          sessions: cachedData.sessions,
          patterns: cachedData.patterns,
          byCategory: cachedData.byCategory,
          cached: true,
          computedAt: cachedData.computedAt?.toISOString(),
        });
      }

      // No cache - queue job and return pending status
      try {
        const jobId = await queueSessionAggregation(deviceId, dateStr, { delay: 0 });
        if (jobId) {
          return c.json({
            status: "computing",
            message: "Sessions are being computed. Try again in 1-2 minutes.",
            jobId,
          }, 202);
        }
      } catch (err) {
        console.error("Failed to queue session aggregation:", err);
      }
    }

    // Compute sessions (with optional time window)
    const sessions = await sessionsService.getDailySessions(date, deviceId, {
      startAt,
      endAt,
    });

    return c.json({
      ...sessions,
      cached: false,
      ...(hasTimeWindow && {
        timeWindow: {
          startAt: startAt?.toISOString(),
          endAt: endAt?.toISOString(),
        },
      }),
    });
  } catch (error) {
    console.error("Get daily sessions error:", error);
    return c.json({ error: "Failed to fetch daily sessions" }, 500);
  }
});

// GET /api/stats/sessions/today - Shortcut for today's sessions
app.get("/stats/sessions/today", async (c) => {
  try {
    const deviceId = c.req.query("deviceId");
    const sessions = await sessionsService.getDailySessions(new Date(), deviceId);
    return c.json(sessions);
  } catch (error) {
    console.error("Get today sessions error:", error);
    return c.json({ error: "Failed to fetch today sessions" }, 500);
  }
});

// GET /api/stats/sessions/range - Get sessions for date range
app.get("/stats/sessions/range", async (c) => {
  try {
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const deviceId = c.req.query("deviceId");

    if (!startDate || !endDate) {
      return c.json({ error: "startDate and endDate are required" }, 400);
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return c.json({ error: "Invalid date format" }, 400);
    }

    // Limit range to 14 days for performance
    const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff > 14) {
      return c.json({ error: "Date range cannot exceed 14 days" }, 400);
    }

    const summaries = await sessionsService.getSessionsForRange(
      start,
      end,
      deviceId
    );

    return c.json({ summaries, count: summaries.length });
  } catch (error) {
    console.error("Get sessions range error:", error);
    return c.json({ error: "Failed to fetch sessions range" }, 500);
  }
});

// GET /api/stats/weekly-patterns - Get aggregated weekly patterns
app.get("/stats/weekly-patterns", async (c) => {
  try {
    const weekStartParam = c.req.query("weekStart");
    const deviceId = c.req.query("deviceId");

    // Default to start of current week (Monday)
    let weekStart: Date;
    if (weekStartParam) {
      weekStart = new Date(weekStartParam);
      if (isNaN(weekStart.getTime())) {
        return c.json({ error: "Invalid weekStart date" }, 400);
      }
    } else {
      weekStart = new Date();
      const day = weekStart.getDay();
      const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
      weekStart.setDate(diff);
      weekStart.setHours(0, 0, 0, 0);
    }

    const patterns = await sessionsService.getWeeklyPatterns(weekStart, deviceId);

    return c.json({
      weekStart: weekStart.toISOString().split("T")[0],
      ...patterns,
    });
  } catch (error) {
    console.error("Get weekly patterns error:", error);
    return c.json({ error: "Failed to fetch weekly patterns" }, 500);
  }
});

export default app;

/**
 * Job Management Routes
 *
 * Endpoints for monitoring and managing background jobs.
 */
import { Hono } from "hono";
import { getQueueStats, getFailedJobs, forceSessionAggregation, sessionQueue } from "../jobs/queues.js";
import { z } from "zod";

const app = new Hono();

// GET /api/jobs/status - Get overall queue status
app.get("/status", async (c) => {
  try {
    const stats = await getQueueStats();
    return c.json({
      status: "ok",
      queues: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to get queue status:", error);
    return c.json({
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

// GET /api/jobs/failed - Get recent failed jobs
app.get("/failed", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "10");
    const failed = await getFailedJobs(Math.min(limit, 50));
    return c.json({
      failed,
      count: failed.length,
    });
  } catch (error) {
    console.error("Failed to get failed jobs:", error);
    return c.json({ error: "Failed to fetch failed jobs" }, 500);
  }
});

// POST /api/jobs/sessions/trigger - Manually trigger session aggregation
const TriggerSessionSchema = z.object({
  deviceId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD format
});

app.post("/sessions/trigger", async (c) => {
  try {
    const body = await c.req.json();
    const { deviceId, date } = TriggerSessionSchema.parse(body);

    const jobId = await forceSessionAggregation(deviceId, date);

    if (!jobId) {
      return c.json({
        success: false,
        error: "Failed to queue job",
      }, 500);
    }

    return c.json({
      success: true,
      jobId,
      message: `Session aggregation queued for ${deviceId} on ${date}`,
    });
  } catch (error) {
    console.error("Failed to trigger session aggregation:", error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }, 400);
  }
});

// GET /api/jobs/sessions/:jobId - Get status of a specific job
app.get("/sessions/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const job = await sessionQueue.getJob(jobId);

    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }

    const state = await job.getState();

    return c.json({
      id: job.id,
      name: job.name,
      data: job.data,
      state,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
      returnvalue: job.returnvalue,
    });
  } catch (error) {
    console.error("Failed to get job status:", error);
    return c.json({ error: "Failed to fetch job status" }, 500);
  }
});

// DELETE /api/jobs/sessions/:jobId - Remove a job
app.delete("/sessions/:jobId", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const job = await sessionQueue.getJob(jobId);

    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }

    await job.remove();

    return c.json({
      success: true,
      message: `Job ${jobId} removed`,
    });
  } catch (error) {
    console.error("Failed to remove job:", error);
    return c.json({ error: "Failed to remove job" }, 500);
  }
});

// POST /api/jobs/sessions/:jobId/retry - Retry a failed job
app.post("/sessions/:jobId/retry", async (c) => {
  try {
    const jobId = c.req.param("jobId");
    const job = await sessionQueue.getJob(jobId);

    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }

    const state = await job.getState();
    if (state !== "failed") {
      return c.json({ error: "Can only retry failed jobs" }, 400);
    }

    await job.retry();

    return c.json({
      success: true,
      message: `Job ${jobId} queued for retry`,
    });
  } catch (error) {
    console.error("Failed to retry job:", error);
    return c.json({ error: "Failed to retry job" }, 500);
  }
});

// POST /api/jobs/clean - Clean old jobs
app.post("/clean", async (c) => {
  try {
    const gracePeriod = 24 * 3600 * 1000; // 24 hours in ms
    const limit = 1000;

    const [completedCount, failedCount] = await Promise.all([
      sessionQueue.clean(gracePeriod, limit, "completed"),
      sessionQueue.clean(7 * 24 * 3600 * 1000, limit, "failed"), // 7 days for failed
    ]);

    return c.json({
      success: true,
      cleaned: {
        completed: completedCount.length,
        failed: failedCount.length,
      },
    });
  } catch (error) {
    console.error("Failed to clean jobs:", error);
    return c.json({ error: "Failed to clean jobs" }, 500);
  }
});

export default app;

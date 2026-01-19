/**
 * Session Aggregation Worker
 *
 * Processes session aggregation jobs from the queue.
 * Computes daily sessions from raw events and stores them in the database.
 */
import { Worker, Job } from "bullmq";
import { redisConnection } from "../redis.js";
import { sessionsService } from "../../services/sessions.js";
import { db, dailySessions } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
import type { AggregateSessionsPayload, AggregateSessionsResult } from "../types.js";

/**
 * Session aggregation worker
 * - Computes daily sessions from raw events
 * - Stores results in daily_sessions table
 * - Upserts to handle recomputation
 */
const sessionWorker = new Worker<AggregateSessionsPayload, AggregateSessionsResult>(
  "sessions",
  async (job: Job<AggregateSessionsPayload>) => {
    const { deviceId, date } = job.data;

    console.log(`[SessionWorker] Processing job ${job.id}: ${deviceId} / ${date}`);

    try {
      // Compute sessions using existing service
      const dateObj = new Date(date);
      const result = await sessionsService.getDailySessions(dateObj, deviceId);

      // Upsert into database
      const existing = await db
        .select({ id: dailySessions.id })
        .from(dailySessions)
        .where(and(
          eq(dailySessions.deviceId, deviceId),
          eq(dailySessions.date, date)
        ))
        .limit(1);

      if (existing.length > 0) {
        // Update existing record
        await db
          .update(dailySessions)
          .set({
            totalActive: result.totalActive,
            totalIdle: result.totalIdle,
            sessionCount: result.sessionCount,
            sessions: result.sessions,
            patterns: result.patterns,
            byCategory: result.byCategory,
            computedAt: new Date(),
            jobId: job.id ?? null,
          })
          .where(eq(dailySessions.id, existing[0].id));
      } else {
        // Insert new record
        await db.insert(dailySessions).values({
          deviceId,
          date,
          totalActive: result.totalActive,
          totalIdle: result.totalIdle,
          sessionCount: result.sessionCount,
          sessions: result.sessions,
          patterns: result.patterns,
          byCategory: result.byCategory,
          jobId: job.id ?? null,
        });
      }

      console.log(`[SessionWorker] Completed job ${job.id}: ${result.sessionCount} sessions computed`);

      return {
        date,
        deviceId,
        sessionsComputed: result.sessionCount,
        totalActive: result.totalActive,
        totalIdle: result.totalIdle,
        computedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`[SessionWorker] Job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 2, // Process 2 jobs at a time
    limiter: {
      max: 10,
      duration: 60000, // 10 jobs per minute max
    },
  }
);

// Event handlers for monitoring
sessionWorker.on("completed", (job, result) => {
  console.log(`[SessionWorker] Job ${job.id} completed:`, result);
});

sessionWorker.on("failed", (job, error) => {
  console.error(`[SessionWorker] Job ${job?.id} failed:`, error.message);
});

sessionWorker.on("error", (error) => {
  console.error("[SessionWorker] Worker error:", error);
});

export default sessionWorker;

/**
 * BullMQ queue definitions for background job processing
 */
import { Queue } from "bullmq";
import { redisConnection } from "./redis.js";
import type { AggregateSessionsPayload, WeeklySummaryPayload, AggregateUncategorizedPayload } from "./types.js";

// ========== Queue Definitions ==========

/**
 * Queue for session aggregation jobs
 * - Triggered after event sync
 * - Computes and stores daily sessions
 */
export const sessionQueue = new Queue<AggregateSessionsPayload, unknown, "aggregate-sessions">("sessions", {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { age: 24 * 3600, count: 1000 }, // Keep for 24h or 1000 jobs
    removeOnFail: { age: 7 * 24 * 3600, count: 500 },  // Keep failed for 7 days
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  },
});

/**
 * Queue for scheduled/periodic jobs
 * - Weekly summaries
 * - Uncategorized domain ranking
 */
export const scheduledQueue = new Queue<WeeklySummaryPayload | AggregateUncategorizedPayload>("scheduled", {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { age: 7 * 24 * 3600, count: 100 },
    removeOnFail: { age: 14 * 24 * 3600, count: 50 },
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 60000,
    },
  },
});

// ========== Queue Helpers ==========

/**
 * Queue a session aggregation job with deduplication
 * Jobs are deduplicated by deviceId + date, with a delay to batch events
 */
export async function queueSessionAggregation(
  deviceId: string,
  date: string,
  options?: {
    delay?: number;
    priority?: number;
  }
): Promise<string | null> {
  const jobId = `sessions-${deviceId}-${date}`;
  const { delay = 30000, priority = 0 } = options || {};

  // Check if job already exists
  const existingJob = await sessionQueue.getJob(jobId);
  if (existingJob) {
    // Job already queued, skip
    return null;
  }

  const job = await sessionQueue.add(
    "aggregate-sessions",
    { deviceId, date },
    {
      jobId,
      delay,
      priority,
    }
  );

  return job.id ?? null;
}

/**
 * Force immediate session aggregation (no deduplication)
 */
export async function forceSessionAggregation(
  deviceId: string,
  date: string
): Promise<string | null> {
  const jobId = `sessions-${deviceId}-${date}-${Date.now()}`;

  const job = await sessionQueue.add(
    "aggregate-sessions",
    { deviceId, date },
    {
      jobId,
      priority: 10, // Higher priority
    }
  );

  return job.id ?? null;
}

/**
 * Get queue stats for monitoring
 */
export async function getQueueStats() {
  const [sessionStats, scheduledStats] = await Promise.all([
    {
      waiting: await sessionQueue.getWaitingCount(),
      active: await sessionQueue.getActiveCount(),
      completed: await sessionQueue.getCompletedCount(),
      failed: await sessionQueue.getFailedCount(),
      delayed: await sessionQueue.getDelayedCount(),
    },
    {
      waiting: await scheduledQueue.getWaitingCount(),
      active: await scheduledQueue.getActiveCount(),
      completed: await scheduledQueue.getCompletedCount(),
      failed: await scheduledQueue.getFailedCount(),
      delayed: await scheduledQueue.getDelayedCount(),
    },
  ]);

  return {
    sessions: sessionStats,
    scheduled: scheduledStats,
  };
}

/**
 * Get recent failed jobs for debugging
 */
export async function getFailedJobs(limit = 10) {
  const failed = await sessionQueue.getFailed(0, limit - 1);
  return failed.map((job) => ({
    id: job.id,
    name: job.name,
    data: job.data,
    failedReason: job.failedReason,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
  }));
}

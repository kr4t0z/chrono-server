/**
 * Job type definitions for BullMQ background jobs
 */
import type { ActivitySession, SessionPatterns } from "../types/api.js";

// ========== Job Types ==========

export type JobType =
  | "aggregate-sessions"      // Compute sessions for a date
  | "aggregate-uncategorized" // AI-categorize top uncategorized domains
  | "weekly-summary";         // Generate weekly AI summary

// ========== Job Payloads ==========

export interface AggregateSessionsPayload {
  deviceId: string;
  date: string; // YYYY-MM-DD format
}

export interface AggregateUncategorizedPayload {
  deviceId: string;
  limit?: number; // Number of top items to categorize
}

export interface WeeklySummaryPayload {
  deviceId: string;
  weekStart: string; // YYYY-MM-DD format
}

// ========== Job Results ==========

export interface AggregateSessionsResult {
  date: string;
  deviceId: string;
  sessionsComputed: number;
  totalActive: number;
  totalIdle: number;
  computedAt: string;
}

// ========== Stored Session Data ==========

export interface StoredDailySession {
  id: string;
  deviceId: string;
  date: string;
  totalActive: number;
  totalIdle: number;
  sessionCount: number;
  sessions: ActivitySession[];
  patterns: SessionPatterns;
  byCategory: Record<string, { duration: number; sessions: number }>;
  computedAt: Date;
  jobId: string | null;
}

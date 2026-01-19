/**
 * Session Aggregation Service
 *
 * Aggregates raw activity events into meaningful sessions for AI analysis.
 * Sessions group consecutive similar activities together, making it easier
 * for AI to detect patterns like focus sessions, idle periods, and distractions.
 */

import { db, events, type Event } from "../db/index.js";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import { sessionBoundaryService } from "./sessionBoundary.js";
import { extractContext, deduplicateContexts, extractDomain, type ExtractedContext } from "../utils/contextExtractor.js";
import { categoriesService } from "./categories.js";
import { randomUUID } from "crypto";
import type {
  ActivitySession,
  SessionPatterns,
  DailySessionSummary,
  ActivityCategory,
} from "../types/api.js";

// Valid activity categories
const VALID_CATEGORIES: Set<ActivityCategory> = new Set([
  "development",
  "design",
  "communication",
  "research",
  "distraction",
  "other",
]);

// Convert string category to typed ActivityCategory (default to "other")
function toActivityCategory(cat: string | null | undefined): ActivityCategory {
  if (cat && VALID_CATEGORIES.has(cat as ActivityCategory)) {
    return cat as ActivityCategory;
  }
  return "other";
}

export class SessionsService {
  /**
   * Get daily sessions for a given date
   * Optionally filter to a specific time window with startAt/endAt
   */
  async getDailySessions(
    date: Date,
    deviceId?: string,
    options?: {
      startAt?: Date;
      endAt?: Date;
    }
  ): Promise<DailySessionSummary> {
    // Refresh category lookups
    await sessionBoundaryService.refreshCategoryLookup();

    // Get all events for the day (or specified time window)
    const dateStr = date.toISOString().split("T")[0];
    const startOfDay = options?.startAt || new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = options?.endAt || new Date(`${dateStr}T23:59:59.999Z`);

    const conditions = [
      gte(events.timestamp, startOfDay),
      lte(events.timestamp, endOfDay),
    ];

    if (deviceId) {
      conditions.push(eq(events.deviceId, deviceId));
    }

    const rawEvents = await db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(asc(events.timestamp));

    if (rawEvents.length === 0) {
      return this.emptyDaySummary(dateStr);
    }

    // Aggregate into sessions
    const sessions = await this.aggregateToSessions(rawEvents);

    // Compute patterns
    const patterns = this.computePatterns(sessions);

    // Compute category breakdown
    const byCategory = this.computeCategoryBreakdown(sessions);

    // Compute totals
    const totalActive = sessions
      .filter((s) => s.type === "active")
      .reduce((sum, s) => sum + s.duration, 0);
    const totalIdle = sessions
      .filter((s) => s.type === "idle")
      .reduce((sum, s) => sum + s.duration, 0);

    return {
      date: dateStr,
      totalActive,
      totalIdle,
      sessionCount: sessions.length,
      sessions,
      patterns,
      byCategory,
    };
  }

  /**
   * Aggregate raw events into sessions
   */
  private async aggregateToSessions(rawEvents: Event[]): Promise<ActivitySession[]> {
    if (rawEvents.length === 0) return [];

    const sessions: ActivitySession[] = [];
    let currentSession: {
      events: Event[];
      contexts: ExtractedContext[];
      apps: Set<string>;
      contextSwitches: number;
      category: string | null;
    } | null = null;

    for (let i = 0; i < rawEvents.length; i++) {
      const event = rawEvents[i];

      // Handle idle events separately
      if (event.isIdle) {
        // Finalize any current active session
        if (currentSession && currentSession.events.length > 0) {
          sessions.push(this.finalizeSession(currentSession));
          currentSession = null;
        }

        // Create or extend idle session
        const lastSession = sessions[sessions.length - 1];
        if (lastSession && lastSession.type === "idle") {
          // Extend existing idle session
          lastSession.end = event.timestamp.toISOString();
          lastSession.duration += event.duration ?? 5;
        } else {
          // Create new idle session
          const precedingCat = lastSession?.category;
          sessions.push({
            id: randomUUID(),
            start: event.timestamp.toISOString(),
            end: new Date(
              event.timestamp.getTime() + (event.duration ?? 5) * 1000
            ).toISOString(),
            duration: event.duration ?? 5,
            type: "idle",
            precedingCategory: precedingCat,
          });
        }
        continue;
      }

      // Active event
      if (!currentSession) {
        // Start new session
        currentSession = {
          events: [event],
          contexts: [],
          apps: new Set([event.appName]),
          contextSwitches: 0,
          category: sessionBoundaryService.getCategoryForEvent(event),
        };

        const ctx = extractContext(event.appName, event.windowTitle, event.url, event.documentPath);
        if (ctx) currentSession.contexts.push(ctx);
        continue;
      }

      // Check if we should merge with current session
      const prevEvent = currentSession.events[currentSession.events.length - 1];
      const decision = await sessionBoundaryService.shouldMergeEvents(
        prevEvent,
        event
      );

      if (decision.shouldMerge && decision.confidence >= 0.7) {
        // Merge into current session
        currentSession.events.push(event);
        currentSession.apps.add(event.appName);

        const ctx = extractContext(event.appName, event.windowTitle, event.url, event.documentPath);
        if (ctx) currentSession.contexts.push(ctx);

        // Count context switch if app or domain changed
        if (prevEvent.appName !== event.appName) {
          currentSession.contextSwitches++;
        } else if (event.url && prevEvent.url) {
          const prevDomain = extractDomain(prevEvent.url);
          const currDomain = extractDomain(event.url);
          if (prevDomain !== currDomain) {
            currentSession.contextSwitches++;
          }
        }

        // Update category if we got a more specific one
        if (!currentSession.category) {
          currentSession.category = sessionBoundaryService.getCategoryForEvent(event);
        }
      } else {
        // Finalize current session and start new one
        sessions.push(this.finalizeSession(currentSession));

        currentSession = {
          events: [event],
          contexts: [],
          apps: new Set([event.appName]),
          contextSwitches: 0,
          category: sessionBoundaryService.getCategoryForEvent(event),
        };

        const ctx = extractContext(event.appName, event.windowTitle, event.url, event.documentPath);
        if (ctx) currentSession.contexts.push(ctx);
      }
    }

    // Finalize last session
    if (currentSession && currentSession.events.length > 0) {
      sessions.push(this.finalizeSession(currentSession));
    }

    return sessions;
  }

  /**
   * Finalize a session from accumulated events
   */
  private finalizeSession(session: {
    events: Event[];
    contexts: ExtractedContext[];
    apps: Set<string>;
    contextSwitches: number;
    category: string | null;
  }): ActivitySession {
    const firstEvent = session.events[0];
    const lastEvent = session.events[session.events.length - 1];

    const start = firstEvent.timestamp;
    const end = new Date(
      lastEvent.timestamp.getTime() + (lastEvent.duration ?? 5) * 1000
    );
    const duration = Math.round((end.getTime() - start.getTime()) / 1000);

    return {
      id: randomUUID(),
      start: start.toISOString(),
      end: end.toISOString(),
      duration,
      type: "active",
      category: toActivityCategory(session.category),
      apps: Array.from(session.apps),
      contexts: deduplicateContexts(session.contexts).slice(0, 10), // Limit for token efficiency
      contextSwitches: session.contextSwitches,
    };
  }

  /**
   * Compute patterns from sessions
   */
  private computePatterns(sessions: ActivitySession[]): SessionPatterns {
    const activeSessions = sessions.filter((s) => s.type === "active");
    const idleSessions = sessions.filter((s) => s.type === "idle");

    // Longest focus session (non-distraction)
    const focusSessions = activeSessions.filter(
      (s) => s.category && s.category !== "distraction"
    );
    const longestFocus = focusSessions.reduce<SessionPatterns["longestFocus"]>(
      (longest, s) => {
        if (!longest || s.duration > longest.duration) {
          return {
            category: s.category || "other",
            duration: s.duration,
            start: s.start,
          };
        }
        return longest;
      },
      null
    );

    // Idle periods with context
    const idlePeriods = idleSessions.map((s) => ({
      start: new Date(s.start).toISOString().split("T")[1].substring(0, 5),
      duration: s.duration,
      after: s.precedingCategory
        ? `${s.precedingCategory}`
        : "unknown activity",
    }));

    // Distraction blocks
    const distractionBlocks = activeSessions
      .filter((s) => s.category === "distraction")
      .map((s, idx) => {
        // Find preceding session
        const sessionIdx = sessions.indexOf(s);
        const preceding = sessionIdx > 0 ? sessions[sessionIdx - 1] : null;
        return {
          start: new Date(s.start).toISOString().split("T")[1].substring(0, 5),
          duration: s.duration,
          trigger: preceding?.category
            ? `after ${preceding.category}`
            : "start of tracking",
        };
      });

    // Context switch rate (switches per hour of active time)
    const totalActiveTime = activeSessions.reduce((sum, s) => sum + s.duration, 0);
    const totalSwitches = activeSessions.reduce(
      (sum, s) => sum + (s.contextSwitches ?? 0),
      0
    );
    const contextSwitchRate =
      totalActiveTime > 0 ? (totalSwitches / totalActiveTime) * 3600 : 0;

    // Peak productivity hour
    const hourlyProductive = new Map<number, number>();
    for (const s of activeSessions) {
      if (s.category === "distraction") continue;
      const hour = new Date(s.start).getUTCHours();
      hourlyProductive.set(hour, (hourlyProductive.get(hour) ?? 0) + s.duration);
    }

    let peakProductivityHour: number | null = null;
    let peakDuration = 0;
    for (const [hour, duration] of hourlyProductive) {
      if (duration > peakDuration) {
        peakDuration = duration;
        peakProductivityHour = hour;
      }
    }

    return {
      longestFocus,
      idlePeriods: idlePeriods.slice(0, 10), // Limit for token efficiency
      distractionBlocks: distractionBlocks.slice(0, 10),
      contextSwitchRate: Math.round(contextSwitchRate * 10) / 10,
      peakProductivityHour,
    };
  }

  /**
   * Compute category breakdown
   */
  private computeCategoryBreakdown(
    sessions: ActivitySession[]
  ): Record<string, { duration: number; sessions: number }> {
    const breakdown: Record<string, { duration: number; sessions: number }> = {};

    for (const session of sessions) {
      if (session.type === "idle") continue;

      const category = session.category ?? "other";
      if (!breakdown[category]) {
        breakdown[category] = { duration: 0, sessions: 0 };
      }
      breakdown[category].duration += session.duration;
      breakdown[category].sessions++;
    }

    return breakdown;
  }

  /**
   * Empty day summary for days with no data
   */
  private emptyDaySummary(dateStr: string): DailySessionSummary {
    return {
      date: dateStr,
      totalActive: 0,
      totalIdle: 0,
      sessionCount: 0,
      sessions: [],
      patterns: {
        longestFocus: null,
        idlePeriods: [],
        distractionBlocks: [],
        contextSwitchRate: 0,
        peakProductivityHour: null,
      },
      byCategory: {},
    };
  }

  /**
   * Get sessions for a date range (for weekly analysis)
   */
  async getSessionsForRange(
    startDate: Date,
    endDate: Date,
    deviceId?: string
  ): Promise<DailySessionSummary[]> {
    const summaries: DailySessionSummary[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      const summary = await this.getDailySessions(current, deviceId);
      summaries.push(summary);
      current.setDate(current.getDate() + 1);
    }

    return summaries;
  }

  /**
   * Get aggregated weekly patterns
   */
  async getWeeklyPatterns(
    weekStart: Date,
    deviceId?: string
  ): Promise<{
    totalActive: number;
    totalIdle: number;
    avgSessionLength: number;
    avgContextSwitchRate: number;
    categoryTotals: Record<string, number>;
    dailyPeakHours: number[];
    longestFocusSession: SessionPatterns["longestFocus"];
  }> {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const dailySummaries = await this.getSessionsForRange(
      weekStart,
      weekEnd,
      deviceId
    );

    const totalActive = dailySummaries.reduce((sum, d) => sum + d.totalActive, 0);
    const totalIdle = dailySummaries.reduce((sum, d) => sum + d.totalIdle, 0);

    const allSessions = dailySummaries.flatMap((d) => d.sessions);
    const activeSessions = allSessions.filter((s) => s.type === "active");

    const avgSessionLength =
      activeSessions.length > 0
        ? activeSessions.reduce((sum, s) => sum + s.duration, 0) / activeSessions.length
        : 0;

    const switchRates = dailySummaries
      .filter((d) => d.patterns.contextSwitchRate > 0)
      .map((d) => d.patterns.contextSwitchRate);
    const avgContextSwitchRate =
      switchRates.length > 0
        ? switchRates.reduce((sum, r) => sum + r, 0) / switchRates.length
        : 0;

    // Aggregate categories
    const categoryTotals: Record<string, number> = {};
    for (const summary of dailySummaries) {
      for (const [cat, data] of Object.entries(summary.byCategory)) {
        categoryTotals[cat] = (categoryTotals[cat] ?? 0) + data.duration;
      }
    }

    const dailyPeakHours = dailySummaries
      .map((d) => d.patterns.peakProductivityHour)
      .filter((h): h is number => h !== null);

    // Find longest focus across week
    let longestFocusSession: SessionPatterns["longestFocus"] = null;
    for (const summary of dailySummaries) {
      if (
        summary.patterns.longestFocus &&
        (!longestFocusSession ||
          summary.patterns.longestFocus.duration > longestFocusSession.duration)
      ) {
        longestFocusSession = summary.patterns.longestFocus;
      }
    }

    return {
      totalActive,
      totalIdle,
      avgSessionLength: Math.round(avgSessionLength),
      avgContextSwitchRate: Math.round(avgContextSwitchRate * 10) / 10,
      categoryTotals,
      dailyPeakHours,
      longestFocusSession,
    };
  }
}

export const sessionsService = new SessionsService();

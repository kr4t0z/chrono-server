import { db, insights, insightRequests, weeklySummaries, type Insight, type NewInsight, type InsightType, type AIModel, type WeeklySummary } from "../db/index.js";
import { eq, and, gte, desc, sql, lt } from "drizzle-orm";
import { createHash } from "crypto";
import { eventsService } from "./events.js";
import { sessionsService } from "./sessions.js";
import { userSettingsService } from "./userSettings.js";
import { projectsService } from "./projects.js";
import { aiService, type ActivityDataForAI, type SessionActivityDataForAI, type AIPromptContext } from "./ai.js";
import { observationsService, type NewObservationInput } from "./observations.js";
import type { AIModelType, InsightsResponse, AIUsageStats } from "../types/api.js";

// Cache TTL configurations (in hours)
const CACHE_TTL = {
  daily: 4,
  weekly: 24,
  project: 4,
};

// Rate limits
const RATE_LIMITS = {
  hourly: 3,
  daily: 10,
};

export class InsightsService {
  // Get insights (cached or generate new)
  async getInsights(
    deviceId: string,
    type: InsightType,
    scope?: string,
    model?: AIModelType,
    forceRefresh = false
  ): Promise<InsightsResponse> {
    // Check rate limits first
    const canGenerate = await this.canGenerateInsights(deviceId);
    if (!canGenerate.allowed && forceRefresh) {
      throw new Error(`Rate limited. ${canGenerate.message}`);
    }

    // Check cache unless force refresh
    if (!forceRefresh) {
      const cached = await this.getCachedInsights(deviceId, type, scope);
      if (cached.length > 0) {
        return {
          insights: cached.map(this.formatInsight),
          cached: true,
          nextRefreshAt: cached[0].validUntil.toISOString(),
        };
      }
    }

    // If we can't generate, return empty with message
    if (!canGenerate.allowed) {
      return {
        insights: [],
        cached: false,
        nextRefreshAt: canGenerate.nextResetAt ?? new Date().toISOString(),
      };
    }

    // Generate new insights
    if (type === "weekly") {
      return this.generateWeeklyInsights(deviceId, model);
    }

    return this.generateDailyInsights(deviceId, scope, model);
  }

  // Get cached insights
  private async getCachedInsights(
    deviceId: string,
    type: InsightType,
    scope?: string
  ): Promise<Insight[]> {
    const now = new Date();

    const conditions = [
      eq(insights.deviceId, deviceId),
      eq(insights.type, type),
      gte(insights.validUntil, now),
      eq(insights.isDismissed, false),
    ];

    if (scope) {
      conditions.push(eq(insights.scope, scope));
    }

    return db
      .select()
      .from(insights)
      .where(and(...conditions))
      .orderBy(insights.priority);
  }

  // Generate daily insights (using session-based data for richer AI context)
  private async generateDailyInsights(
    deviceId: string,
    scope?: string,
    model?: AIModelType
  ): Promise<InsightsResponse> {
    const startTime = Date.now();

    try {
      // Gather session-based activity data (richer than overview)
      const today = new Date();
      const todaySessions = await sessionsService.getDailySessions(today, deviceId);

      // Get previous days for context (also session-based)
      const previousDays = await Promise.all(
        [1, 2, 3].map(async (daysAgo) => {
          const date = new Date();
          date.setDate(date.getDate() - daysAgo);
          return sessionsService.getDailySessions(date, deviceId);
        })
      );

      // Calculate weekly average
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - 7);
      const weekStats = await eventsService.getTotalStats(weekStart, today, deviceId);
      const weeklyAverage = weekStats.totalActive / 7;

      const sessionData: SessionActivityDataForAI = {
        sessions: todaySessions,
        previousDays,
        weeklyAverage,
      };

      // Gather context
      const context = await this.buildContext(deviceId);

      // Generate insights using session-based method
      const result = await aiService.generateSessionInsights(sessionData, context, model);

      // Store insights
      const validUntil = new Date();
      validUntil.setHours(validUntil.getHours() + CACHE_TTL.daily);

      const promptHash = this.hashSessionData(todaySessions);

      const newInsights: NewInsight[] = result.data.insights.map((insight) => ({
        deviceId,
        type: "daily" as InsightType,
        scope: scope ?? today.toISOString().split("T")[0],
        validUntil,
        title: insight.title,
        content: insight.content,
        category: insight.category,
        icon: insight.icon,
        priority: insight.priority,
        promptHash,
        modelUsed: result.model,
      }));

      await db.insert(insights).values(newInsights);

      // Process new observations
      if (result.data.newObservations && result.data.newObservations.length > 0) {
        await observationsService.mergeObservations(
          deviceId,
          result.data.newObservations as NewObservationInput[]
        );
      }

      // Log the request
      await this.logRequest(deviceId, "daily", result.model, result.inputTokens, result.outputTokens, result.durationMs, "success");

      // Fetch the stored insights to return with IDs
      const storedInsights = await this.getCachedInsights(deviceId, "daily", scope ?? today.toISOString().split("T")[0]);

      return {
        insights: storedInsights.map(this.formatInsight),
        cached: false,
        nextRefreshAt: validUntil.toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      await this.logRequest(deviceId, "daily", model ?? null, 0, 0, durationMs, "error", error instanceof Error ? error.message : "Unknown error");
      throw error;
    }
  }

  // Generate weekly insights
  private async generateWeeklyInsights(
    deviceId: string,
    model?: AIModelType
  ): Promise<InsightsResponse> {
    const startTime = Date.now();

    try {
      // Get this week's data
      const today = new Date();
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - 7);

      const weeklyData = await Promise.all(
        Array.from({ length: 7 }, (_, i) => {
          const date = new Date();
          date.setDate(date.getDate() - (6 - i));
          return eventsService.getDailyOverview(date, deviceId);
        })
      );

      // Get previous week's data for comparison
      const prevWeekStart = new Date();
      prevWeekStart.setDate(prevWeekStart.getDate() - 14);

      const previousWeekData = await Promise.all(
        Array.from({ length: 7 }, (_, i) => {
          const date = new Date();
          date.setDate(date.getDate() - (13 - i));
          return eventsService.getDailyOverview(date, deviceId);
        })
      );

      // Gather context
      const context = await this.buildContext(deviceId);

      // Generate weekly summary
      const result = await aiService.generateWeeklySummary(weeklyData, previousWeekData, context, model);

      // Store weekly summary
      const weekStartStr = weekStart.toISOString().split("T")[0];
      const weekEndStr = today.toISOString().split("T")[0];

      await db.insert(weeklySummaries).values({
        deviceId,
        weekStart: weekStartStr,
        weekEnd: weekEndStr,
        summary: result.data.summary,
        highlights: result.data.highlights,
        patterns: result.data.patterns,
        recommendations: result.data.recommendations,
        projectProgress: result.data.projectProgress,
        comparisonToPrevious: result.data.comparisonToPrevious,
        modelUsed: result.model,
      });

      // Store insights
      const validUntil = new Date();
      validUntil.setHours(validUntil.getHours() + CACHE_TTL.weekly);

      const newInsights: NewInsight[] = result.data.insights.map((insight) => ({
        deviceId,
        type: "weekly" as InsightType,
        scope: `${weekStartStr}/${weekEndStr}`,
        validUntil,
        title: insight.title,
        content: insight.content,
        category: insight.category,
        icon: insight.icon,
        priority: insight.priority,
        modelUsed: result.model,
      }));

      await db.insert(insights).values(newInsights);

      // Process new observations
      if (result.data.newObservations && result.data.newObservations.length > 0) {
        await observationsService.mergeObservations(
          deviceId,
          result.data.newObservations as NewObservationInput[]
        );
      }

      // Log the request
      await this.logRequest(deviceId, "weekly", result.model, result.inputTokens, result.outputTokens, result.durationMs, "success");

      // Fetch the stored insights
      const storedInsights = await this.getCachedInsights(deviceId, "weekly", `${weekStartStr}/${weekEndStr}`);

      return {
        insights: storedInsights.map(this.formatInsight),
        cached: false,
        nextRefreshAt: validUntil.toISOString(),
        weeklyReport: {
          summary: result.data.summary,
          highlights: result.data.highlights,
          recommendations: result.data.recommendations,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      await this.logRequest(deviceId, "weekly", model ?? null, 0, 0, durationMs, "error", error instanceof Error ? error.message : "Unknown error");
      throw error;
    }
  }

  // Build context for AI
  private async buildContext(deviceId: string): Promise<AIPromptContext> {
    const [settings, projectList, observations, previousInsightsList] = await Promise.all([
      userSettingsService.getSettings(deviceId),
      projectsService.getActiveProjects(),
      observationsService.getHighConfidenceObservations(deviceId),
      this.getPreviousInsights(deviceId, 7),
    ]);

    return {
      userContext: userSettingsService.getUserContext(settings),
      projectsContext: projectsService.getProjectContexts(projectList),
      observations,
      previousInsights: previousInsightsList,
    };
  }

  // Get previous insights for context
  async getPreviousInsights(deviceId: string, days: number): Promise<Insight[]> {
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - days);

    return db
      .select()
      .from(insights)
      .where(and(
        eq(insights.deviceId, deviceId),
        gte(insights.generatedAt, daysAgo)
      ))
      .orderBy(desc(insights.generatedAt))
      .limit(20);
  }

  // Update insight status
  async updateInsightStatus(
    id: string,
    update: { isRead?: boolean; isDismissed?: boolean }
  ): Promise<Insight | null> {
    const [updated] = await db
      .update(insights)
      .set(update)
      .where(eq(insights.id, id))
      .returning();

    return updated ?? null;
  }

  // Check rate limits
  async canGenerateInsights(deviceId: string): Promise<{
    allowed: boolean;
    message?: string;
    nextResetAt?: string;
  }> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Count recent requests
    const [hourlyCount, dailyCount] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(insightRequests)
        .where(and(
          eq(insightRequests.deviceId, deviceId),
          gte(insightRequests.requestedAt, oneHourAgo),
          eq(insightRequests.status, "success")
        )),
      db
        .select({ count: sql<number>`count(*)` })
        .from(insightRequests)
        .where(and(
          eq(insightRequests.deviceId, deviceId),
          gte(insightRequests.requestedAt, oneDayAgo),
          eq(insightRequests.status, "success")
        )),
    ]);

    const hourlyUsed = Number(hourlyCount[0]?.count ?? 0);
    const dailyUsed = Number(dailyCount[0]?.count ?? 0);

    if (hourlyUsed >= RATE_LIMITS.hourly) {
      const nextReset = new Date(now.getTime() + 60 * 60 * 1000);
      return {
        allowed: false,
        message: `Hourly limit reached (${RATE_LIMITS.hourly}). Try again in an hour.`,
        nextResetAt: nextReset.toISOString(),
      };
    }

    if (dailyUsed >= RATE_LIMITS.daily) {
      const nextReset = new Date(oneDayAgo.getTime() + 24 * 60 * 60 * 1000);
      return {
        allowed: false,
        message: `Daily limit reached (${RATE_LIMITS.daily}). Try again tomorrow.`,
        nextResetAt: nextReset.toISOString(),
      };
    }

    return { allowed: true };
  }

  // Get AI usage stats
  async getUsageStats(deviceId: string): Promise<AIUsageStats> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get all requests from last 30 days
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const requests = await db
      .select()
      .from(insightRequests)
      .where(and(
        eq(insightRequests.deviceId, deviceId),
        gte(insightRequests.requestedAt, thirtyDaysAgo)
      ));

    // Count recent successful requests for rate limit status
    const hourlyUsed = requests.filter(
      (r) => r.requestedAt >= oneHourAgo && r.status === "success"
    ).length;
    const dailyUsed = requests.filter(
      (r) => r.requestedAt >= oneDayAgo && r.status === "success"
    ).length;

    // Aggregate by model
    const byModel: AIUsageStats["byModel"] = {};
    const byType: Record<string, number> = {};

    for (const req of requests) {
      // By model
      const model = req.modelUsed ?? "unknown";
      if (!byModel[model]) {
        byModel[model] = { requests: 0, inputTokens: 0, outputTokens: 0, avgDurationMs: 0 };
      }
      byModel[model].requests++;
      byModel[model].inputTokens += req.inputTokens ?? 0;
      byModel[model].outputTokens += req.outputTokens ?? 0;
      byModel[model].avgDurationMs += req.durationMs ?? 0;

      // By type
      byType[req.insightType] = (byType[req.insightType] ?? 0) + 1;
    }

    // Calculate averages
    for (const model of Object.keys(byModel)) {
      if (byModel[model].requests > 0) {
        byModel[model].avgDurationMs = Math.round(byModel[model].avgDurationMs / byModel[model].requests);
      }
    }

    // Calculate next reset times
    const nextHourlyReset = new Date(now.getTime() + 60 * 60 * 1000);
    const nextDailyReset = new Date(oneDayAgo.getTime() + 24 * 60 * 60 * 1000);

    return {
      totalRequests: requests.length,
      byModel,
      byType,
      rateLimitStatus: {
        hourlyRemaining: Math.max(0, RATE_LIMITS.hourly - hourlyUsed),
        dailyRemaining: Math.max(0, RATE_LIMITS.daily - dailyUsed),
        nextResetAt: hourlyUsed >= RATE_LIMITS.hourly
          ? nextHourlyReset.toISOString()
          : nextDailyReset.toISOString(),
      },
    };
  }

  // Log AI request for rate limiting and analytics
  private async logRequest(
    deviceId: string,
    insightType: InsightType,
    modelUsed: AIModel | null,
    inputTokens: number,
    outputTokens: number,
    durationMs: number,
    status: "success" | "error" | "rate_limited",
    errorMessage?: string
  ): Promise<void> {
    await db.insert(insightRequests).values({
      deviceId,
      insightType,
      modelUsed,
      inputTokens,
      outputTokens,
      durationMs,
      status,
      errorMessage,
    });
  }

  // Hash activity data for cache invalidation (legacy)
  private hashActivityData(data: { totalTracked: number; topApps: { appName: string }[] }): string {
    // Round total to 5 minute buckets for stability
    const roundedTotal = Math.round(data.totalTracked / 300) * 300;
    const topAppsString = data.topApps.slice(0, 3).map((a) => a.appName).join(",");
    return createHash("md5").update(`${roundedTotal}:${topAppsString}`).digest("hex");
  }

  // Hash session data for cache invalidation
  private hashSessionData(data: { totalActive: number; sessionCount: number; byCategory: Record<string, { duration: number }> }): string {
    // Round total to 5 minute buckets for stability
    const roundedTotal = Math.round(data.totalActive / 300) * 300;
    const topCategories = Object.entries(data.byCategory)
      .sort(([, a], [, b]) => b.duration - a.duration)
      .slice(0, 3)
      .map(([cat]) => cat)
      .join(",");
    return createHash("md5").update(`${roundedTotal}:${data.sessionCount}:${topCategories}`).digest("hex");
  }

  // Format insight for API response
  private formatInsight(insight: Insight) {
    return {
      id: insight.id,
      title: insight.title,
      content: insight.content,
      category: insight.category,
      icon: insight.icon,
      priority: insight.priority ?? 1,
      modelUsed: insight.modelUsed,
      generatedAt: insight.generatedAt.toISOString(),
      isRead: insight.isRead ?? false,
      isDismissed: insight.isDismissed ?? false,
    };
  }
}

export const insightsService = new InsightsService();

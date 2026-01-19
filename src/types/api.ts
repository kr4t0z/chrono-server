import { z } from "zod";

// Event from macOS agent or browser extension
export const EventSchema = z.object({
  id: z.string().uuid().optional(),
  timestamp: z.string().datetime(),
  appName: z.string(),
  windowTitle: z.string(),
  bundleIdentifier: z.string().nullable().optional(),
  documentPath: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  isIdle: z.boolean().default(false),
  duration: z.number().default(5),
});

export type EventInput = z.infer<typeof EventSchema>;

// Batch sync request from macOS agent
export const SyncRequestSchema = z.object({
  deviceId: z.string(),
  source: z.enum(["macos", "ios", "firefox-extension"]),
  events: z.array(EventSchema),
  lastSyncTimestamp: z.string().datetime().optional(),
});

export type SyncRequest = z.infer<typeof SyncRequestSchema>;

// Sync response
export interface SyncResponse {
  success: boolean;
  eventsReceived: number;
  serverTimestamp: string;
}

// Query parameters for fetching stats
export const StatsQuerySchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  deviceId: z.string().optional(),
  groupBy: z.enum(["app", "category", "project", "hour", "day"]).optional(),
});

export type StatsQuery = z.infer<typeof StatsQuerySchema>;

// Aggregated stats response
export interface AppStats {
  appName: string;
  bundleIdentifier?: string;
  category?: string;
  project?: string;
  totalDuration: number; // seconds
  eventCount: number;
  percentage: number;
}

export interface DailyOverview {
  date: string;
  totalTracked: number; // seconds
  totalIdle: number;
  topApps: AppStats[];
  byCategory: { category: string; duration: number }[];
  byHour: { hour: number; duration: number }[];
}

// Categorization rule
export const RuleSchema = z.object({
  name: z.string(),
  priority: z.number().default(0),
  conditions: z.object({
    appName: z.string().optional(),
    windowTitleContains: z.string().optional(),
    windowTitleRegex: z.string().optional(),
    urlContains: z.string().optional(),
    bundleIdentifier: z.string().optional(),
  }),
  category: z.string(),
  project: z.string().optional(),
});

export type RuleInput = z.infer<typeof RuleSchema>;

// AI Model types
export const AIModelSchema = z.enum([
  "claude-3-5-haiku",
  "claude-3-5-sonnet",
  "gpt-4o-mini",
  "gpt-4o",
]);
export type AIModelType = z.infer<typeof AIModelSchema>;

// Insight types
export const InsightCategorySchema = z.enum(["positive", "warning", "suggestion", "info"]);
export const InsightIconSchema = z.enum(["trending-up", "alert", "target", "clock", "zap", "calendar"]);
export const InsightTypeSchema = z.enum(["daily", "weekly", "project"]);

export const InsightSchema = z.object({
  title: z.string().max(50),
  content: z.string().max(300),
  category: InsightCategorySchema,
  icon: InsightIconSchema,
  priority: z.number().min(1).max(5),
});

export type InsightInput = z.infer<typeof InsightSchema>;

// AI response schema (what we expect from Claude/OpenAI)
export const AIInsightResponseSchema = z.object({
  insights: z.array(InsightSchema).min(1).max(7),
  newObservations: z.array(z.object({
    observation: z.string(),
    confidence: z.number().min(0).max(1),
    category: z.enum(["pattern", "preference", "trigger", "strength"]),
  })).optional(),
});

export type AIInsightResponse = z.infer<typeof AIInsightResponseSchema>;

// Weekly summary AI response
export const AIWeeklySummaryResponseSchema = z.object({
  summary: z.string(), // 500-1000 word narrative
  highlights: z.array(z.string()).max(5),
  patterns: z.array(z.object({
    pattern: z.string(),
    confidence: z.number().min(0).max(1),
    weeksObserved: z.number().min(1),
  })),
  recommendations: z.array(z.string()).max(5),
  projectProgress: z.record(z.string(), z.object({
    hours: z.number(),
    change: z.string(),
    status: z.string(),
  })),
  comparisonToPrevious: z.object({
    totalHours: z.object({
      this: z.number(),
      last: z.number(),
      change: z.string(),
    }),
    focusScore: z.object({
      this: z.number(),
      last: z.number(),
      change: z.string(),
    }),
    distractions: z.object({
      this: z.string(),
      last: z.string(),
      change: z.string(),
    }),
  }),
  insights: z.array(InsightSchema).min(1).max(7),
  newObservations: z.array(z.object({
    observation: z.string(),
    confidence: z.number().min(0).max(1),
    category: z.enum(["pattern", "preference", "trigger", "strength"]),
  })).optional(),
});

export type AIWeeklySummaryResponse = z.infer<typeof AIWeeklySummaryResponseSchema>;

// User settings
export const InsightFrequencySchema = z.enum(["daily", "weekly", "on-demand"]);

export const UserSettingsSchema = z.object({
  displayName: z.string().optional(),
  timezone: z.string().optional(),
  workDescription: z.string().optional(),
  productivityGoals: z.string().optional(),
  distractionApps: z.array(z.string()).optional(),
  insightFrequency: InsightFrequencySchema.optional(),
  preferredModel: AIModelSchema.optional(),
});

export type UserSettingsInput = z.infer<typeof UserSettingsSchema>;

// Project with AI context
export const ProjectSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  aiContext: z.string().optional(),
  filePaths: z.array(z.string()).optional(),
  urlPatterns: z.array(z.string()).optional(),
  appPatterns: z.array(z.string()).optional(),
  goals: z.string().optional(),
});

export type ProjectInput = z.infer<typeof ProjectSchema>;

// Insight query params
export const InsightQuerySchema = z.object({
  type: InsightTypeSchema.optional().default("daily"),
  scope: z.string().optional(),
  model: AIModelSchema.optional(),
  forceRefresh: z.coerce.boolean().optional().default(false),
});

export type InsightQuery = z.infer<typeof InsightQuerySchema>;

// Generate insights request body
export const GenerateInsightsSchema = z.object({
  type: InsightTypeSchema,
  scope: z.string().optional(),
  model: AIModelSchema.optional(),
});

export type GenerateInsightsInput = z.infer<typeof GenerateInsightsSchema>;

// Insight status update
export const InsightStatusUpdateSchema = z.object({
  isRead: z.boolean().optional(),
  isDismissed: z.boolean().optional(),
});

export type InsightStatusUpdate = z.infer<typeof InsightStatusUpdateSchema>;

// Insights response
export interface InsightsResponse {
  insights: {
    id: string;
    title: string;
    content: string;
    category: string;
    icon: string;
    priority: number;
    modelUsed: string | null;
    generatedAt: string;
    isRead: boolean;
    isDismissed: boolean;
  }[];
  cached: boolean;
  nextRefreshAt: string;
  weeklyReport?: {
    summary: string;
    highlights: string[];
    recommendations: string[];
  };
}

// AI usage stats
export interface AIUsageStats {
  totalRequests: number;
  byModel: Record<string, {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    avgDurationMs: number;
  }>;
  byType: Record<string, number>;
  rateLimitStatus: {
    hourlyRemaining: number;
    dailyRemaining: number;
    nextResetAt: string;
  };
}

// ========== Session Types (AI-Ready Data) ==========

// Activity categories
export const ActivityCategorySchema = z.enum([
  "development",
  "design",
  "communication",
  "research",
  "distraction",
  "other",
]);
export type ActivityCategory = z.infer<typeof ActivityCategorySchema>;

// Session representing a grouped activity period
export const ActivitySessionSchema = z.object({
  id: z.string(),
  start: z.string(), // ISO timestamp
  end: z.string(), // ISO timestamp
  duration: z.number(), // seconds
  type: z.enum(["active", "idle"]),
  category: ActivityCategorySchema.optional(),
  apps: z.array(z.string()).optional(),
  contexts: z.array(z.string()).optional(),
  contextSwitches: z.number().optional(),
  precedingCategory: z.string().optional(),
});
export type ActivitySession = z.infer<typeof ActivitySessionSchema>;

// Patterns extracted from sessions
export const SessionPatternsSchema = z.object({
  longestFocus: z.object({
    category: z.string(),
    duration: z.number(),
    start: z.string(),
  }).nullable(),
  idlePeriods: z.array(z.object({
    start: z.string(),
    duration: z.number(),
    after: z.string(),
  })),
  distractionBlocks: z.array(z.object({
    start: z.string(),
    duration: z.number(),
    trigger: z.string(),
  })),
  contextSwitchRate: z.number(),
  peakProductivityHour: z.number().nullable(),
});
export type SessionPatterns = z.infer<typeof SessionPatternsSchema>;

// Daily session summary
export const DailySessionSummarySchema = z.object({
  date: z.string(),
  totalActive: z.number(),
  totalIdle: z.number(),
  sessionCount: z.number(),
  sessions: z.array(ActivitySessionSchema),
  patterns: SessionPatternsSchema,
  byCategory: z.record(z.string(), z.object({
    duration: z.number(),
    sessions: z.number(),
  })),
  byProject: z.record(z.string(), z.object({
    duration: z.number(),
    sessions: z.number(),
  })).optional(),
});
export type DailySessionSummary = z.infer<typeof DailySessionSummarySchema>;

// ========== Category Management Types ==========

// App category
export const AppCategoryInputSchema = z.object({
  appName: z.string().min(1),
  category: ActivityCategorySchema,
  bundleId: z.string().optional(),
});
export type AppCategoryInput = z.infer<typeof AppCategoryInputSchema>;

// Domain category
export const DomainCategoryInputSchema = z.object({
  domain: z.string().min(1),
  category: ActivityCategorySchema,
  pattern: z.string().optional(), // e.g., "*.github.com"
});
export type DomainCategoryInput = z.infer<typeof DomainCategoryInputSchema>;

// Category suggestion (from AI)
export const CategorySuggestionSchema = z.object({
  id: z.string(),
  type: z.enum(["app", "domain"]),
  value: z.string(),
  suggestedCategory: ActivityCategorySchema,
  confidence: z.number().min(0).max(1).optional(),
  occurrenceCount: z.number(),
  status: z.enum(["pending", "accepted", "rejected"]),
});
export type CategorySuggestionResponse = z.infer<typeof CategorySuggestionSchema>;

// Uncategorized item
export interface UncategorizedItem {
  name: string;
  count: number;
}

// Categories response
export interface CategoriesResponse {
  apps: UncategorizedItem[];
  domains: UncategorizedItem[];
  totalUncategorized: number;
}

// Weekly patterns response
export interface WeeklyPatternsResponse {
  weekStart: string;
  totalActive: number;
  totalIdle: number;
  avgSessionLength: number;
  avgContextSwitchRate: number;
  categoryTotals: Record<string, number>;
  dailyPeakHours: number[];
  longestFocusSession: SessionPatterns["longestFocus"];
}

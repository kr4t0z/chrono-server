import { pgTable, uuid, timestamp, text, boolean, integer, real, jsonb, date } from "drizzle-orm/pg-core";

// Insight frequency enum values
export type InsightFrequency = "daily" | "weekly" | "on-demand";
export type InsightType = "daily" | "weekly" | "project";
export type InsightCategory = "positive" | "warning" | "suggestion" | "info";
export type InsightIcon = "trending-up" | "alert" | "target" | "clock" | "zap" | "calendar";
export type ObservationCategory = "pattern" | "preference" | "trigger" | "strength";
export type AIModel = "claude-3-5-haiku" | "claude-3-5-sonnet" | "gpt-4o-mini" | "gpt-4o";
export type RequestStatus = "success" | "error" | "rate_limited";

// Raw activity events from devices
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: text("device_id").notNull(), // Identifies the source device
  source: text("source").notNull(), // 'macos', 'ios', 'firefox-extension'
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  appName: text("app_name").notNull(),
  windowTitle: text("window_title").notNull(),
  bundleIdentifier: text("bundle_identifier"),
  documentPath: text("document_path"),
  url: text("url"),
  isIdle: boolean("is_idle").notNull().default(false),
  duration: integer("duration").default(5), // seconds
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Categorization rules
export const rules = pgTable("rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  priority: integer("priority").notNull().default(0),
  conditions: jsonb("conditions").notNull(), // JSON conditions to match
  category: text("category").notNull(),
  project: text("project"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Categories for activities
export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#6B7280"),
  icon: text("icon"),
  isProductive: boolean("is_productive").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Projects (derived from rules or manual) with AI context fields
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#3B82F6"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  // AI context fields
  aiContext: text("ai_context"), // User's description for AI
  filePaths: jsonb("file_paths").$type<string[]>(), // e.g., ["~/Apps/chrono"]
  urlPatterns: jsonb("url_patterns").$type<string[]>(), // e.g., ["github.com/user/chrono"]
  appPatterns: jsonb("app_patterns").$type<string[]>(), // e.g., ["VS Code", "Terminal"]
  goals: text("goals"), // User's goals for this project
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Daily aggregations (materialized for fast queries)
export const dailyStats = pgTable("daily_stats", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  deviceId: text("device_id").notNull(),
  appName: text("app_name").notNull(),
  category: text("category"),
  project: text("project"),
  totalDuration: integer("total_duration").notNull(), // seconds
  eventCount: integer("event_count").notNull(),
  idleDuration: integer("idle_duration").notNull().default(0),
});

// User settings for AI personalization
export const userSettings = pgTable("user_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: text("device_id").notNull().unique(),
  displayName: text("display_name"),
  timezone: text("timezone").default("UTC"),
  workDescription: text("work_description"), // e.g., "Full-stack developer working on..."
  productivityGoals: text("productivity_goals"), // e.g., "Focus more, reduce social media"
  distractionApps: jsonb("distraction_apps").$type<string[]>(), // Apps considered distractions
  insightFrequency: text("insight_frequency").$type<InsightFrequency>().default("daily"),
  preferredModel: text("preferred_model").$type<AIModel>().default("claude-3-5-haiku"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Cached AI-generated insights
export const insights = pgTable("insights", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: text("device_id").notNull(),
  type: text("type").$type<InsightType>().notNull(), // 'daily' | 'weekly' | 'project'
  scope: text("scope"), // e.g., project name for project insights, date for daily
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category").$type<InsightCategory>().notNull(),
  icon: text("icon").$type<InsightIcon>().notNull(),
  priority: integer("priority").default(1),
  promptHash: text("prompt_hash"), // For cache invalidation
  modelUsed: text("model_used").$type<AIModel>(),
  isRead: boolean("is_read").default(false),
  isDismissed: boolean("is_dismissed").default(false),
});

// Rate limiting and usage tracking for AI requests
export const insightRequests = pgTable("insight_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: text("device_id").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  insightType: text("insight_type").$type<InsightType>().notNull(),
  modelUsed: text("model_used").$type<AIModel>(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  durationMs: integer("duration_ms"),
  status: text("status").$type<RequestStatus>().notNull(),
  errorMessage: text("error_message"),
});

// AI observations - accumulated learnings about user patterns
export const aiObservations = pgTable("ai_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: text("device_id").notNull(),
  observation: text("observation").notNull(), // e.g., "User's focus drops after 2pm on Fridays"
  confidence: real("confidence").notNull().default(0.5), // 0-1 scale
  category: text("category").$type<ObservationCategory>().notNull(),
  firstObserved: timestamp("first_observed", { withTimezone: true }).notNull().defaultNow(),
  lastConfirmed: timestamp("last_confirmed", { withTimezone: true }).notNull().defaultNow(),
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
});

// App categorization (user-configurable)
export const appCategories = pgTable("app_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  appName: text("app_name").notNull(),
  bundleId: text("bundle_id"),
  category: text("category").notNull(), // "development", "distraction", "communication", "design", "other"
  isUserDefined: boolean("is_user_defined").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Domain categorization (user-configurable)
export const domainCategories = pgTable("domain_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: text("domain").notNull(),
  pattern: text("pattern"), // Optional: "*.github.com" for subdomains
  category: text("category").notNull(),
  isUserDefined: boolean("is_user_defined").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// AI-suggested categories pending user review
export const categorySuggestions = pgTable("category_suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(), // "app" or "domain"
  value: text("value").notNull(), // App name or domain
  suggestedCategory: text("suggested_category").notNull(),
  confidence: real("confidence"), // AI confidence 0-1
  occurrenceCount: integer("occurrence_count").default(1),
  status: text("status").default("pending"), // "pending", "accepted", "rejected"
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Pre-computed daily sessions (background job output)
export const dailySessions = pgTable("daily_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: text("device_id").notNull(),
  date: date("date").notNull(),

  // Summary stats
  totalActive: integer("total_active").notNull(),
  totalIdle: integer("total_idle").notNull(),
  sessionCount: integer("session_count").notNull(),

  // Full session data (JSON)
  sessions: jsonb("sessions").notNull(), // ActivitySession[]
  patterns: jsonb("patterns").notNull(), // SessionPatterns
  byCategory: jsonb("by_category").notNull(), // Record<string, { duration: number; sessions: number }>

  // Metadata
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  jobId: text("job_id"), // BullMQ job ID for debugging
});

// Rich weekly summary reports
export const weeklySummaries = pgTable("weekly_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: text("device_id").notNull(),
  weekStart: date("week_start").notNull(),
  weekEnd: date("week_end").notNull(),
  summary: text("summary").notNull(), // 500-1000 word narrative
  highlights: jsonb("highlights").$type<string[]>(), // Key achievements
  patterns: jsonb("patterns").$type<{ pattern: string; confidence: number; weeksObserved: number }[]>(),
  recommendations: jsonb("recommendations").$type<string[]>(),
  projectProgress: jsonb("project_progress").$type<Record<string, { hours: number; change: string; status: string }>>(),
  comparisonToPrevious: jsonb("comparison_to_previous").$type<{
    totalHours: { this: number; last: number; change: string };
    focusScore: { this: number; last: number; change: string };
    distractions: { this: string; last: string; change: string };
  }>(),
  modelUsed: text("model_used").$type<AIModel>(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Type exports for use in application
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Rule = typeof rules.$inferSelect;
export type NewRule = typeof rules.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type DailyStat = typeof dailyStats.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type NewUserSettings = typeof userSettings.$inferInsert;
export type Insight = typeof insights.$inferSelect;
export type NewInsight = typeof insights.$inferInsert;
export type InsightRequest = typeof insightRequests.$inferSelect;
export type NewInsightRequest = typeof insightRequests.$inferInsert;
export type AIObservation = typeof aiObservations.$inferSelect;
export type NewAIObservation = typeof aiObservations.$inferInsert;
export type WeeklySummary = typeof weeklySummaries.$inferSelect;
export type NewWeeklySummary = typeof weeklySummaries.$inferInsert;
export type AppCategory = typeof appCategories.$inferSelect;
export type NewAppCategory = typeof appCategories.$inferInsert;
export type DomainCategory = typeof domainCategories.$inferSelect;
export type NewDomainCategory = typeof domainCategories.$inferInsert;
export type CategorySuggestion = typeof categorySuggestions.$inferSelect;
export type NewCategorySuggestion = typeof categorySuggestions.$inferInsert;
export type DailySession = typeof dailySessions.$inferSelect;
export type NewDailySession = typeof dailySessions.$inferInsert;

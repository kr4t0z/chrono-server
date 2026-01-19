import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type {
  AIModelType,
  AIInsightResponse,
  AIWeeklySummaryResponse,
  DailySessionSummary,
  SessionPatterns,
} from "../types/api.js";
import {
  AIInsightResponseSchema,
  AIWeeklySummaryResponseSchema,
} from "../types/api.js";
import type { Project, AIObservation, Insight } from "../db/schema.js";

// Local type that matches what eventsService.getDailyOverview actually returns
export interface DailyActivityData {
  date: string;
  totalTracked: number;
  totalIdle: number;
  topApps: {
    appName: string;
    bundleIdentifier?: string | null;
    totalDuration: number;
    eventCount: number;
    percentage: number;
  }[];
  byHour: { hour: number; duration: number }[];
  topUrls?: {
    url: string | null;
    domain: string;
    totalDuration: number;
    eventCount: number;
  }[];
}

// Activity data structure for AI prompts
export interface ActivityDataForAI {
  daily: DailyActivityData;
  previousDays?: DailyActivityData[];
  weeklyTotal?: number;
  weeklyAverage?: number;
}

// Session-based activity data for richer AI insights
export interface SessionActivityDataForAI {
  sessions: DailySessionSummary;
  previousDays?: DailySessionSummary[];
  weeklyAverage?: number;
}

// Context for AI prompts
export interface AIPromptContext {
  userContext: string;
  projectsContext: string;
  observations: AIObservation[];
  previousInsights: Insight[];
}

// AI response with metadata
export interface AIGenerationResult<T> {
  data: T;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  model: AIModelType;
}

// Model configuration - using models available on your API key
const MODEL_CONFIG: Record<AIModelType, { provider: "anthropic" | "openai"; modelId: string; maxTokens: number }> = {
  "claude-3-5-haiku": { provider: "anthropic", modelId: "claude-3-5-haiku-20241022", maxTokens: 2048 },
  "claude-3-5-sonnet": { provider: "anthropic", modelId: "claude-sonnet-4-20250514", maxTokens: 4096 },
  "gpt-4o-mini": { provider: "openai", modelId: "gpt-4o-mini", maxTokens: 2048 },
  "gpt-4o": { provider: "openai", modelId: "gpt-4o", maxTokens: 4096 },
};

// System prompt for Chrono AI
const SYSTEM_PROMPT = `You are Chrono, a personal productivity AI assistant. You analyze time tracking data to provide personalized, actionable insights that help users understand their work patterns and improve their productivity.

Your personality:
- Insightful and data-driven, but warm and encouraging
- Focus on patterns and trends, not just raw numbers
- Celebrate wins and gently point out areas for improvement
- Reference the user's specific projects, goals, and context
- Build on previous observations to show continuity

Response format requirements:
- Return ONLY valid JSON, no markdown code blocks
- Follow the exact schema provided
- Keep titles concise (max 50 chars)
- Keep content actionable (max 300 chars for daily, longer for weekly)
- Use appropriate categories: "positive" for wins, "warning" for concerns, "suggestion" for tips, "info" for neutral observations
- Use icons meaningfully: "trending-up" for improvements, "target" for focus, "clock" for time-related, "zap" for energy/momentum, "alert" for warnings, "calendar" for scheduling`;

export class AIService {
  private anthropic: Anthropic | null = null;
  private openai: OpenAI | null = null;

  constructor() {
    // Initialize clients if API keys are available
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }

    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  // Check if a model is available
  isModelAvailable(model: AIModelType): boolean {
    const config = MODEL_CONFIG[model];
    if (config.provider === "anthropic") {
      return this.anthropic !== null;
    }
    return this.openai !== null;
  }

  // Get best available model
  getBestAvailableModel(): AIModelType | null {
    // Prefer Claude, fall back to OpenAI
    if (this.anthropic) return "claude-3-5-haiku";
    if (this.openai) return "gpt-4o-mini";
    return null;
  }

  // Build daily insights prompt
  private buildDailyInsightsPrompt(
    activityData: ActivityDataForAI,
    context: AIPromptContext
  ): string {
    const { daily, previousDays, weeklyAverage } = activityData;
    const { userContext, projectsContext, observations, previousInsights } = context;

    let prompt = `## User Profile
${userContext}

## Projects
${projectsContext}

## Today's Activity (${daily.date})
- Total tracked: ${this.formatDuration(daily.totalTracked)}
- Idle time: ${this.formatDuration(daily.totalIdle)}

### Top Apps:
${daily.topApps.slice(0, 5).map((app) => `- ${app.appName}: ${this.formatDuration(app.totalDuration)} (${app.percentage.toFixed(1)}%)`).join("\n")}

### Activity by Hour:
${daily.byHour.map((h) => `${h.hour}:00 - ${this.formatDuration(h.duration)}`).join(", ")}
`;

    if (daily.topUrls && daily.topUrls.length > 0) {
      prompt += `
### Top Websites/URLs:
${daily.topUrls.slice(0, 8).map((u) => `- ${u.domain}: ${this.formatDuration(u.totalDuration)}`).join("\n")}
`;
    }

    if (weeklyAverage) {
      const diff = daily.totalTracked - weeklyAverage;
      const diffPercent = weeklyAverage > 0 ? ((diff / weeklyAverage) * 100).toFixed(0) : "N/A";
      prompt += `\n### Context
- Weekly average: ${this.formatDuration(weeklyAverage)}
- Today vs average: ${diff >= 0 ? "+" : ""}${this.formatDuration(Math.abs(diff))} (${diffPercent}%)
`;
    }

    if (previousDays && previousDays.length > 0) {
      prompt += `\n### Recent Days:
${previousDays.slice(0, 3).map((d) => `- ${d.date}: ${this.formatDuration(d.totalTracked)}`).join("\n")}
`;
    }

    if (observations.length > 0) {
      const activeObs = observations.filter((o) => o.isActive && o.confidence >= 0.5);
      if (activeObs.length > 0) {
        prompt += `\n### Known Patterns (reference these when relevant):
${activeObs.map((o) => `- ${o.observation} (confidence: ${(o.confidence * 100).toFixed(0)}%)`).join("\n")}
`;
      }
    }

    if (previousInsights.length > 0) {
      prompt += `\n### Previous Insights (for context and continuity):
${previousInsights.slice(0, 5).map((i) => `- [${i.generatedAt.toISOString().split("T")[0]}] ${i.title}: ${i.content}`).join("\n")}
`;
    }

    prompt += `
## Task
Generate 4-5 daily productivity insights based on the data above.

Return JSON in this exact format:
{
  "insights": [
    {
      "title": "Short insight title",
      "content": "Actionable insight content",
      "category": "positive|warning|suggestion|info",
      "icon": "trending-up|alert|target|clock|zap|calendar",
      "priority": 1
    }
  ],
  "newObservations": [
    {
      "observation": "A new pattern you've detected",
      "confidence": 0.6,
      "category": "pattern|preference|trigger|strength"
    }
  ]
}

Guidelines:
- Be specific about the user's actual projects and apps
- Reference time windows (e.g., "Your focus peaked between 2-4pm")
- Compare to averages when meaningful
- If you notice a new pattern, include it in newObservations
- Priority 1 = most important`;

    return prompt;
  }

  // Build weekly summary prompt
  private buildWeeklySummaryPrompt(
    weeklyData: DailyActivityData[],
    previousWeekData: DailyActivityData[] | null,
    context: AIPromptContext
  ): string {
    const { userContext, projectsContext, observations, previousInsights } = context;

    const totalHours = weeklyData.reduce((sum, d) => sum + d.totalTracked, 0) / 3600;
    const avgPerDay = totalHours / weeklyData.length;

    let prompt = `## User Profile
${userContext}

## Projects
${projectsContext}

## This Week's Activity
Total: ${totalHours.toFixed(1)} hours over ${weeklyData.length} days
Average: ${avgPerDay.toFixed(1)} hours/day

### Daily Breakdown:
${weeklyData.map((d) => `- ${d.date}: ${this.formatDuration(d.totalTracked)}`).join("\n")}

### Top Apps This Week:
${this.aggregateTopApps(weeklyData).slice(0, 8).map((app) => `- ${app.name}: ${this.formatDuration(app.duration)} (${app.percentage.toFixed(1)}%)`).join("\n")}
`;

    if (previousWeekData && previousWeekData.length > 0) {
      const prevTotal = previousWeekData.reduce((sum, d) => sum + d.totalTracked, 0) / 3600;
      const change = ((totalHours - prevTotal) / prevTotal * 100).toFixed(0);
      prompt += `\n### Compared to Last Week:
- Last week total: ${prevTotal.toFixed(1)} hours
- Change: ${Number(change) >= 0 ? "+" : ""}${change}%
`;
    }

    if (observations.length > 0) {
      const activeObs = observations.filter((o) => o.isActive);
      if (activeObs.length > 0) {
        prompt += `\n### Accumulated Observations:
${activeObs.map((o) => `- ${o.observation} (seen ${o.occurrenceCount}x, confidence: ${(o.confidence * 100).toFixed(0)}%)`).join("\n")}
`;
      }
    }

    prompt += `
## Task
Generate a comprehensive weekly productivity report.

Return JSON in this exact format:
{
  "summary": "A 500-1000 word narrative summary of the week. Be personal, reference specific projects and patterns. Celebrate wins and gently note areas for improvement. Connect to the user's stated goals.",
  "highlights": ["Key achievement 1", "Key achievement 2", "Key achievement 3"],
  "patterns": [
    { "pattern": "Pattern description", "confidence": 0.8, "weeksObserved": 2 }
  ],
  "recommendations": ["Actionable recommendation 1", "Recommendation 2"],
  "projectProgress": {
    "ProjectName": { "hours": 10, "change": "+2h", "status": "on track" }
  },
  "comparisonToPrevious": {
    "totalHours": { "this": ${totalHours.toFixed(1)}, "last": ${previousWeekData ? (previousWeekData.reduce((s, d) => s + d.totalTracked, 0) / 3600).toFixed(1) : "0"}, "change": "${previousWeekData ? ((totalHours - previousWeekData.reduce((s, d) => s + d.totalTracked, 0) / 3600) >= 0 ? "+" : "") + ((totalHours - previousWeekData.reduce((s, d) => s + d.totalTracked, 0) / 3600) / (previousWeekData.reduce((s, d) => s + d.totalTracked, 0) / 3600) * 100).toFixed(0) + "%" : "N/A"}" },
    "focusScore": { "this": 0, "last": 0, "change": "N/A" },
    "distractions": { "this": "0h", "last": "0h", "change": "N/A" }
  },
  "insights": [
    {
      "title": "Weekly insight title",
      "content": "Detailed weekly insight",
      "category": "positive|warning|suggestion|info",
      "icon": "trending-up|alert|target|clock|zap|calendar",
      "priority": 1
    }
  ],
  "newObservations": [
    {
      "observation": "A pattern detected this week",
      "confidence": 0.7,
      "category": "pattern|preference|trigger|strength"
    }
  ]
}

Guidelines:
- The summary should be personal and narrative, not a list
- Reference specific days, times, and projects
- Acknowledge patterns from previous observations
- Be encouraging but honest about challenges
- Provide 5-7 insights for the week`;

    return prompt;
  }

  // Generate daily insights
  async generateDailyInsights(
    activityData: ActivityDataForAI,
    context: AIPromptContext,
    model?: AIModelType
  ): Promise<AIGenerationResult<AIInsightResponse>> {
    const selectedModel = model ?? this.getBestAvailableModel();
    if (!selectedModel) {
      throw new Error("No AI provider available. Configure ANTHROPIC_API_KEY or OPENAI_API_KEY.");
    }

    const prompt = this.buildDailyInsightsPrompt(activityData, context);
    const startTime = Date.now();

    const config = MODEL_CONFIG[selectedModel];
    let response: string;
    let inputTokens = 0;
    let outputTokens = 0;

    if (config.provider === "anthropic") {
      const result = await this.callAnthropic(prompt, config.modelId, config.maxTokens);
      response = result.content;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    } else {
      const result = await this.callOpenAI(prompt, config.modelId, config.maxTokens);
      response = result.content;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    }

    const durationMs = Date.now() - startTime;

    // Parse and validate response
    const parsed = this.parseJSONResponse(response);
    const validated = AIInsightResponseSchema.parse(parsed);

    return {
      data: validated,
      inputTokens,
      outputTokens,
      durationMs,
      model: selectedModel,
    };
  }

  // Generate weekly summary
  async generateWeeklySummary(
    weeklyData: DailyActivityData[],
    previousWeekData: DailyActivityData[] | null,
    context: AIPromptContext,
    model?: AIModelType
  ): Promise<AIGenerationResult<AIWeeklySummaryResponse>> {
    // Weekly summaries should use a more capable model
    const selectedModel = model ?? (this.anthropic ? "claude-3-5-sonnet" : this.openai ? "gpt-4o" : null);
    if (!selectedModel) {
      throw new Error("No AI provider available. Configure ANTHROPIC_API_KEY or OPENAI_API_KEY.");
    }

    const prompt = this.buildWeeklySummaryPrompt(weeklyData, previousWeekData, context);
    const startTime = Date.now();

    const config = MODEL_CONFIG[selectedModel];
    let response: string;
    let inputTokens = 0;
    let outputTokens = 0;

    if (config.provider === "anthropic") {
      const result = await this.callAnthropic(prompt, config.modelId, config.maxTokens);
      response = result.content;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    } else {
      const result = await this.callOpenAI(prompt, config.modelId, config.maxTokens);
      response = result.content;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    }

    const durationMs = Date.now() - startTime;

    // Parse and validate response
    const parsed = this.parseJSONResponse(response);
    const validated = AIWeeklySummaryResponseSchema.parse(parsed);

    return {
      data: validated,
      inputTokens,
      outputTokens,
      durationMs,
      model: selectedModel,
    };
  }

  // Build session-based insights prompt (richer data for AI)
  private buildSessionInsightsPrompt(
    sessionData: SessionActivityDataForAI,
    context: AIPromptContext
  ): string {
    const { sessions, previousDays, weeklyAverage } = sessionData;
    const { userContext, projectsContext, observations, previousInsights } = context;

    let prompt = `## User Profile
${userContext}

## Projects
${projectsContext}

## Today's Activity (${sessions.date}) - Session-Based Analysis
- Total active: ${this.formatDuration(sessions.totalActive)}
- Total idle: ${this.formatDuration(sessions.totalIdle)}
- Sessions: ${sessions.sessionCount}

### Focus Sessions:
${sessions.sessions
  .filter((s) => s.type === "active" && s.category !== "distraction")
  .slice(0, 8)
  .map((s) => {
    const startTime = new Date(s.start).toISOString().split("T")[1].substring(0, 5);
    const apps = s.apps?.join(", ") || "unknown";
    const contexts = s.contexts?.slice(0, 3).join("; ") || "";
    return `- ${startTime}: ${this.formatDuration(s.duration)} ${s.category || "other"} (${apps})${contexts ? ` [${contexts}]` : ""}`;
  })
  .join("\n")}

### Distraction Periods:
${sessions.sessions
  .filter((s) => s.type === "active" && s.category === "distraction")
  .slice(0, 5)
  .map((s) => {
    const startTime = new Date(s.start).toISOString().split("T")[1].substring(0, 5);
    return `- ${startTime}: ${this.formatDuration(s.duration)} (${s.apps?.join(", ") || "unknown"})`;
  })
  .join("\n") || "None detected"}

### Idle Periods:
${sessions.sessions
  .filter((s) => s.type === "idle" && s.duration > 120)
  .slice(0, 5)
  .map((s) => {
    const startTime = new Date(s.start).toISOString().split("T")[1].substring(0, 5);
    return `- ${startTime}: ${this.formatDuration(s.duration)} (after ${s.precedingCategory || "activity"})`;
  })
  .join("\n") || "No significant idle periods"}

### Category Breakdown:
${Object.entries(sessions.byCategory)
  .sort(([, a], [, b]) => b.duration - a.duration)
  .map(([cat, data]) => `- ${cat}: ${this.formatDuration(data.duration)} (${data.sessions} sessions)`)
  .join("\n")}

### Patterns Detected:
- Longest focus: ${sessions.patterns.longestFocus ? `${this.formatDuration(sessions.patterns.longestFocus.duration)} of ${sessions.patterns.longestFocus.category} starting at ${sessions.patterns.longestFocus.start.split("T")[1]?.substring(0, 5) || sessions.patterns.longestFocus.start}` : "None"}
- Context switch rate: ${sessions.patterns.contextSwitchRate.toFixed(1)} switches/hour
- Peak productivity hour: ${sessions.patterns.peakProductivityHour !== null ? `${sessions.patterns.peakProductivityHour}:00` : "N/A"}
`;

    if (sessions.patterns.distractionBlocks.length > 0) {
      prompt += `- Distraction triggers: ${sessions.patterns.distractionBlocks.slice(0, 3).map((d) => d.trigger).join(", ")}\n`;
    }

    if (weeklyAverage) {
      const diff = sessions.totalActive - weeklyAverage;
      const diffPercent = weeklyAverage > 0 ? ((diff / weeklyAverage) * 100).toFixed(0) : "N/A";
      prompt += `\n### Context
- Weekly average: ${this.formatDuration(weeklyAverage)}
- Today vs average: ${diff >= 0 ? "+" : ""}${this.formatDuration(Math.abs(diff))} (${diffPercent}%)
`;
    }

    if (previousDays && previousDays.length > 0) {
      prompt += `\n### Recent Days:
${previousDays.slice(0, 3).map((d) => {
  const focusSessions = d.sessions.filter((s) => s.type === "active" && s.category !== "distraction").length;
  return `- ${d.date}: ${this.formatDuration(d.totalActive)} (${focusSessions} focus sessions)`;
}).join("\n")}
`;
    }

    if (observations.length > 0) {
      const activeObs = observations.filter((o) => o.isActive && o.confidence >= 0.5);
      if (activeObs.length > 0) {
        prompt += `\n### Known Patterns (reference these when relevant):
${activeObs.map((o) => `- ${o.observation} (confidence: ${(o.confidence * 100).toFixed(0)}%)`).join("\n")}
`;
      }
    }

    if (previousInsights.length > 0) {
      prompt += `\n### Previous Insights (for context and continuity):
${previousInsights.slice(0, 5).map((i) => `- [${i.generatedAt.toISOString().split("T")[0]}] ${i.title}: ${i.content}`).join("\n")}
`;
    }

    prompt += `
## Task
Generate 4-5 daily productivity insights based on the SESSION data above.

With session data, you can now detect:
- Focus session quality (duration, context switches)
- Distraction patterns (what triggers them)
- Recovery patterns (idle periods after specific activities)
- Work rhythm (session lengths, peak times)

Return JSON in this exact format:
{
  "insights": [
    {
      "title": "Short insight title",
      "content": "Actionable insight content",
      "category": "positive|warning|suggestion|info",
      "icon": "trending-up|alert|target|clock|zap|calendar",
      "priority": 1
    }
  ],
  "newObservations": [
    {
      "observation": "A new pattern you've detected",
      "confidence": 0.6,
      "category": "pattern|preference|trigger|strength"
    }
  ]
}

Guidelines:
- Reference specific sessions and times (e.g., "Your 45-min focus session at 9am")
- Note distraction triggers if detected (e.g., "Distractions followed research sessions")
- Comment on context switch rate (high = fragmented, low = deep work)
- If you notice a new pattern, include it in newObservations
- Priority 1 = most important`;

    return prompt;
  }

  // Generate insights from session data (richer than overview-based)
  async generateSessionInsights(
    sessionData: SessionActivityDataForAI,
    context: AIPromptContext,
    model?: AIModelType
  ): Promise<AIGenerationResult<AIInsightResponse>> {
    const selectedModel = model ?? this.getBestAvailableModel();
    if (!selectedModel) {
      throw new Error("No AI provider available. Configure ANTHROPIC_API_KEY or OPENAI_API_KEY.");
    }

    const prompt = this.buildSessionInsightsPrompt(sessionData, context);
    const startTime = Date.now();

    const config = MODEL_CONFIG[selectedModel];
    let response: string;
    let inputTokens = 0;
    let outputTokens = 0;

    if (config.provider === "anthropic") {
      const result = await this.callAnthropic(prompt, config.modelId, config.maxTokens);
      response = result.content;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    } else {
      const result = await this.callOpenAI(prompt, config.modelId, config.maxTokens);
      response = result.content;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    }

    const durationMs = Date.now() - startTime;

    // Parse and validate response
    const parsed = this.parseJSONResponse(response);
    const validated = AIInsightResponseSchema.parse(parsed);

    return {
      data: validated,
      inputTokens,
      outputTokens,
      durationMs,
      model: selectedModel,
    };
  }

  // Call Anthropic API
  private async callAnthropic(
    prompt: string,
    modelId: string,
    maxTokens: number
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    if (!this.anthropic) {
      throw new Error("Anthropic client not initialized");
    }

    const response = await this.anthropic.messages.create({
      model: modelId,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const textContent = response.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text content in Anthropic response");
    }

    return {
      content: textContent.text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  // Call OpenAI API
  private async callOpenAI(
    prompt: string,
    modelId: string,
    maxTokens: number
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    if (!this.openai) {
      throw new Error("OpenAI client not initialized");
    }

    const response = await this.openai.chat.completions.create({
      model: modelId,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No content in OpenAI response");
    }

    return {
      content,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  }

  // Parse JSON response (handle markdown code blocks)
  private parseJSONResponse(response: string): unknown {
    // Try direct parse first
    try {
      return JSON.parse(response);
    } catch {
      // Try extracting from markdown code block
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1].trim());
      }
      throw new Error(`Failed to parse AI response as JSON: ${response.substring(0, 200)}...`);
    }
  }

  // Format duration helper
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  // Aggregate top apps across multiple days
  private aggregateTopApps(days: DailyActivityData[]): { name: string; duration: number; percentage: number }[] {
    const appMap = new Map<string, number>();
    let total = 0;

    for (const day of days) {
      for (const app of day.topApps) {
        appMap.set(app.appName, (appMap.get(app.appName) ?? 0) + app.totalDuration);
        total += app.totalDuration;
      }
    }

    return Array.from(appMap.entries())
      .map(([name, duration]) => ({
        name,
        duration,
        percentage: total > 0 ? (duration / total) * 100 : 0,
      }))
      .sort((a, b) => b.duration - a.duration);
  }
}

export const aiService = new AIService();

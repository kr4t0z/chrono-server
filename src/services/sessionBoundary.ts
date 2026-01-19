/**
 * Session Boundary Detection Service
 *
 * Determines when to split events into separate sessions based on:
 * 1. Database-driven app categories (user-configurable)
 * 2. Database-driven domain categories (user-configurable)
 * 3. AI fallback for uncategorized items (Haiku - ~$0.0001/decision)
 *
 * Conservative by default: if confidence < 0.7 or AI unavailable, split into separate sessions.
 */

import type { Event } from "../db/index.js";
import { categoriesService, type ActivityCategory } from "./categories.js";
import { aiService } from "./ai.js";
import { extractDomain, areUrlsRelated } from "../utils/contextExtractor.js";

// Types for boundary detection
export interface BoundaryDecision {
  shouldMerge: boolean;
  confidence: number;
  reason: string;
  suggestedCategory?: ActivityCategory;
}

// Cache for category lookups (refreshed on each session aggregation)
interface CategoryLookup {
  apps: Map<string, string>;
  bundles: Map<string, string>;
  domains: Map<string, string>;
  domainPatterns: { pattern: string; category: string }[];
}

// Cache for AI decisions (same transitions repeat)
const aiDecisionCache = new Map<string, BoundaryDecision>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Apps that naturally cluster together (same work context)
const RELATED_APP_GROUPS: string[][] = [
  // Development: IDE + Terminal + API testing
  ["Visual Studio Code", "Code", "Cursor", "Xcode", "IntelliJ IDEA", "WebStorm", "PyCharm"],
  ["Ghostty", "Terminal", "iTerm2", "Alacritty", "Hyper", "Warp", "Kitty"],
  ["Bruno", "Postman", "Insomnia"],
  // Design
  ["Figma", "Sketch", "Adobe XD"],
  ["Photoshop", "Illustrator", "InDesign"],
  // Communication (usually separate sessions)
  ["Slack", "Discord", "Teams", "Zoom"],
  // Browsers (handled specially by URL)
  ["Firefox", "Chrome", "Safari", "Edge", "Brave", "Arc"],
];

// Time thresholds for session boundaries
const IDLE_THRESHOLD = 120; // 2 minutes of idle = session break
const MAX_SESSION_GAP = 300; // 5 minutes gap = new session

export class SessionBoundaryService {
  private categoryLookup: CategoryLookup | null = null;

  /**
   * Refresh category lookup maps from database
   * Call this at the start of session aggregation
   */
  async refreshCategoryLookup(): Promise<void> {
    this.categoryLookup = await categoriesService.getCategoryLookupMaps();
  }

  /**
   * Get category for an event
   */
  getCategoryForEvent(event: Event): string | null {
    if (!this.categoryLookup) return null;

    // Try bundle ID first (most specific)
    if (event.bundleIdentifier) {
      const byBundle = this.categoryLookup.bundles.get(event.bundleIdentifier);
      if (byBundle) return byBundle;
    }

    // Try app name
    const byApp = this.categoryLookup.apps.get(event.appName);
    if (byApp) return byApp;

    // For browser events, try domain
    if (event.url) {
      const domain = extractDomain(event.url);
      if (domain) {
        // Try exact domain match
        const byDomain = this.categoryLookup.domains.get(domain);
        if (byDomain) return byDomain;

        // Try pattern matching
        for (const { pattern, category } of this.categoryLookup.domainPatterns) {
          if (this.matchesDomainPattern(domain, pattern)) {
            return category;
          }
        }
      }
    }

    return null;
  }

  private matchesDomainPattern(domain: string, pattern: string): boolean {
    const regexPattern = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
    const regex = new RegExp(`^${regexPattern}$`, "i");
    return regex.test(domain);
  }

  /**
   * Check if two apps are in the same related group
   */
  private areAppsRelated(app1: string, app2: string): boolean {
    for (const group of RELATED_APP_GROUPS) {
      const app1InGroup = group.some(
        (g) => app1.toLowerCase().includes(g.toLowerCase()) || g.toLowerCase().includes(app1.toLowerCase())
      );
      const app2InGroup = group.some(
        (g) => app2.toLowerCase().includes(g.toLowerCase()) || g.toLowerCase().includes(app2.toLowerCase())
      );
      if (app1InGroup && app2InGroup) return true;
    }
    return false;
  }

  /**
   * Check if an app is a browser
   */
  private isBrowser(appName: string): boolean {
    const browsers = ["Firefox", "Chrome", "Safari", "Edge", "Brave", "Arc"];
    return browsers.some(
      (b) => appName.toLowerCase().includes(b.toLowerCase())
    );
  }

  /**
   * Main decision function: should two consecutive events be in the same session?
   */
  async shouldMergeEvents(
    prev: Event,
    curr: Event
  ): Promise<BoundaryDecision> {
    // Rule 0: Check time gap
    const gap = (curr.timestamp.getTime() - prev.timestamp.getTime()) / 1000;
    if (gap > MAX_SESSION_GAP) {
      return {
        shouldMerge: false,
        confidence: 1.0,
        reason: `Large time gap (${Math.round(gap / 60)}min)`,
      };
    }

    // Rule 1: If previous was idle for too long, new session
    if (prev.isIdle && (prev.duration ?? 5) > IDLE_THRESHOLD) {
      return {
        shouldMerge: false,
        confidence: 1.0,
        reason: "Extended idle period",
      };
    }

    // Rule 2: Same app, same URL (or no URL) = same session
    if (prev.appName === curr.appName) {
      // Same app, check URLs for browsers
      if (this.isBrowser(prev.appName) && prev.url && curr.url) {
        const prevDomain = extractDomain(prev.url);
        const currDomain = extractDomain(curr.url);

        if (prevDomain === currDomain) {
          return {
            shouldMerge: true,
            confidence: 1.0,
            reason: "Same app and domain",
          };
        }

        // Different domains in browser - check if they're related
        if (areUrlsRelated(prev.url, curr.url)) {
          return {
            shouldMerge: true,
            confidence: 0.9,
            reason: "Related domains (same service ecosystem)",
          };
        }

        // Different domains - use category-based decision
        return this.decideByCategory(prev, curr);
      }

      // Same non-browser app = same session
      return {
        shouldMerge: true,
        confidence: 1.0,
        reason: "Same application",
      };
    }

    // Rule 3: Different apps - check if related apps (same work context)
    if (this.areAppsRelated(prev.appName, curr.appName)) {
      // Check if they have the same category
      const prevCat = this.getCategoryForEvent(prev);
      const currCat = this.getCategoryForEvent(curr);

      if (prevCat && currCat && prevCat === currCat) {
        return {
          shouldMerge: true,
          confidence: 0.9,
          reason: `Related apps in same category (${prevCat})`,
        };
      }

      // Related apps without category - likely same session
      return {
        shouldMerge: true,
        confidence: 0.75,
        reason: "Related application group",
      };
    }

    // Rule 4: Different unrelated apps - use category-based decision
    return this.decideByCategory(prev, curr);
  }

  /**
   * Decide based on categories (database or AI)
   */
  private async decideByCategory(
    prev: Event,
    curr: Event
  ): Promise<BoundaryDecision> {
    const prevCat = this.getCategoryForEvent(prev);
    const currCat = this.getCategoryForEvent(curr);

    // Both have categories
    if (prevCat && currCat) {
      if (prevCat === currCat) {
        return {
          shouldMerge: true,
          confidence: 0.85,
          reason: `Same category (${prevCat})`,
        };
      } else {
        return {
          shouldMerge: false,
          confidence: 0.9,
          reason: `Different categories (${prevCat} → ${currCat})`,
        };
      }
    }

    // One or both uncategorized - try AI
    const uncategorizedItem = !currCat
      ? { type: this.isBrowser(curr.appName) ? "domain" : "app", value: this.getUncategorizedValue(curr) }
      : { type: this.isBrowser(prev.appName) ? "domain" : "app", value: this.getUncategorizedValue(prev) };

    // Check AI cache first
    const cacheKey = this.buildCacheKey(prev, curr);
    const cached = aiDecisionCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Try AI classification (only if available and for meaningful cases)
    if (aiService.isModelAvailable("claude-3-5-haiku")) {
      try {
        const aiDecision = await this.askAIForBoundary(prev, curr);

        // Cache the decision
        aiDecisionCache.set(cacheKey, aiDecision);

        // Store suggestion for user review if confident
        if (aiDecision.suggestedCategory && aiDecision.confidence >= 0.6) {
          await categoriesService.createOrUpdateSuggestion(
            uncategorizedItem.type as "app" | "domain",
            uncategorizedItem.value,
            aiDecision.suggestedCategory,
            aiDecision.confidence
          );
        }

        return aiDecision;
      } catch (error) {
        console.warn("AI boundary decision failed:", error);
      }
    }

    // Conservative fallback: split sessions when uncertain
    return {
      shouldMerge: false,
      confidence: 0.5,
      reason: "Uncategorized - conservative split",
    };
  }

  private getUncategorizedValue(event: Event): string {
    if (this.isBrowser(event.appName) && event.url) {
      return extractDomain(event.url) ?? event.appName;
    }
    return event.appName;
  }

  private buildCacheKey(prev: Event, curr: Event): string {
    const prevKey = this.isBrowser(prev.appName)
      ? extractDomain(prev.url ?? "") ?? prev.appName
      : prev.appName;
    const currKey = this.isBrowser(curr.appName)
      ? extractDomain(curr.url ?? "") ?? curr.appName
      : curr.appName;
    return `${prevKey}|${currKey}`;
  }

  /**
   * Ask AI for session boundary decision (Haiku - fast and cheap)
   */
  private async askAIForBoundary(
    prev: Event,
    curr: Event
  ): Promise<BoundaryDecision> {
    const prevDesc = this.describeEvent(prev);
    const currDesc = this.describeEvent(curr);

    const prompt = `You are classifying activity transitions for a productivity tracker.

Previous activity: ${prevDesc}
Current activity: ${currDesc}

Should these be in the SAME focus session or DIFFERENT sessions?

Consider:
- Development work (coding, terminal, docs) = typically same session
- Research (stackoverflow, docs, tutorials) = typically same session
- Distractions (social media, entertainment) = different session
- Communication (email, slack, meetings) = different session

Return JSON only:
{
  "sameSession": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "suggestedCategory": "development|design|communication|research|distraction|other"
}`;

    try {
      // Use a very simple structure for Haiku
      const response = await this.callHaikuSimple(prompt);
      const parsed = JSON.parse(response);

      return {
        shouldMerge: parsed.sameSession === true,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.6,
        reason: parsed.reason || "AI classification",
        suggestedCategory: parsed.suggestedCategory as ActivityCategory,
      };
    } catch {
      return {
        shouldMerge: false,
        confidence: 0.5,
        reason: "AI parse error - conservative split",
      };
    }
  }

  private describeEvent(event: Event): string {
    let desc = `${event.appName}`;
    if (event.url) {
      const domain = extractDomain(event.url);
      if (domain) desc += ` (${domain})`;
    }
    if (event.windowTitle && event.windowTitle.length < 60) {
      desc += `: "${event.windowTitle}"`;
    }
    return desc;
  }

  /**
   * Simple call to Haiku for boundary decisions
   * This bypasses the full AIService for speed and simplicity
   */
  private async callHaikuSimple(prompt: string): Promise<string> {
    // Access Anthropic client directly via aiService internals
    // In production, you might want to expose this more cleanly
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const textContent = response.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text in response");
    }

    return textContent.text;
  }

  /**
   * Clear AI decision cache (call periodically or when categories change)
   */
  clearCache(): void {
    aiDecisionCache.clear();
  }
}

export const sessionBoundaryService = new SessionBoundaryService();

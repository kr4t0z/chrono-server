import {
  db,
  appCategories,
  domainCategories,
  categorySuggestions,
  events,
  type AppCategory,
  type NewAppCategory,
  type DomainCategory,
  type NewDomainCategory,
  type CategorySuggestion,
  type NewCategorySuggestion,
} from "../db/index.js";
import { eq, and, sql, desc, notInArray } from "drizzle-orm";

// Standard activity categories
export type ActivityCategory =
  | "development"
  | "design"
  | "communication"
  | "research"
  | "distraction"
  | "other";

export class CategoriesService {
  // ========== App Categories ==========

  async getAllAppCategories(): Promise<AppCategory[]> {
    return db.select().from(appCategories).orderBy(appCategories.appName);
  }

  async getAppCategory(appName: string): Promise<AppCategory | null> {
    const [result] = await db
      .select()
      .from(appCategories)
      .where(eq(appCategories.appName, appName))
      .limit(1);
    return result ?? null;
  }

  async getAppCategoryByBundleId(bundleId: string): Promise<AppCategory | null> {
    const [result] = await db
      .select()
      .from(appCategories)
      .where(eq(appCategories.bundleId, bundleId))
      .limit(1);
    return result ?? null;
  }

  async upsertAppCategory(
    appName: string,
    category: string,
    bundleId?: string,
    isUserDefined = true
  ): Promise<AppCategory> {
    const existing = await this.getAppCategory(appName);

    if (existing) {
      const [updated] = await db
        .update(appCategories)
        .set({ category, bundleId, isUserDefined })
        .where(eq(appCategories.id, existing.id))
        .returning();
      return updated;
    }

    const [inserted] = await db
      .insert(appCategories)
      .values({ appName, category, bundleId, isUserDefined })
      .returning();
    return inserted;
  }

  async deleteAppCategory(id: string): Promise<boolean> {
    const result = await db
      .delete(appCategories)
      .where(eq(appCategories.id, id))
      .returning();
    return result.length > 0;
  }

  // ========== Domain Categories ==========

  async getAllDomainCategories(): Promise<DomainCategory[]> {
    return db.select().from(domainCategories).orderBy(domainCategories.domain);
  }

  async getDomainCategory(domain: string): Promise<DomainCategory | null> {
    // Try exact match first
    const [exact] = await db
      .select()
      .from(domainCategories)
      .where(eq(domainCategories.domain, domain))
      .limit(1);

    if (exact) return exact;

    // Try pattern matching (e.g., *.github.com)
    const allPatterns = await db
      .select()
      .from(domainCategories)
      .where(sql`${domainCategories.pattern} IS NOT NULL`);

    for (const cat of allPatterns) {
      if (cat.pattern && this.matchesDomainPattern(domain, cat.pattern)) {
        return cat;
      }
    }

    return null;
  }

  private matchesDomainPattern(domain: string, pattern: string): boolean {
    // Convert wildcard pattern to regex
    // e.g., "*.github.com" -> matches "gist.github.com", "api.github.com"
    const regexPattern = pattern
      .replace(/\./g, "\\.")
      .replace(/\*/g, ".*");
    const regex = new RegExp(`^${regexPattern}$`, "i");
    return regex.test(domain);
  }

  async upsertDomainCategory(
    domain: string,
    category: string,
    pattern?: string,
    isUserDefined = true
  ): Promise<DomainCategory> {
    const [existing] = await db
      .select()
      .from(domainCategories)
      .where(eq(domainCategories.domain, domain))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(domainCategories)
        .set({ category, pattern, isUserDefined })
        .where(eq(domainCategories.id, existing.id))
        .returning();
      return updated;
    }

    const [inserted] = await db
      .insert(domainCategories)
      .values({ domain, category, pattern, isUserDefined })
      .returning();
    return inserted;
  }

  async deleteDomainCategory(id: string): Promise<boolean> {
    const result = await db
      .delete(domainCategories)
      .where(eq(domainCategories.id, id))
      .returning();
    return result.length > 0;
  }

  // ========== Category Suggestions ==========

  async getPendingSuggestions(): Promise<CategorySuggestion[]> {
    return db
      .select()
      .from(categorySuggestions)
      .where(eq(categorySuggestions.status, "pending"))
      .orderBy(desc(categorySuggestions.occurrenceCount));
  }

  async createOrUpdateSuggestion(
    type: "app" | "domain",
    value: string,
    suggestedCategory: string,
    confidence?: number
  ): Promise<CategorySuggestion> {
    // Check if suggestion already exists
    const [existing] = await db
      .select()
      .from(categorySuggestions)
      .where(
        and(
          eq(categorySuggestions.type, type),
          eq(categorySuggestions.value, value),
          eq(categorySuggestions.status, "pending")
        )
      )
      .limit(1);

    if (existing) {
      // Increment occurrence count
      const [updated] = await db
        .update(categorySuggestions)
        .set({
          occurrenceCount: (existing.occurrenceCount ?? 1) + 1,
          suggestedCategory, // Update with latest suggestion
          confidence,
        })
        .where(eq(categorySuggestions.id, existing.id))
        .returning();
      return updated;
    }

    const [inserted] = await db
      .insert(categorySuggestions)
      .values({ type, value, suggestedCategory, confidence, status: "pending" })
      .returning();
    return inserted;
  }

  async acceptSuggestion(id: string): Promise<boolean> {
    const [suggestion] = await db
      .select()
      .from(categorySuggestions)
      .where(eq(categorySuggestions.id, id))
      .limit(1);

    if (!suggestion) return false;

    // Create the actual category
    if (suggestion.type === "app") {
      await this.upsertAppCategory(suggestion.value, suggestion.suggestedCategory, undefined, true);
    } else {
      await this.upsertDomainCategory(suggestion.value, suggestion.suggestedCategory, undefined, true);
    }

    // Mark as accepted
    await db
      .update(categorySuggestions)
      .set({ status: "accepted" })
      .where(eq(categorySuggestions.id, id));

    return true;
  }

  async rejectSuggestion(id: string): Promise<boolean> {
    const result = await db
      .update(categorySuggestions)
      .set({ status: "rejected" })
      .where(eq(categorySuggestions.id, id))
      .returning();
    return result.length > 0;
  }

  // ========== Uncategorized Items ==========

  async getUncategorizedApps(limit = 50): Promise<{ appName: string; count: number }[]> {
    const categorizedApps = db
      .select({ appName: appCategories.appName })
      .from(appCategories);

    const result = await db
      .select({
        appName: events.appName,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(events)
      .where(
        and(
          sql`${events.appName} NOT IN (SELECT app_name FROM app_categories)`,
          eq(events.isIdle, false)
        )
      )
      .groupBy(events.appName)
      .orderBy(sql`count desc`)
      .limit(limit);

    return result.map((r) => ({
      appName: r.appName,
      count: Number(r.count),
    }));
  }

  async getUncategorizedDomains(limit = 50): Promise<{ domain: string; count: number }[]> {
    const result = await db
      .select({
        url: events.url,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(events)
      .where(
        and(
          sql`${events.url} IS NOT NULL`,
          eq(events.isIdle, false)
        )
      )
      .groupBy(events.url)
      .orderBy(sql`count desc`)
      .limit(limit * 2); // Get more to filter after domain extraction

    // Extract domains and filter uncategorized
    const domainCounts = new Map<string, number>();

    for (const r of result) {
      if (!r.url) continue;
      try {
        const domain = new URL(r.url).hostname.replace(/^www\./, "");
        const existingCount = domainCounts.get(domain) ?? 0;
        domainCounts.set(domain, existingCount + Number(r.count));
      } catch {
        // Skip invalid URLs
      }
    }

    // Filter out already categorized domains
    const categorized = await this.getAllDomainCategories();
    const categorizedSet = new Set(categorized.map((c) => c.domain));

    const uncategorized: { domain: string; count: number }[] = [];
    for (const [domain, count] of domainCounts) {
      if (!categorizedSet.has(domain)) {
        uncategorized.push({ domain, count });
      }
    }

    return uncategorized
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  // ========== Lookup Helpers ==========

  async getCategoryForApp(appName: string, bundleId?: string): Promise<string | null> {
    // Try bundle ID first (more specific)
    if (bundleId) {
      const byBundle = await this.getAppCategoryByBundleId(bundleId);
      if (byBundle) return byBundle.category;
    }

    // Fall back to app name
    const byName = await this.getAppCategory(appName);
    return byName?.category ?? null;
  }

  async getCategoryForDomain(domain: string): Promise<string | null> {
    const category = await this.getDomainCategory(domain);
    return category?.category ?? null;
  }

  // Get all categories as a lookup map for efficient session processing
  async getCategoryLookupMaps(): Promise<{
    apps: Map<string, string>;
    bundles: Map<string, string>;
    domains: Map<string, string>;
    domainPatterns: { pattern: string; category: string }[];
  }> {
    const [allApps, allDomains] = await Promise.all([
      this.getAllAppCategories(),
      this.getAllDomainCategories(),
    ]);

    const apps = new Map<string, string>();
    const bundles = new Map<string, string>();
    const domains = new Map<string, string>();
    const domainPatterns: { pattern: string; category: string }[] = [];

    for (const app of allApps) {
      apps.set(app.appName, app.category);
      if (app.bundleId) {
        bundles.set(app.bundleId, app.category);
      }
    }

    for (const domain of allDomains) {
      domains.set(domain.domain, domain.category);
      if (domain.pattern) {
        domainPatterns.push({ pattern: domain.pattern, category: domain.category });
      }
    }

    return { apps, bundles, domains, domainPatterns };
  }
}

export const categoriesService = new CategoriesService();

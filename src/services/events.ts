import { db, events, rules, type NewEvent } from "../db/index.js";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import type { SyncRequest, EventInput } from "../types/api.js";

export class EventsService {
  // Ingest events from a sync request
  async ingestEvents(request: SyncRequest): Promise<number> {
    const { deviceId, source, events: eventList } = request;

    if (eventList.length === 0) return 0;

    const newEvents: NewEvent[] = eventList.map((event) => ({
      deviceId,
      source,
      timestamp: new Date(event.timestamp),
      appName: event.appName,
      windowTitle: event.windowTitle,
      bundleIdentifier: event.bundleIdentifier ?? null,
      documentPath: event.documentPath ?? null,
      url: event.url ?? null,
      isIdle: event.isIdle,
      duration: event.duration,
    }));

    await db.insert(events).values(newEvents);

    return newEvents.length;
  }

  // Get events for a date range
  async getEvents(
    startDate: Date,
    endDate: Date,
    deviceId?: string
  ) {
    const conditions = [
      gte(events.timestamp, startDate),
      lte(events.timestamp, endDate),
    ];

    if (deviceId) {
      conditions.push(eq(events.deviceId, deviceId));
    }

    return db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.timestamp));
  }

  // Get aggregated stats by app
  async getStatsByApp(startDate: Date, endDate: Date, deviceId?: string) {
    const conditions = [
      gte(events.timestamp, startDate),
      lte(events.timestamp, endDate),
      eq(events.isIdle, false),
    ];

    if (deviceId) {
      conditions.push(eq(events.deviceId, deviceId));
    }

    const result = await db
      .select({
        appName: events.appName,
        bundleIdentifier: events.bundleIdentifier,
        totalDuration: sql<number>`sum(${events.duration})`.as("total_duration"),
        eventCount: sql<number>`count(*)`.as("event_count"),
      })
      .from(events)
      .where(and(...conditions))
      .groupBy(events.appName, events.bundleIdentifier)
      .orderBy(sql`total_duration desc`);

    // Calculate percentages
    const totalTime = result.reduce((sum, r) => sum + (r.totalDuration || 0), 0);

    return result.map((r) => ({
      ...r,
      totalDuration: r.totalDuration || 0,
      eventCount: r.eventCount || 0,
      percentage: totalTime > 0 ? ((r.totalDuration || 0) / totalTime) * 100 : 0,
    }));
  }

  // Get aggregated stats by URL (for browser activity breakdown)
  async getStatsByUrl(startDate: Date, endDate: Date, deviceId?: string) {
    const conditions = [
      gte(events.timestamp, startDate),
      lte(events.timestamp, endDate),
      eq(events.isIdle, false),
      sql`${events.url} IS NOT NULL`,
    ];

    if (deviceId) {
      conditions.push(eq(events.deviceId, deviceId));
    }

    const result = await db
      .select({
        url: events.url,
        totalDuration: sql<number>`sum(${events.duration})`.as("total_duration"),
        eventCount: sql<number>`count(*)`.as("event_count"),
      })
      .from(events)
      .where(and(...conditions))
      .groupBy(events.url)
      .orderBy(sql`total_duration desc`)
      .limit(15);

    // Extract domain from URL for cleaner display
    return result.map((r) => {
      let domain = "";
      try {
        const urlObj = new URL(r.url || "");
        domain = urlObj.hostname.replace("www.", "");
      } catch {
        domain = r.url || "";
      }
      return {
        url: r.url,
        domain,
        totalDuration: r.totalDuration || 0,
        eventCount: r.eventCount || 0,
      };
    });
  }

  // Get stats grouped by hour
  async getStatsByHour(startDate: Date, endDate: Date, deviceId?: string) {
    const conditions = [
      gte(events.timestamp, startDate),
      lte(events.timestamp, endDate),
      eq(events.isIdle, false),
    ];

    if (deviceId) {
      conditions.push(eq(events.deviceId, deviceId));
    }

    return db
      .select({
        hour: sql<number>`extract(hour from ${events.timestamp})`.as("hour"),
        totalDuration: sql<number>`sum(${events.duration})`.as("total_duration"),
        eventCount: sql<number>`count(*)`.as("event_count"),
      })
      .from(events)
      .where(and(...conditions))
      .groupBy(sql`extract(hour from ${events.timestamp})`)
      .orderBy(sql`hour`);
  }

  // Get daily overview
  async getDailyOverview(date: Date, deviceId?: string) {
    // Use UTC to avoid timezone shifting issues
    const dateStr = date.toISOString().split("T")[0]; // "2026-01-18"
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

    const [appStats, hourlyStats, totalStats, urlStats] = await Promise.all([
      this.getStatsByApp(startOfDay, endOfDay, deviceId),
      this.getStatsByHour(startOfDay, endOfDay, deviceId),
      this.getTotalStats(startOfDay, endOfDay, deviceId),
      this.getStatsByUrl(startOfDay, endOfDay, deviceId),
    ]);

    return {
      date: date.toISOString().split("T")[0],
      totalTracked: totalStats.totalActive,
      totalIdle: totalStats.totalIdle,
      topApps: appStats.slice(0, 10),
      byHour: hourlyStats.map((h) => ({
        hour: h.hour,
        duration: h.totalDuration || 0,
      })),
      topUrls: urlStats.slice(0, 10),
    };
  }

  // Get total tracked and idle time
  async getTotalStats(startDate: Date, endDate: Date, deviceId?: string) {
    const baseConditions = [
      gte(events.timestamp, startDate),
      lte(events.timestamp, endDate),
    ];

    if (deviceId) {
      baseConditions.push(eq(events.deviceId, deviceId));
    }

    const [activeResult, idleResult] = await Promise.all([
      db
        .select({
          total: sql<number>`sum(${events.duration})`.as("total"),
        })
        .from(events)
        .where(and(...baseConditions, eq(events.isIdle, false))),
      db
        .select({
          total: sql<number>`sum(${events.duration})`.as("total"),
        })
        .from(events)
        .where(and(...baseConditions, eq(events.isIdle, true))),
    ]);

    return {
      totalActive: activeResult[0]?.total || 0,
      totalIdle: idleResult[0]?.total || 0,
    };
  }
}

export const eventsService = new EventsService();

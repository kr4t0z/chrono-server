import { db, userSettings, type UserSettings, type NewUserSettings } from "../db/index.js";
import { eq } from "drizzle-orm";
import type { UserSettingsInput } from "../types/api.js";

export class UserSettingsService {
  // Get settings for a device
  async getSettings(deviceId: string): Promise<UserSettings | null> {
    const result = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.deviceId, deviceId))
      .limit(1);

    return result[0] ?? null;
  }

  // Create or update settings
  async upsertSettings(deviceId: string, input: UserSettingsInput): Promise<UserSettings> {
    const existing = await this.getSettings(deviceId);

    if (existing) {
      const [updated] = await db
        .update(userSettings)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(userSettings.deviceId, deviceId))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(userSettings)
      .values({
        deviceId,
        ...input,
      })
      .returning();

    return created;
  }

  // Format user context for AI prompt
  getUserContext(settings: UserSettings | null): string {
    if (!settings) {
      return "No user profile configured.";
    }

    const parts: string[] = [];

    if (settings.displayName) {
      parts.push(`Name: ${settings.displayName}`);
    }

    if (settings.workDescription) {
      parts.push(`Role/Work: ${settings.workDescription}`);
    }

    if (settings.productivityGoals) {
      parts.push(`Goals: ${settings.productivityGoals}`);
    }

    if (settings.distractionApps && settings.distractionApps.length > 0) {
      parts.push(`Known distractions: ${settings.distractionApps.join(", ")}`);
    }

    if (settings.timezone) {
      parts.push(`Timezone: ${settings.timezone}`);
    }

    return parts.length > 0 ? parts.join("\n") : "No user profile configured.";
  }
}

export const userSettingsService = new UserSettingsService();

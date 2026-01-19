import { db, aiObservations, type AIObservation, type NewAIObservation, type ObservationCategory } from "../db/index.js";
import { eq, and, desc, lt, sql } from "drizzle-orm";

// New observation from AI
export interface NewObservationInput {
  observation: string;
  confidence: number;
  category: ObservationCategory;
}

export class ObservationsService {
  // Get all active observations for a device
  async getObservations(deviceId: string): Promise<AIObservation[]> {
    return db
      .select()
      .from(aiObservations)
      .where(and(
        eq(aiObservations.deviceId, deviceId),
        eq(aiObservations.isActive, true)
      ))
      .orderBy(desc(aiObservations.confidence), desc(aiObservations.occurrenceCount));
  }

  // Get high-confidence observations for AI context
  async getHighConfidenceObservations(deviceId: string, minConfidence = 0.5): Promise<AIObservation[]> {
    const observations = await this.getObservations(deviceId);
    return observations.filter((o) => o.confidence >= minConfidence);
  }

  // Merge new observations from AI response
  async mergeObservations(deviceId: string, newObs: NewObservationInput[]): Promise<void> {
    const existing = await this.getObservations(deviceId);

    for (const obs of newObs) {
      // Check for similar existing observation (simple string similarity)
      const similar = existing.find((e) => this.isSimilarObservation(e.observation, obs.observation));

      if (similar) {
        // Update existing observation - increase confidence and occurrence count
        const newConfidence = Math.min(1, similar.confidence + (obs.confidence * 0.1));
        await db
          .update(aiObservations)
          .set({
            confidence: newConfidence,
            lastConfirmed: new Date(),
            occurrenceCount: similar.occurrenceCount + 1,
          })
          .where(eq(aiObservations.id, similar.id));
      } else {
        // Create new observation
        await db.insert(aiObservations).values({
          deviceId,
          observation: obs.observation,
          confidence: obs.confidence,
          category: obs.category,
        });
      }
    }
  }

  // Manually confirm an observation (user feedback)
  async confirmObservation(id: string): Promise<AIObservation | null> {
    const [updated] = await db
      .update(aiObservations)
      .set({
        confidence: sql`LEAST(${aiObservations.confidence} + 0.1, 1)`,
        lastConfirmed: new Date(),
        occurrenceCount: sql`${aiObservations.occurrenceCount} + 1`,
      })
      .where(eq(aiObservations.id, id))
      .returning();

    return updated ?? null;
  }

  // Dismiss an observation (user feedback)
  async dismissObservation(id: string): Promise<boolean> {
    const [updated] = await db
      .update(aiObservations)
      .set({
        isActive: false,
      })
      .where(eq(aiObservations.id, id))
      .returning({ id: aiObservations.id });

    return !!updated;
  }

  // Decay confidence of observations not seen recently
  async decayStaleObservations(deviceId: string, daysThreshold = 14): Promise<number> {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - daysThreshold);

    const result = await db
      .update(aiObservations)
      .set({
        confidence: sql`GREATEST(${aiObservations.confidence} - 0.1, 0)`,
      })
      .where(and(
        eq(aiObservations.deviceId, deviceId),
        eq(aiObservations.isActive, true),
        lt(aiObservations.lastConfirmed, threshold)
      ))
      .returning({ id: aiObservations.id });

    return result.length;
  }

  // Prune observations with very low confidence
  async pruneStaleObservations(minConfidence = 0.2): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await db
      .update(aiObservations)
      .set({
        isActive: false,
      })
      .where(and(
        lt(aiObservations.confidence, minConfidence),
        lt(aiObservations.lastConfirmed, thirtyDaysAgo)
      ))
      .returning({ id: aiObservations.id });

    return result.length;
  }

  // Simple similarity check for observations
  private isSimilarObservation(existing: string, newObs: string): boolean {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "");
    const existingWords = new Set(normalize(existing).split(/\s+/).filter(Boolean));
    const newWords = new Set(normalize(newObs).split(/\s+/).filter(Boolean));

    // Calculate Jaccard similarity
    let intersection = 0;
    for (const word of newWords) {
      if (existingWords.has(word)) intersection++;
    }

    const union = new Set([...existingWords, ...newWords]).size;
    const similarity = union > 0 ? intersection / union : 0;

    // Consider similar if > 60% overlap
    return similarity > 0.6;
  }
}

export const observationsService = new ObservationsService();

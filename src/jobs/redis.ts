/**
 * Redis connection configuration for BullMQ job queues
 */

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

// Parse Redis URL to connection options
function parseRedisUrl(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || "localhost",
      port: parseInt(parsed.port) || 6379,
      password: parsed.password || undefined,
      maxRetriesPerRequest: null as null, // Required by BullMQ
    };
  } catch {
    // Fallback for simple host:port format
    return {
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null as null,
    };
  }
}

// Export connection options for use in queues and workers
export const redisConnection = parseRedisUrl(redisUrl);

console.log(`📡 Redis configured: ${redisConnection.host}:${redisConnection.port}`);

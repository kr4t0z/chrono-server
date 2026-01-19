# chrono-server - Backend API

TypeScript backend for storing and querying time tracking data.

## Tech Stack
- Bun runtime
- Hono (web framework)
- Drizzle ORM
- PostgreSQL
- Zod (validation)
- **BullMQ** (background job queue)
- **Redis** (job queue backend)

## Quick Start

```bash
# Install deps
bun install

# Start Redis (required for background jobs)
redis-server

# Push schema to database
bun run db:push

# Start dev server (port 3000)
bun run dev
```

## Environment Variables

```bash
DATABASE_URL=postgres://localhost:5432/chrono
REDIS_URL=redis://localhost:6379
```

---

## Background Jobs System (NEW)

### Overview

The server now uses **BullMQ** for background job processing. This was implemented to solve the slow session computation problem (2+ minutes for full day aggregation).

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  ChronoAgent    │────▶│  /api/sync      │────▶│  events table   │
│  (5min batches) │     │                 │     │                 │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 │ triggers job
                                 ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  BullMQ Queue   │◀────│  sessionWorker  │────▶│ daily_sessions  │
│  (Redis)        │     │                 │     │  (pre-computed) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                                                         │ instant read
                                                         ▼
                                                ┌─────────────────┐
                                                │ /api/sessions   │
                                                └─────────────────┘
```

### How It Works

1. **Event Sync** (`POST /api/sync`): After ingesting events, queues a session aggregation job with 30s delay (to batch multiple syncs)
2. **Session Worker**: Processes jobs, computes sessions, stores in `daily_sessions` table
3. **Session API** (`GET /api/stats/sessions/:date`): Returns cached data instantly, or 202 if still computing

### Files Added

```
src/jobs/
├── redis.ts                    # Redis connection config
├── types.ts                    # Job payload/result types
├── queues.ts                   # Queue definitions + helpers
└── workers/
    └── sessionWorker.ts        # Session aggregation worker
```

---

## API Endpoints

### Core Events

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sync` | Receive events from agent (now queues jobs) |
| GET | `/api/events` | List raw events |
| GET | `/api/stats/daily/:date` | Daily summary + app breakdown |
| GET | `/api/stats/today` | Today's summary |

### Sessions (AI-Ready)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats/sessions/:date` | Daily sessions (cached) |
| GET | `/api/stats/sessions/:date?startAt=&endAt=` | Sessions for time window |
| GET | `/api/stats/sessions/today` | Today's sessions |
| GET | `/api/stats/sessions/range` | Sessions for date range |
| GET | `/api/stats/weekly-patterns` | Aggregated weekly patterns |

**Query Parameters for `/api/stats/sessions/:date`:**
- `deviceId` - Filter by device
- `forceCompute=true` - Bypass cache, compute fresh
- `startAt` - ISO 8601 timestamp for time window start
- `endAt` - ISO 8601 timestamp for time window end

### Job Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/jobs/status` | Queue statistics |
| GET | `/api/jobs/failed` | Recent failed jobs |
| POST | `/api/jobs/sessions/trigger` | Manual trigger |
| GET | `/api/jobs/sessions/:jobId` | Job status |
| POST | `/api/jobs/sessions/:jobId/retry` | Retry failed job |
| DELETE | `/api/jobs/sessions/:jobId` | Remove job |
| POST | `/api/jobs/clean` | Clean old jobs |

---

## Project Structure

```
src/
├── index.ts              # Hono app, middleware, worker import
├── db/
│   ├── schema.ts         # Drizzle tables (including daily_sessions)
│   └── index.ts          # PostgreSQL connection
├── jobs/
│   ├── redis.ts          # Redis connection config
│   ├── types.ts          # Job type definitions
│   ├── queues.ts         # BullMQ queue setup
│   └── workers/
│       └── sessionWorker.ts
├── routes/
│   ├── events.ts         # Events + sessions endpoints
│   ├── jobs.ts           # Job management endpoints
│   ├── settings.ts
│   ├── projects.ts
│   ├── insights.ts
│   └── categories.ts
├── services/
│   ├── events.ts
│   ├── sessions.ts       # Session aggregation logic
│   ├── sessionBoundary.ts
│   └── ...
└── types/
    └── api.ts            # Zod schemas
```

---

## Known Issues & Next Steps

### Session Aggregation Logic Issue

**Problem:** The session aggregation is creating too many fragmented sessions. In a 10-minute test window with 260 events, it created 246 sessions with very short durations (5-10s each).

**Expected Behavior:** Consecutive similar events should merge into longer sessions. For example, browsing Firefox for 10 minutes should be ~1 session, not 100+ micro-sessions.

**Investigation Needed:**
1. Review `sessionBoundary.ts` - the `shouldMergeEvents()` logic
2. Check if idle detection is too aggressive (creating breaks between every event)
3. Verify the merge confidence threshold (currently 0.7) isn't too high

**Test Command:**
```bash
curl "http://localhost:3000/api/stats/sessions/2026-01-18?deviceId=mac-C390A440&startAt=2026-01-18T23:35:00-03:00&endAt=2026-01-18T23:45:21-03:00"
```

### Future Enhancements

1. **Scheduled Jobs**: Add cron-style jobs for:
   - Nightly uncategorized domain ranking
   - Weekly AI summary generation

2. **Job Dashboard UI**: Visual monitoring of queue status

3. **Session Logic Tuning**: Adjust merge thresholds after investigation

---

## Bruno API Collection

All endpoints have Bruno requests in `./bruno/`:
- `bruno/Events/` - Sync, events, daily stats
- `bruno/Sessions/` - Session endpoints including time window
- `bruno/Jobs/` - Job management endpoints
- `bruno/Categories/`, `bruno/Insights/`, etc.

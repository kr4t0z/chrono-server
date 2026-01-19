import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import eventsRouter from "./routes/events.js";
import settingsRouter from "./routes/settings.js";
import projectsRouter from "./routes/projects.js";
import insightsRouter from "./routes/insights.js";
import categoriesRouter from "./routes/categories.js";
import jobsRouter from "./routes/jobs.js";

// Start background job workers
import "./jobs/workers/sessionWorker.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*", // Allow all origins for local development
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Health check at /health
app.get("/health", (c) => {
  return c.json({
    name: "Chrono Server",
    version: "0.1.0",
    status: "running",
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.route("/api", eventsRouter);
app.route("/api", settingsRouter);
app.route("/api", projectsRouter);
app.route("/api", insightsRouter);
app.route("/api", categoriesRouter);
app.route("/api/jobs", jobsRouter);

// Serve dashboard at root
app.get("/", serveStatic({ path: "./public/index.html" }));
app.use("/static/*", serveStatic({ root: "./public" }));

// Start server
const port = parseInt(process.env.PORT || "3000");

console.log(`
╔═══════════════════════════════════════╗
║         Chrono Server v0.1.0          ║
╠═══════════════════════════════════════╣
║  Server running on port ${port}          ║
║  API: http://localhost:${port}/api       ║
║  Jobs: http://localhost:${port}/api/jobs ║
║  Workers: Session aggregation active  ║
╚═══════════════════════════════════════╝
`);

serve({
  fetch: app.fetch,
  port,
});

/**
 * Versus Agent Server
 *
 * Main entry point for the agent runtime server.
 *
 * Starts:
 * - Hono HTTP server with REST API
 * - WebSocket support for real-time updates
 * - Alice and Bob agent loops
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { env } from "./utils/env";
import { logger } from "./utils/logger";
import { initializeDatabase } from "./db/client";
import { healthRoutes, agentRoutes, agentsWebsocket } from "./api/routes";
import { createAllAgentConfigs, startAllAgents, stopAllAgents } from "./agents";
import { initializeAgentWallets } from "./agents/init";

// Create Hono app
const app = new Hono();

// Middleware
app.use("*", cors({
  origin: env.FRONTEND_URL || "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

app.use("*", honoLogger());

// Routes
app.route("/health", healthRoutes);
app.route("/api/agents", agentRoutes);

// Root endpoint
app.get("/", (c) => {
  return c.json({
    name: "Versus Agent Server",
    version: "0.1.0",
    status: "running",
    endpoints: {
      health: "/health",
      agents: "/api/agents",
      agentDetail: "/api/agents/:id",
      decisions: "/api/agents/:id/decisions",
      recentDecisions: "/api/agents/:id/decisions/recent",
      websocket: "/api/agents/:id/ws",
    },
  });
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Error handler
app.onError((err, c) => {
  logger.error({ error: err.message, stack: err.stack }, "Unhandled error");
  return c.json({ error: "Internal server error" }, 500);
});

// Graceful shutdown handler
function setupShutdownHandler() {
  const shutdown = () => {
    logger.info("Shutdown signal received, stopping agents...");
    stopAllAgents();
    logger.info("Agents stopped, exiting...");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Start server
async function main() {
  logger.info({ nodeEnv: env.NODE_ENV }, "Starting Versus Agent Server");

  // Initialize database
  initializeDatabase();

  // Set up shutdown handler
  setupShutdownHandler();

  // Create and start agents
  const agentConfigs = createAllAgentConfigs();
  logger.info(
    { agents: agentConfigs.map((a) => a.id) },
    "Agent configurations loaded"
  );

  // Initialize Circle wallets for agents
  const agentWallets = await initializeAgentWallets(agentConfigs);
  logger.info(
    { walletCount: agentWallets.size },
    "Circle wallets initialized"
  );

  // Start agents (30 second cycle interval)
  startAllAgents(agentConfigs, 30_000);
  logger.info("Agent loops started");

  // Start HTTP server
  const port = env.PORT;

  logger.info({ port }, "Starting HTTP server");

  // Use Bun.serve for WebSocket support
  const server = Bun.serve({
    port,
    fetch: app.fetch,
    websocket: agentsWebsocket,
  });

  logger.info(
    {
      port: server.port,
      url: `http://localhost:${server.port}`,
    },
    "Server started"
  );

  // Log agent status
  for (const config of agentConfigs) {
    logger.info(
      {
        agentId: config.id,
        name: config.name,
        strategy: config.strategyType,
        evmAddress: config.evmAddress,
        tokenAddress: config.tokenAddress,
      },
      "Agent initialized"
    );
  }

  logger.info("Versus Agent Server is ready");
}

// Run
main().catch((error) => {
  logger.error({ error }, "Failed to start server");
  process.exit(1);
});

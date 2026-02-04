/**
 * Health Check Routes
 *
 * Provides health status for the server and its integrations.
 */

import { Hono } from "hono";
import { getPublicClient } from "../../integrations/chain/client";
import { isCircleConfigured, getCircleClient } from "../../integrations/circle";
import { checkStorkHealth } from "../../integrations/stork";
import { db } from "../../db/client";
import { getAllAgentStatuses } from "../../agents";
import { logger } from "../../utils/logger";

const health = new Hono();

interface IntegrationStatus {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs?: number;
  error?: string;
}

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  integrations: IntegrationStatus[];
  agents: {
    total: number;
    running: number;
  };
}

const startTime = Date.now();

/**
 * Check chain connectivity
 */
async function checkChain(): Promise<IntegrationStatus> {
  const start = Date.now();
  try {
    const client = getPublicClient();
    const blockNumber = await client.getBlockNumber();
    return {
      name: "chain",
      status: "healthy",
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      name: "chain",
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check Circle API connectivity
 */
async function checkCircle(): Promise<IntegrationStatus> {
  if (!isCircleConfigured()) {
    return {
      name: "circle",
      status: "degraded",
      error: "Not configured",
    };
  }

  const start = Date.now();
  try {
    const client = getCircleClient();
    // Just verify SDK is initialized - actual API call would require wallet set ID
    return {
      name: "circle",
      status: "healthy",
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      name: "circle",
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check Stork Oracle connectivity
 */
async function checkStork(): Promise<IntegrationStatus> {
  const start = Date.now();
  try {
    const healthy = await checkStorkHealth();
    return {
      name: "stork",
      status: healthy ? "healthy" : "degraded",
      latencyMs: Date.now() - start,
      error: healthy ? undefined : "Could not fetch assets",
    };
  } catch (error) {
    return {
      name: "stork",
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<IntegrationStatus> {
  const start = Date.now();
  try {
    // Simple query to verify DB connection
    await db.query.agents.findFirst();
    return {
      name: "database",
      status: "healthy",
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      name: "database",
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * GET /health
 *
 * Returns overall health status
 */
health.get("/", async (c) => {
  const integrations = await Promise.all([
    checkChain(),
    checkCircle(),
    checkStork(),
    checkDatabase(),
  ]);

  const agentStatuses = getAllAgentStatuses();
  const runningAgents = agentStatuses.filter((a) => a.isRunning).length;

  // Determine overall status
  const unhealthyCount = integrations.filter(
    (i) => i.status === "unhealthy"
  ).length;
  const degradedCount = integrations.filter(
    (i) => i.status === "degraded"
  ).length;

  let overallStatus: "healthy" | "degraded" | "unhealthy";
  if (unhealthyCount > 0) {
    overallStatus = "unhealthy";
  } else if (degradedCount > 0) {
    overallStatus = "degraded";
  } else {
    overallStatus = "healthy";
  }

  const response: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Date.now() - startTime,
    integrations,
    agents: {
      total: agentStatuses.length,
      running: runningAgents,
    },
  };

  const statusCode = overallStatus === "healthy" ? 200 : 503;
  return c.json(response, statusCode);
});

/**
 * GET /health/live
 *
 * Simple liveness probe
 */
health.get("/live", (c) => {
  return c.json({ status: "ok" });
});

/**
 * GET /health/ready
 *
 * Readiness probe - checks if server can handle requests
 */
health.get("/ready", async (c) => {
  try {
    // Check critical integrations
    const [chain, database] = await Promise.all([
      checkChain(),
      checkDatabase(),
    ]);

    if (chain.status === "unhealthy" || database.status === "unhealthy") {
      return c.json({ status: "not ready", chain, database }, 503);
    }

    return c.json({ status: "ready" });
  } catch (error) {
    return c.json({ status: "error", error: String(error) }, 503);
  }
});

export default health;

/**
 * Video Schedule API Routes
 *
 * Exposes video generation scheduler status to the frontend.
 */

import { Hono } from "hono";
import {
  getScheduleStatus,
  getAllScheduleStatuses,
  forceVideoGeneration,
  isVideoGenerationConfigured,
} from "../../agents/content";
import { logger } from "../../utils/logger";

const scheduleRoutes = new Hono();

/**
 * GET /api/agents/schedules - Get all agents' schedule statuses
 */
scheduleRoutes.get("/schedules", (c) => {
  const statuses = getAllScheduleStatuses();
  return c.json({
    configured: isVideoGenerationConfigured(),
    schedules: statuses,
  });
});

/**
 * GET /api/agents/:id/schedule - Get schedule status for a specific agent
 */
scheduleRoutes.get("/:id/schedule", (c) => {
  const agentId = c.req.param("id");
  const status = getScheduleStatus(agentId);
  return c.json(status);
});

/**
 * POST /api/agents/:id/generate - Force trigger video generation
 */
scheduleRoutes.post("/:id/generate", async (c) => {
  const agentId = c.req.param("id");

  if (!isVideoGenerationConfigured()) {
    return c.json({ error: "Video generation not configured" }, 503);
  }

  logger.info({ agentId }, "Force video generation requested via API");

  const progress = await forceVideoGeneration(agentId);

  if (!progress) {
    return c.json(
      { error: "Generation failed or already in progress" },
      409
    );
  }

  return c.json({ generation: progress });
});

export default scheduleRoutes;

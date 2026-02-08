/**
 * API Routes Index
 *
 * Re-exports all route handlers.
 */

export { default as healthRoutes } from "./health";
export { default as agentRoutes, agentsWebsocket } from "./agents";
export { default as videoRoutes } from "./videos";
export { default as streamingRoutes } from "./streaming";
export { default as authRoutes } from "./auth";
export { default as tradingRoutes } from "./trading";
export { default as scheduleRoutes } from "./schedule";

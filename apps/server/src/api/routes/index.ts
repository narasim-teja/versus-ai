/**
 * API Routes Index
 *
 * Re-exports all route handlers.
 */

export { default as healthRoutes } from "./health";
export { default as agentRoutes, agentsWebsocket } from "./agents";
export { default as videoRoutes } from "./videos";
export { default as streamingRoutes } from "./streaming";

/**
 * Agent Runtime Module
 *
 * Re-exports all runtime functionality.
 */

export { readAgentState, resetCycleCounter } from "./state";
export { decide } from "./decide";
export {
  logDecision,
  subscribeToDecisions,
  getRecentDecisions,
  getDecisionHistory,
  getLatestDecision,
  getDecisionCount,
  clearRecentBuffer,
} from "./logger";
export {
  startAgent,
  stopAgent,
  getAgentStatus,
  getAllAgentStatuses,
  forceAgentCycle,
  startAllAgents,
  stopAllAgents,
  isAgentRunning,
  getAgentRuntime,
} from "./loop";

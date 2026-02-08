/**
 * Agent Configurations Index
 *
 * Creates and exports agent configurations for Alice and Bob.
 * When agents are running, returns the live configs (with Circle wallet addresses).
 */

import { createAliceConfig, ALICE_STRATEGY } from "./alice";
import { createBobConfig, BOB_STRATEGY } from "./bob";
import type { AgentConfig } from "../types";
import { getAgentRuntime } from "../runtime/loop";

export { createAliceConfig, createBobConfig, ALICE_STRATEGY, BOB_STRATEGY };

const AGENT_IDS = ["alice", "bob"] as const;

/**
 * Create all agent configurations.
 * Prefers live runtime configs (which have the real Circle wallet addresses)
 * over freshly-created defaults (which have 0x0000... as the address).
 */
export function createAllAgentConfigs(): AgentConfig[] {
  return AGENT_IDS.map((id) => {
    const runtime = getAgentRuntime(id);
    if (runtime) {
      return runtime.getConfig();
    }
    // Fallback to default (before agents have started)
    return id === "alice" ? createAliceConfig() : createBobConfig();
  });
}

/**
 * Get agent config by ID
 */
export function getAgentConfig(agentId: string): AgentConfig | undefined {
  // Prefer live runtime config (has real Circle wallet address)
  const runtime = getAgentRuntime(agentId);
  if (runtime) {
    return runtime.getConfig();
  }
  // Fallback to default configs
  const configs = [createAliceConfig(), createBobConfig()];
  return configs.find((c) => c.id === agentId);
}

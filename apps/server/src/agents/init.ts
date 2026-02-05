/**
 * Agent Initialization
 *
 * Initializes Circle wallets for agents on startup.
 * Ensures each agent has a Circle wallet before the runtime starts.
 */

import { getOrCreateWallet, getWalletByAgentId } from "../integrations/circle/wallet";
import { isCircleConfigured } from "../integrations/circle/client";
import { logger } from "../utils/logger";
import type { AgentConfig } from "./types";

/**
 * Wallet info returned after initialization
 */
export interface AgentWalletInit {
  agentId: string;
  circleWalletId: string;
  circleWalletAddress: string;
}

/**
 * Initialize Circle wallets for all agents
 *
 * This should be called during server startup, after database initialization.
 * It creates or retrieves Circle wallets for each agent and returns their info.
 */
export async function initializeAgentWallets(
  agentConfigs: AgentConfig[]
): Promise<Map<string, AgentWalletInit>> {
  const walletMap = new Map<string, AgentWalletInit>();

  // Check if Circle is configured
  if (!isCircleConfigured()) {
    logger.warn(
      "Circle SDK not configured - agents will use on-chain USDC balance only"
    );
    return walletMap;
  }

  logger.info(
    { agentCount: agentConfigs.length },
    "Initializing Circle wallets for agents"
  );

  for (const config of agentConfigs) {
    try {
      // Get or create Circle wallet for this agent
      const wallet = await getOrCreateWallet(config.id);

      walletMap.set(config.id, {
        agentId: config.id,
        circleWalletId: wallet.id,
        circleWalletAddress: wallet.address,
      });

      logger.info(
        {
          agentId: config.id,
          circleWalletId: wallet.id,
          circleWalletAddress: wallet.address,
        },
        "Circle wallet initialized for agent"
      );
    } catch (error) {
      logger.error(
        { agentId: config.id, error },
        "Failed to initialize Circle wallet for agent"
      );
    }
  }

  logger.info(
    { initializedCount: walletMap.size },
    "Circle wallet initialization complete"
  );

  return walletMap;
}

/**
 * Get Circle wallet ID for an agent
 *
 * Returns the wallet ID from database, or null if not found.
 */
export async function getAgentCircleWalletId(
  agentId: string
): Promise<string | null> {
  const wallet = await getWalletByAgentId(agentId);
  return wallet?.id ?? null;
}

/**
 * Get Circle wallet address for an agent
 */
export async function getAgentCircleWalletAddress(
  agentId: string
): Promise<string | null> {
  const wallet = await getWalletByAgentId(agentId);
  return wallet?.address ?? null;
}

/**
 * Agent Initialization
 *
 * Seeds agent records in the database and initializes Circle wallets on startup.
 * Ensures each agent has a DB record (for FK constraints) and a Circle wallet
 * before the runtime starts.
 */

import { eq } from "drizzle-orm";
import { getOrCreateWallet, getWalletByAgentId } from "../integrations/circle/wallet";
import { isCircleConfigured } from "../integrations/circle/client";
import { db } from "../db/client";
import { agents } from "../db/schema";
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
 * Seed agent records in the database.
 *
 * The circle_wallets table has a FK to agents.id, so agent records must
 * exist before wallet records can be inserted. This upserts agent configs
 * to ensure the FK constraint is always satisfied.
 */
export async function seedAgents(agentConfigs: AgentConfig[]): Promise<void> {
  for (const config of agentConfigs) {
    try {
      const existing = await db.query.agents.findFirst({
        where: eq(agents.id, config.id),
      });

      if (existing) {
        logger.debug({ agentId: config.id }, "Agent record already exists in DB");
        continue;
      }

      await db.insert(agents).values({
        id: config.id,
        name: config.name,
        evmAddress: config.evmAddress,
        tokenAddress: config.tokenAddress,
        bondingCurveAddress: config.bondingCurveAddress,
        strategyType: config.strategyType,
        strategyConfig: JSON.stringify(config.strategy),
        isActive: true,
      });

      logger.info({ agentId: config.id }, "Seeded agent record in database");
    } catch (error) {
      logger.error({ agentId: config.id, error }, "Failed to seed agent record");
    }
  }
}

/**
 * Initialize Circle wallets for all agents
 *
 * This should be called during server startup, after database initialization
 * and agent seeding. It creates or retrieves Circle wallets for each agent.
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
      // Pass known address from env so stale DB records can be detected
      const knownAddress = config.evmAddress !== "0x0000000000000000000000000000000000000000"
        ? config.evmAddress
        : undefined;
      const wallet = await getOrCreateWallet(config.id, knownAddress);

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

/**
 * Circle Developer-Controlled Wallets SDK Client
 *
 * Initializes the Circle SDK for wallet management.
 * Uses EVM-TESTNET blockchain for Arc Testnet integration.
 */

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { env } from "../../utils/env";
import { logger } from "../../utils/logger";

// Initialize Circle SDK client
let circleClient: ReturnType<
  typeof initiateDeveloperControlledWalletsClient
> | null = null;

/**
 * Get or create Circle SDK client singleton
 */
export function getCircleClient() {
  if (!circleClient) {
    circleClient = initiateDeveloperControlledWalletsClient({
      apiKey: env.CIRCLE_API_KEY,
      entitySecret: env.CIRCLE_ENTITY_SECRET,
    });
    logger.info("Circle SDK client initialized");
  }
  return circleClient;
}

/**
 * Check if Circle integration is configured
 */
export function isCircleConfigured(): boolean {
  return Boolean(env.CIRCLE_API_KEY && env.CIRCLE_ENTITY_SECRET);
}

/**
 * Get the configured wallet set ID
 */
export function getWalletSetId(): string {
  return env.CIRCLE_WALLET_SET_ID;
}

export type CircleClient = ReturnType<typeof getCircleClient>;

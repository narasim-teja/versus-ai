/**
 * Nitrolite On-Chain State Channel Client
 *
 * Manages a singleton NitroliteClient for interacting with the
 * Custody and Adjudicator contracts on Base Sepolia.
 *
 * Uses the server's existing wallet (YELLOW_SERVER_PRIVATE_KEY) to
 * deposit USDC into Custody and manage state channel lifecycle.
 */

import { NitroliteClient, WalletStateSigner } from "@erc7824/nitrolite";
import type { Address } from "viem";
import {
  getBasePublicClient,
  getBaseWalletClient,
  baseSepolia,
} from "../chain/base-client";
import { env } from "../../utils/env";
import { logger } from "../../utils/logger";

// ─── Singleton ────────────────────────────────────────────────────────

let _nitroliteClient: NitroliteClient | null = null;

/**
 * Check if Nitrolite on-chain integration is configured.
 * Requires a server private key (for signing) and custody address.
 */
export function isNitroliteConfigured(): boolean {
  return !!(env.YELLOW_SERVER_PRIVATE_KEY && env.NITROLITE_CUSTODY_ADDRESS);
}

/**
 * Get or create the singleton NitroliteClient.
 * Returns null if not configured or wallet unavailable.
 */
export function getNitroliteClient(): NitroliteClient | null {
  if (_nitroliteClient) return _nitroliteClient;

  if (!isNitroliteConfigured()) {
    return null;
  }

  const walletClient = getBaseWalletClient();
  if (!walletClient) {
    logger.warn("No Base Sepolia wallet client — Nitrolite unavailable");
    return null;
  }

  const publicClient = getBasePublicClient();
  const stateSigner = new WalletStateSigner(walletClient);

  const custodyAddress = env.NITROLITE_CUSTODY_ADDRESS as Address;
  const adjudicatorAddress = env.NITROLITE_ADJUDICATOR_ADDRESS as Address;

  _nitroliteClient = new NitroliteClient({
    publicClient,
    walletClient,
    stateSigner,
    addresses: {
      custody: custodyAddress,
      adjudicator: adjudicatorAddress,
    },
    chainId: baseSepolia.id,
    challengeDuration: 3600n, // 1 hour (minimum required by Custody contract)
  });

  logger.info(
    {
      custody: custodyAddress,
      adjudicator: adjudicatorAddress,
      chainId: baseSepolia.id,
    },
    "NitroliteClient initialized",
  );

  return _nitroliteClient;
}

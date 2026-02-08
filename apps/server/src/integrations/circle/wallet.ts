/**
 * Circle Wallet Service
 *
 * Implements hybrid wallet management:
 * 1. Check DB for existing wallet by agentId
 * 2. If not in DB, list wallets from Circle API and match by refId
 * 3. If found in Circle but not DB, persist to DB
 * 4. Only create new wallet if not found anywhere
 */

import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { circleWallets } from "../../db/schema";
import { logger } from "../../utils/logger";
import { getCircleClient, getWalletSetId } from "./client";
import type { AgentWalletInfo, TokenBalance, WalletInfo } from "./types";

const BLOCKCHAIN = "ARC-TESTNET";

/**
 * Get or create a Circle wallet for an agent
 *
 * Implements hybrid approach:
 * - First checks database for existing wallet
 * - Creates new wallet via Circle API if not found
 * - Stores new wallet in database for future lookups
 */
export async function getOrCreateWallet(agentId: string, knownAddress?: string): Promise<AgentWalletInfo> {
  // Step 1: Check database for existing wallet
  try {
    const existing = await db.query.circleWallets.findFirst({
      where: eq(circleWallets.agentId, agentId),
    });

    if (existing) {
      // If we have a known address from env, verify the DB record matches
      if (knownAddress && existing.address.toLowerCase() !== knownAddress.toLowerCase()) {
        logger.warn(
          { agentId, dbAddress: existing.address, expectedAddress: knownAddress },
          "DB wallet address mismatch — stale record, will search Circle API"
        );
        // Delete the stale record
        await db.delete(circleWallets).where(eq(circleWallets.id, existing.id));
      } else {
        logger.info({ agentId, walletId: existing.id, address: existing.address }, "Found existing Circle wallet in DB");
        return {
          id: existing.id,
          address: existing.address,
          blockchain: existing.blockchain,
          walletSetId: existing.walletSetId,
          agentId: existing.agentId!,
          createdAt: existing.createdAt!,
        };
      }
    }
  } catch (dbError) {
    logger.warn({ agentId, error: (dbError as Error).message }, "DB query for existing wallet failed, will check Circle API");
  }

  // Step 2: Check Circle API for existing wallet (by address or refId)
  const circleClient = getCircleClient();
  const walletSetId = getWalletSetId();

  try {
    const listResponse = await circleClient.listWallets({ walletSetId });
    const existingWallets = listResponse.data?.wallets || [];

    // Prefer matching by known address (most reliable), fallback to refId
    let matchingWallet = knownAddress
      ? existingWallets.find(
          (w) => w.address?.toLowerCase() === knownAddress.toLowerCase() && w.blockchain === BLOCKCHAIN
        )
      : undefined;

    if (!matchingWallet) {
      matchingWallet = existingWallets.find(
        (w) => w.refId === agentId && w.blockchain === BLOCKCHAIN
      );
    }

    if (matchingWallet) {
      logger.info(
        { agentId, walletId: matchingWallet.id, address: matchingWallet.address },
        "Found existing Circle wallet via API (not in DB), persisting"
      );

      const now = new Date();

      // Persist to DB for future lookups
      try {
        await db
          .insert(circleWallets)
          .values({
            id: matchingWallet.id,
            agentId,
            address: matchingWallet.address,
            blockchain: matchingWallet.blockchain,
            walletSetId: matchingWallet.walletSetId,
            createdAt: now,
          })
          .onConflictDoNothing();
      } catch (insertErr) {
        logger.warn({ agentId, error: (insertErr as Error).message }, "Failed to persist wallet to DB (non-fatal)");
      }

      return {
        id: matchingWallet.id,
        address: matchingWallet.address,
        blockchain: matchingWallet.blockchain,
        walletSetId: matchingWallet.walletSetId,
        agentId,
        createdAt: now,
      };
    }
  } catch (listErr) {
    logger.warn({ agentId, error: (listErr as Error).message }, "Failed to list Circle wallets (will create new)");
  }

  // Step 3: Create new wallet via Circle API (no existing wallet found anywhere)
  logger.info({ agentId }, "Creating new Circle wallet");

  const response = await circleClient.createWallets({
    walletSetId,
    blockchains: [BLOCKCHAIN],
    count: 1,
    accountType: "EOA",
    metadata: [
      {
        name: `versus-agent-${agentId}`,
        refId: agentId,
      },
    ],
  });

  if (!response.data?.wallets || response.data.wallets.length === 0) {
    throw new Error(`Failed to create Circle wallet for agent ${agentId}`);
  }

  const wallet = response.data.wallets[0];
  const now = new Date();

  // Step 4: Store in database
  try {
    await db
      .insert(circleWallets)
      .values({
        id: wallet.id,
        agentId,
        address: wallet.address,
        blockchain: wallet.blockchain,
        walletSetId: wallet.walletSetId,
        createdAt: now,
      })
      .onConflictDoNothing();
  } catch (insertErr) {
    logger.warn({ agentId, error: (insertErr as Error).message }, "Failed to persist new wallet to DB (non-fatal)");
  }

  logger.info(
    { agentId, walletId: wallet.id, address: wallet.address },
    "Created and stored Circle wallet"
  );

  return {
    id: wallet.id,
    address: wallet.address,
    blockchain: wallet.blockchain,
    walletSetId: wallet.walletSetId,
    agentId,
    createdAt: now,
  };
}

/**
 * Get wallet by ID from Circle API
 */
export async function getWallet(walletId: string): Promise<WalletInfo | null> {
  const circleClient = getCircleClient();

  try {
    const response = await circleClient.getWallet({ id: walletId });

    if (!response.data?.wallet) {
      return null;
    }

    const wallet = response.data.wallet;
    return {
      id: wallet.id,
      address: wallet.address,
      blockchain: wallet.blockchain,
      walletSetId: wallet.walletSetId,
    };
  } catch (error) {
    logger.error({ walletId, error }, "Failed to get Circle wallet");
    return null;
  }
}

/**
 * Get token balances for a wallet
 */
export async function getWalletBalances(walletId: string): Promise<TokenBalance[]> {
  const circleClient = getCircleClient();

  try {
    const response = await circleClient.getWalletTokenBalance({ id: walletId, includeAll: true, pageSize: 10 });

    if (!response.data?.tokenBalances) {
      return [];
    }

    return response.data.tokenBalances as TokenBalance[];
  } catch (error) {
    logger.warn({ walletId, error: (error as Error).message }, "Circle balance query failed (expected on Arc testnet)");
    throw error;
  }
}

/**
 * Get USDC balance for a wallet
 * Returns balance as bigint in base units (6 decimals)
 */
export async function getUsdcBalance(walletId: string): Promise<bigint> {
  const balances = await getWalletBalances(walletId);

  const usdcBalance = balances.find(
    (b) => b.token.symbol === "USDC" || b.token.symbol === "USD Coin"
  );

  if (!usdcBalance) {
    return BigInt(0);
  }

  // Convert string amount to bigint
  // Circle returns amount as string with decimals
  const [whole, decimal = ""] = usdcBalance.amount.split(".");
  const paddedDecimal = decimal.padEnd(6, "0").slice(0, 6);
  return BigInt(whole + paddedDecimal);
}

/**
 * List all wallets in the wallet set
 */
export async function listWallets(): Promise<WalletInfo[]> {
  const circleClient = getCircleClient();
  const walletSetId = getWalletSetId();

  try {
    const response = await circleClient.listWallets({ walletSetId });

    if (!response.data?.wallets) {
      return [];
    }

    return response.data.wallets.map((wallet) => ({
      id: wallet.id,
      address: wallet.address,
      blockchain: wallet.blockchain,
      walletSetId: wallet.walletSetId,
    }));
  } catch (error) {
    logger.error({ walletSetId, error }, "Failed to list Circle wallets");
    return [];
  }
}

/**
 * Get wallet by agent ID from database
 */
export async function getWalletByAgentId(
  agentId: string
): Promise<AgentWalletInfo | null> {
  const wallet = await db.query.circleWallets.findFirst({
    where: eq(circleWallets.agentId, agentId),
  });

  if (!wallet) {
    return null;
  }

  return {
    id: wallet.id,
    address: wallet.address,
    blockchain: wallet.blockchain,
    walletSetId: wallet.walletSetId,
    agentId: wallet.agentId!,
    createdAt: wallet.createdAt!,
  };
}

/**
 * Circle Wallet Service
 *
 * Implements hybrid wallet management:
 * 1. Check DB for existing wallet by agentId
 * 2. If exists, return cached wallet info
 * 3. If not, create via Circle API and store in DB
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
export async function getOrCreateWallet(agentId: string): Promise<AgentWalletInfo> {
  // Step 1: Check database for existing wallet
  const existing = await db.query.circleWallets.findFirst({
    where: eq(circleWallets.agentId, agentId),
  });

  if (existing) {
    logger.debug({ agentId, walletId: existing.id }, "Found existing Circle wallet");
    return {
      id: existing.id,
      address: existing.address,
      blockchain: existing.blockchain,
      walletSetId: existing.walletSetId,
      agentId: existing.agentId!,
      createdAt: new Date(existing.createdAt!),
    };
  }

  // Step 2: Create new wallet via Circle API
  logger.info({ agentId }, "Creating new Circle wallet");
  const circleClient = getCircleClient();
  const walletSetId = getWalletSetId();

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
  const now = Date.now();

  // Step 3: Store in database
  await db.insert(circleWallets).values({
    id: wallet.id,
    agentId,
    address: wallet.address,
    blockchain: wallet.blockchain,
    walletSetId: wallet.walletSetId,
    createdAt: now,
  });

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
    createdAt: new Date(now),
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
    const response = await circleClient.getWalletTokenBalance({ id: walletId });

    if (!response.data?.tokenBalances) {
      return [];
    }

    return response.data.tokenBalances as TokenBalance[];
  } catch (error) {
    logger.error({ walletId, error }, "Failed to get wallet balances");
    return [];
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
    createdAt: new Date(wallet.createdAt!),
  };
}

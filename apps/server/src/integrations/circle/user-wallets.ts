/**
 * Circle User-Controlled Wallets
 *
 * Server-side SDK for managing viewer wallets.
 * Handles user creation, token generation, and wallet initialization challenges.
 */

import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { env } from "../../utils/env";
import { logger } from "../../utils/logger";
import { randomUUID } from "crypto";

let userWalletClient: ReturnType<
  typeof initiateUserControlledWalletsClient
> | null = null;

function getUserWalletClient() {
  if (!userWalletClient) {
    userWalletClient = initiateUserControlledWalletsClient({
      apiKey: env.CIRCLE_API_KEY,
    });
    logger.info("Circle User-Controlled Wallets client initialized");
  }
  return userWalletClient;
}

/**
 * Create a new Circle user for a viewer.
 * Returns a userId that can be used for subsequent operations.
 */
export async function createViewerUser(): Promise<{ userId: string }> {
  const client = getUserWalletClient();
  const userId = randomUUID();

  await client.createUser({ userId });
  logger.info({ userId }, "Created Circle user for viewer");

  return { userId };
}

/**
 * Get a session token for a viewer user.
 * Returns userToken (60-min validity) and encryptionKey for the Web SDK.
 */
export async function getUserToken(
  userId: string
): Promise<{ userToken: string; encryptionKey: string }> {
  const client = getUserWalletClient();

  const response = await client.createUserToken({ userId });

  const userToken = response.data?.userToken;
  const encryptionKey = response.data?.encryptionKey;

  if (!userToken || !encryptionKey) {
    throw new Error("Failed to get user token from Circle");
  }

  logger.info({ userId }, "Generated user token");
  return { userToken, encryptionKey };
}

/**
 * Initialize user wallet on specified blockchains.
 * Returns a challengeId that must be executed on the client-side SDK.
 */
export async function initializeUserWallet(
  userId: string
): Promise<{ challengeId: string }> {
  const client = getUserWalletClient();

  const response = await client.createUserPinWithWallets({
    userId,
    blockchains: ["ARC-TESTNET"],
    idempotencyKey: randomUUID(),
  });

  const challengeId = response.data?.challengeId;

  if (!challengeId) {
    throw new Error("Failed to initialize user wallet");
  }

  logger.info({ userId, challengeId }, "Initialized user wallet challenge");
  return { challengeId };
}

/**
 * Create a contract execution challenge for a viewer wallet.
 * Returns a challengeId that must be executed on the client-side SDK.
 *
 * Note: Circle's transaction challenge API requires a userToken (JWT),
 * not a userId. We obtain a fresh token before creating the challenge.
 */
export async function createContractExecutionChallenge(params: {
  userId: string;
  walletId: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: Array<string | number | boolean>;
  refId?: string;
}): Promise<{ challengeId: string }> {
  const client = getUserWalletClient();

  // Transaction challenges require a userToken (JWT), not a userId
  const { userToken } = await getUserToken(params.userId);

  const response = await client.createUserTransactionContractExecutionChallenge({
    userToken,
    walletId: params.walletId,
    contractAddress: params.contractAddress,
    abiFunctionSignature: params.abiFunctionSignature,
    abiParameters: params.abiParameters,
    fee: {
      type: "level",
      config: {
        feeLevel: "MEDIUM",
      },
    },
    refId: params.refId,
    idempotencyKey: randomUUID(),
  });

  const challengeId = response.data?.challengeId;

  if (!challengeId) {
    throw new Error("Failed to create contract execution challenge");
  }

  logger.info(
    {
      userId: params.userId,
      challengeId,
      contractAddress: params.contractAddress,
      fn: params.abiFunctionSignature,
    },
    "Created contract execution challenge"
  );

  return { challengeId };
}

/**
 * Get user's wallets.
 */
export async function getUserWallets(userId: string) {
  const client = getUserWalletClient();

  const response = await client.listWallets({ userId });
  return response.data?.wallets ?? [];
}

/**
 * Get user's wallet balances.
 */
export async function getUserWalletBalances(userId: string) {
  const client = getUserWalletClient();

  // First get wallets
  const wallets = await getUserWallets(userId);
  if (wallets.length === 0) return [];

  // Balance queries require a userToken (JWT)
  const { userToken } = await getUserToken(userId);

  const balances = await Promise.all(
    wallets.map(async (wallet: { id: string }) => {
      try {
        const balanceResponse = await client.getWalletTokenBalance({
          userToken,
          walletId: wallet.id,
        });
        return {
          walletId: wallet.id,
          balances: balanceResponse.data?.tokenBalances ?? [],
        };
      } catch {
        return { walletId: wallet.id, balances: [] };
      }
    })
  );

  return balances;
}

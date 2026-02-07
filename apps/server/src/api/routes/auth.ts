/**
 * Auth API Routes
 *
 * Endpoints for Circle User-Controlled Wallet lifecycle:
 * - Register viewer (create Circle user)
 * - Get session token + encryption key
 * - Initialize wallet (create challenge)
 * - Get wallets and balances
 */

import { Hono } from "hono";
import {
  createViewerUser,
  getUserToken,
  initializeUserWallet,
  getUserWallets,
  getUserWalletBalances,
} from "../../integrations/circle/user-wallets";
import { logger } from "../../utils/logger";

const auth = new Hono();

/**
 * POST /api/auth/register
 *
 * Create a new Circle user for a viewer.
 */
auth.post("/register", async (c) => {
  try {
    const result = await createViewerUser();
    return c.json(result);
  } catch (error) {
    logger.error({ error }, "Failed to register viewer");
    return c.json(
      { error: "Failed to register. Please try again." },
      500
    );
  }
});

/**
 * POST /api/auth/token
 *
 * Get a session token and encryption key for the Web SDK.
 */
auth.post("/token", async (c) => {
  const body = await c.req.json<{ userId: string }>();

  if (!body.userId) {
    return c.json({ error: "userId is required" }, 400);
  }

  try {
    const result = await getUserToken(body.userId);
    return c.json(result);
  } catch (error) {
    logger.error({ error, userId: body.userId }, "Failed to get user token");
    return c.json({ error: "Failed to get session token." }, 500);
  }
});

/**
 * POST /api/auth/initialize
 *
 * Initialize user wallet on blockchain. Returns challengeId for client SDK.
 */
auth.post("/initialize", async (c) => {
  const body = await c.req.json<{ userId: string }>();

  if (!body.userId) {
    return c.json({ error: "userId is required" }, 400);
  }

  try {
    const result = await initializeUserWallet(body.userId);
    return c.json(result);
  } catch (error) {
    logger.error(
      { error, userId: body.userId },
      "Failed to initialize wallet"
    );
    return c.json({ error: "Failed to initialize wallet." }, 500);
  }
});

/**
 * GET /api/auth/user/:userId/wallets
 *
 * Get viewer's wallets.
 */
auth.get("/user/:userId/wallets", async (c) => {
  const userId = c.req.param("userId");

  try {
    const wallets = await getUserWallets(userId);
    return c.json({ wallets });
  } catch (error) {
    logger.error({ error, userId }, "Failed to get wallets");
    return c.json({ error: "Failed to get wallets." }, 500);
  }
});

/**
 * GET /api/auth/user/:userId/balances
 *
 * Get viewer's wallet balances.
 */
auth.get("/user/:userId/balances", async (c) => {
  const userId = c.req.param("userId");

  try {
    const balances = await getUserWalletBalances(userId);
    return c.json({ balances });
  } catch (error) {
    logger.error({ error, userId }, "Failed to get balances");
    return c.json({ error: "Failed to get balances." }, 500);
  }
});

export default auth;

/**
 * Trading API Routes
 *
 * Endpoints for bonding curve prices, trade quotes, on-chain portfolio data,
 * and trade execution via Circle UCW challenges.
 */

import { Hono } from "hono";
import { getAddress, type Address } from "viem";
import { createAllAgentConfigs } from "../../agents";
import {
  getBondingCurve,
  getERC20,
  getUSDC,
  addresses,
} from "../../integrations/chain";
import { createContractExecutionChallenge } from "../../integrations/circle/user-wallets";
import { logger } from "../../utils/logger";

const trading = new Hono();

/**
 * GET /api/trading/prices
 *
 * Get current token prices for all agents from their bonding curves.
 */
trading.get("/prices", async (c) => {
  try {
    const configs = createAllAgentConfigs();

    const prices = await Promise.all(
      configs.map(async (config) => {
        try {
          const bc = getBondingCurve(config.bondingCurveAddress as Address);
          const token = getERC20(config.tokenAddress as Address);

          const [price, floorPrice, ceilingPrice, reserveBalance, totalSupply] =
            await Promise.all([
              bc.read.getPrice(),
              bc.read.getFloorPrice(),
              bc.read.ceiling(),
              bc.read.reserveBalance(),
              token.read.totalSupply(),
            ]);

          return {
            agentId: config.id,
            agentName: config.name,
            tokenAddress: config.tokenAddress,
            bondingCurveAddress: config.bondingCurveAddress,
            price: price.toString(),
            floorPrice: floorPrice.toString(),
            ceiling: ceilingPrice.toString(),
            reserveBalance: reserveBalance.toString(),
            totalSupply: totalSupply.toString(),
          };
        } catch (err) {
          logger.warn(
            { agentId: config.id, error: err },
            "Failed to fetch price for agent"
          );
          return {
            agentId: config.id,
            agentName: config.name,
            tokenAddress: config.tokenAddress,
            bondingCurveAddress: config.bondingCurveAddress,
            price: "0",
            floorPrice: "0",
            ceiling: "0",
            reserveBalance: "0",
            totalSupply: "0",
          };
        }
      })
    );

    return c.json({ prices });
  } catch (error) {
    logger.error({ error }, "Failed to fetch prices");
    return c.json({ error: "Failed to fetch prices" }, 500);
  }
});

/**
 * GET /api/trading/quote
 *
 * Get a buy or sell quote from a bonding curve.
 * Query params: bondingCurveAddress, side (buy|sell), amount (raw uint256 string)
 */
trading.get("/quote", async (c) => {
  const bondingCurveAddress = c.req.query("bondingCurveAddress");
  const side = c.req.query("side");
  const amount = c.req.query("amount");

  if (!bondingCurveAddress || !side || !amount) {
    return c.json(
      { error: "bondingCurveAddress, side, and amount are required" },
      400
    );
  }

  if (side !== "buy" && side !== "sell") {
    return c.json({ error: "side must be 'buy' or 'sell'" }, 400);
  }

  if (amount === "0") {
    return c.json({
      side,
      amountIn: "0",
      amountOut: "0",
      currentPrice: "0",
    });
  }

  try {
    const bc = getBondingCurve(bondingCurveAddress as Address);
    const currentPrice = await bc.read.getPrice();

    if (side === "buy") {
      const tokensOut = await bc.read.getBuyQuote([BigInt(amount)]);
      return c.json({
        side: "buy",
        amountIn: amount,
        amountOut: tokensOut.toString(),
        currentPrice: currentPrice.toString(),
      });
    } else {
      const usdcOut = await bc.read.getSellQuote([BigInt(amount)]);
      return c.json({
        side: "sell",
        amountIn: amount,
        amountOut: usdcOut.toString(),
        currentPrice: currentPrice.toString(),
      });
    }
  } catch (error) {
    logger.error(
      { bondingCurveAddress, side, amount, error },
      "Failed to get quote"
    );
    return c.json({ error: "Failed to get quote" }, 500);
  }
});

/**
 * GET /api/trading/portfolio/:address
 *
 * Read on-chain USDC + agent token balances for a wallet address on Arc Testnet.
 */
trading.get("/portfolio/:address", async (c) => {
  const configs = createAllAgentConfigs();

  let address: Address;
  try {
    address = getAddress(c.req.param("address"));
  } catch {
    return c.json({ error: "Invalid address" }, 400);
  }

  try {
    const usdc = getUSDC();
    const usdcBalance = await usdc.read.balanceOf([address]);

    const holdings = await Promise.all(
      configs.map(async (config) => {
        try {
          const token = getERC20(config.tokenAddress as Address);
          const bc = getBondingCurve(config.bondingCurveAddress as Address);

          const [balance, price] = await Promise.all([
            token.read.balanceOf([address]),
            bc.read.getPrice(),
          ]);

          // value = (balance * price) / 1e18 → USDC value (6 decimals)
          const value = (balance * price) / BigInt(10 ** 18);

          return {
            agentId: config.id,
            agentName: config.name,
            tokenAddress: config.tokenAddress,
            balance: balance.toString(),
            price: price.toString(),
            value: value.toString(),
          };
        } catch (err) {
          logger.warn(
            { agentId: config.id, address, error: err },
            "Failed to read token balance"
          );
          return {
            agentId: config.id,
            agentName: config.name,
            tokenAddress: config.tokenAddress,
            balance: "0",
            price: "0",
            value: "0",
          };
        }
      })
    );

    const activeHoldings = holdings.filter((h) => h.balance !== "0");
    const totalValue =
      activeHoldings.reduce((sum, h) => sum + BigInt(h.value), 0n) +
      usdcBalance;

    return c.json({
      address,
      usdcBalance: usdcBalance.toString(),
      holdings: activeHoldings,
      totalValue: totalValue.toString(),
    });
  } catch (error) {
    logger.error({ address, error }, "Failed to fetch portfolio");
    return c.json({ error: "Failed to fetch portfolio" }, 500);
  }
});

/**
 * POST /api/trading/execute
 *
 * Create a Circle UCW challenge for a trade action (approve, buy, or sell).
 * The frontend must execute the returned challengeId via the Circle Web SDK.
 *
 * Body: { userId, walletId, action, contractAddress, params }
 * - action: "approve_usdc" | "approve_token" | "buy" | "sell"
 * - params for approve_usdc: { spender: bondingCurveAddress }
 * - params for approve_token: { spender: bondingCurveAddress, tokenAddress }
 * - params for buy: { usdcAmount, minTokensOut }
 * - params for sell: { tokenAmount, minUsdcOut }
 */
trading.post("/execute", async (c) => {
  const body = await c.req.json<{
    userId: string;
    walletId: string;
    action: "approve_usdc" | "approve_token" | "buy" | "sell";
    contractAddress: string;
    params: Record<string, string>;
  }>();

  const { userId, walletId, action, contractAddress, params } = body;

  if (!userId || !walletId || !action || !contractAddress) {
    return c.json(
      { error: "userId, walletId, action, and contractAddress are required" },
      400
    );
  }

  try {
    let abiFunctionSignature: string;
    let abiParameters: Array<string>;
    let refId: string;

    const MAX_UINT256 =
      "115792089237316195423570985008687907853269984665640564039457584007913129639935";

    switch (action) {
      case "approve_usdc":
        abiFunctionSignature = "approve(address,uint256)";
        abiParameters = [params.spender, MAX_UINT256];
        refId = `approve-usdc-${Date.now()}`;
        // Approve USDC on the bonding curve — call USDC contract
        const result = await createContractExecutionChallenge({
          userId,
          walletId,
          contractAddress: addresses.usdc,
          abiFunctionSignature,
          abiParameters,
          refId,
        });
        return c.json(result);

      case "approve_token":
        abiFunctionSignature = "approve(address,uint256)";
        abiParameters = [params.spender, MAX_UINT256];
        refId = `approve-token-${Date.now()}`;
        // Approve token on the bonding curve — call token contract
        const tokenResult = await createContractExecutionChallenge({
          userId,
          walletId,
          contractAddress: params.tokenAddress,
          abiFunctionSignature,
          abiParameters,
          refId,
        });
        return c.json(tokenResult);

      case "buy":
        abiFunctionSignature = "buy(uint256,uint256)";
        abiParameters = [params.usdcAmount, params.minTokensOut];
        refId = `buy-${Date.now()}`;
        break;

      case "sell":
        abiFunctionSignature = "sell(uint256,uint256)";
        abiParameters = [params.tokenAmount, params.minUsdcOut];
        refId = `sell-${Date.now()}`;
        break;

      default:
        return c.json({ error: "Invalid action" }, 400);
    }

    const challengeResult = await createContractExecutionChallenge({
      userId,
      walletId,
      contractAddress,
      abiFunctionSignature,
      abiParameters,
      refId,
    });

    return c.json(challengeResult);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create trade challenge";
    logger.error({ userId, action, contractAddress, error }, "Failed to create trade challenge");
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/trading/allowance
 *
 * Check on-chain ERC-20 allowance for a given owner → spender pair.
 * Used by the frontend to verify approval tx is confirmed before buying.
 * Query params: tokenAddress, owner, spender
 */
trading.get("/allowance", async (c) => {
  const tokenAddress = c.req.query("tokenAddress");
  const owner = c.req.query("owner");
  const spender = c.req.query("spender");

  if (!tokenAddress || !owner || !spender) {
    return c.json(
      { error: "tokenAddress, owner, and spender are required" },
      400
    );
  }

  try {
    const token = getERC20(tokenAddress as Address);
    const allowance = await token.read.allowance([
      owner as Address,
      spender as Address,
    ]);
    return c.json({ allowance: allowance.toString() });
  } catch (error) {
    logger.error({ tokenAddress, owner, spender, error }, "Failed to check allowance");
    return c.json({ error: "Failed to check allowance" }, 500);
  }
});

export default trading;

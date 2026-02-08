/**
 * Trading API Routes
 *
 * Endpoints for bonding curve prices, trade quotes, on-chain portfolio data,
 * and trade execution via Circle UCW challenges.
 */

import { Hono } from "hono";
import { getAddress, type Address } from "viem";
import { desc, eq, and, gte } from "drizzle-orm";
import { createAllAgentConfigs } from "../../agents";
import {
  getBondingCurve,
  getERC20,
  getUSDC,
  addresses,
} from "../../integrations/chain";
import { createContractExecutionChallenge } from "../../integrations/circle/user-wallets";
import { db } from "../../db/client";
import { trades } from "../../db/schema";
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

/**
 * GET /api/trading/history/:tokenAddress
 *
 * Get recent trade events for a token's bonding curve.
 * Query params: limit (default 50), from (unix ms, optional)
 */
trading.get("/history/:tokenAddress", async (c) => {
  const tokenAddress = c.req.param("tokenAddress");
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);
  const from = c.req.query("from");

  try {
    const conditions = [eq(trades.tokenAddress, tokenAddress)];
    if (from) {
      conditions.push(gte(trades.timestamp, Number(from)));
    }

    const rows = await db
      .select()
      .from(trades)
      .where(and(...conditions))
      .orderBy(desc(trades.timestamp))
      .limit(limit);

    return c.json({ trades: rows });
  } catch (error) {
    logger.error({ tokenAddress, error }, "Failed to fetch trade history");
    return c.json({ error: "Failed to fetch trade history" }, 500);
  }
});

/**
 * GET /api/trading/chart/:tokenAddress
 *
 * Get OHLCV candle data for charting.
 * Query params: timeframe (1m, 5m, 15m, 1h — default 5m), limit (default 100)
 */
trading.get("/chart/:tokenAddress", async (c) => {
  const tokenAddress = c.req.param("tokenAddress");
  const timeframe = c.req.query("timeframe") || "5m";
  const limit = Math.min(Number(c.req.query("limit") || 100), 500);

  const tfMs: Record<string, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
  };
  const bucketMs = tfMs[timeframe] || 300_000;

  try {
    // Fetch trades for the time window
    const windowMs = bucketMs * limit;
    const fromTs = Date.now() - windowMs;

    const rows = await db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.tokenAddress, tokenAddress),
          gte(trades.timestamp, fromTs)
        )
      )
      .orderBy(trades.timestamp);

    if (rows.length === 0) {
      // Fallback: get current on-chain price as a single data point
      const configs = createAllAgentConfigs();
      const config = configs.find(
        (cfg) => cfg.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
      );
      if (config) {
        const bc = getBondingCurve(config.bondingCurveAddress as Address);
        const price = await bc.read.getPrice();
        const priceNum = Number(price) / 1e6;
        const now = Math.floor(Date.now() / 1000);
        return c.json({
          candles: [
            { time: now, open: priceNum, high: priceNum, low: priceNum, close: priceNum, volume: 0 },
          ],
        });
      }
      return c.json({ candles: [] });
    }

    // Build candles from trades
    const candles: Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }> = [];

    const firstTradeTs = rows[0].timestamp;
    const bucketStart = Math.floor(firstTradeTs / bucketMs) * bucketMs;
    const lastTradeTs = rows[rows.length - 1].timestamp;
    const bucketEnd = Math.floor(lastTradeTs / bucketMs) * bucketMs + bucketMs;

    let lastClose = Number(rows[0].price) / 1e6;

    for (let ts = bucketStart; ts < bucketEnd; ts += bucketMs) {
      const bucketTrades = rows.filter(
        (t) => t.timestamp >= ts && t.timestamp < ts + bucketMs
      );

      if (bucketTrades.length === 0) {
        // Carry forward
        candles.push({
          time: Math.floor(ts / 1000),
          open: lastClose,
          high: lastClose,
          low: lastClose,
          close: lastClose,
          volume: 0,
        });
      } else {
        const prices = bucketTrades.map((t) => Number(t.price) / 1e6);
        const volume = bucketTrades.reduce(
          (sum, t) => sum + Number(t.usdcAmount) / 1e6,
          0
        );
        const open = prices[0];
        const close = prices[prices.length - 1];
        const high = Math.max(...prices);
        const low = Math.min(...prices);
        lastClose = close;

        candles.push({
          time: Math.floor(ts / 1000),
          open,
          high,
          low,
          close,
          volume,
        });
      }
    }

    return c.json({ candles });
  } catch (error) {
    logger.error({ tokenAddress, error }, "Failed to build chart data");
    return c.json({ error: "Failed to build chart data" }, 500);
  }
});

export default trading;

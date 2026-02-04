/**
 * Stork Oracle REST Client
 *
 * Fetches market data (ETH/USD, BTC/USD) for sentiment analysis.
 * Implements rate limiting (5 req/sec) and caching.
 *
 * Note: We use Stork for market sentiment only, NOT for our token prices.
 * Token prices come from direct contract reads (bondingCurve.getPrice()).
 */

import { env } from "../../utils/env";
import { logger } from "../../utils/logger";
import type {
  StorkLatestPricesResponse,
  StorkAssetsResponse,
  StorkHistoryResponse,
} from "./types";

const BASE_URL = env.STORK_REST_URL;
const RATE_LIMIT_MS = 200; // 5 requests per second

let lastRequestTime = 0;

/**
 * Rate-limited fetch wrapper
 */
async function rateLimitedFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();

  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${env.STORK_API_KEY}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
}

/**
 * Get list of available asset IDs from Stork
 */
export async function getAvailableAssets(): Promise<string[]> {
  try {
    const response = await rateLimitedFetch(`${BASE_URL}/v1/prices/assets`);

    if (!response.ok) {
      throw new Error(`Stork API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as StorkAssetsResponse;
    return data.data || [];
  } catch (error) {
    logger.error({ error }, "Failed to fetch Stork assets");
    return [];
  }
}

/**
 * Get latest prices for specified assets
 *
 * @param assets Array of asset IDs (e.g., ["BTCUSD", "ETHUSD"])
 */
export async function getLatestPrices(
  assets: string[]
): Promise<StorkLatestPricesResponse["data"]> {
  if (assets.length === 0) {
    return {};
  }

  try {
    const assetsParam = assets.join(",");
    const response = await rateLimitedFetch(
      `${BASE_URL}/v1/prices/latest?assets=${assetsParam}`
    );

    if (!response.ok) {
      throw new Error(`Stork API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as StorkLatestPricesResponse;
    return data.data || {};
  } catch (error) {
    logger.error({ assets, error }, "Failed to fetch Stork prices");
    return {};
  }
}

/**
 * Get historical OHLC data for an asset
 *
 * @param symbol Asset symbol (e.g., "BTCUSD")
 * @param from Unix timestamp (seconds)
 * @param to Unix timestamp (seconds)
 * @param resolution Candle resolution in minutes (e.g., 60 for 1 hour)
 */
export async function getHistoricalPrices(
  symbol: string,
  from: number,
  to: number,
  resolution: number = 60
): Promise<StorkHistoryResponse | null> {
  try {
    const url = new URL(`${BASE_URL}/v1/tradingview/history`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("from", from.toString());
    url.searchParams.set("to", to.toString());
    url.searchParams.set("resolution", resolution.toString());

    const response = await rateLimitedFetch(url.toString());

    if (!response.ok) {
      throw new Error(`Stork API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as StorkHistoryResponse;

    if (data.s !== "ok") {
      logger.warn({ symbol, data }, "Stork history response not ok");
      return null;
    }

    return data;
  } catch (error) {
    logger.error({ symbol, from, to, error }, "Failed to fetch Stork history");
    return null;
  }
}

/**
 * Check if Stork integration is configured and working
 */
export async function checkStorkHealth(): Promise<boolean> {
  try {
    const assets = await getAvailableAssets();
    return assets.length > 0;
  } catch {
    return false;
  }
}

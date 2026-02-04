/**
 * Stork Price Service
 *
 * High-level service for fetching market sentiment data.
 * Implements caching (5-second TTL) to respect rate limits.
 *
 * Usage:
 * - getMarketSentiment() for agent decision making
 * - getEthPrice() / getBtcPrice() for individual prices
 */

import { db } from "../../db/client";
import { marketSentiment } from "../../db/schema";
import { logger } from "../../utils/logger";
import { getLatestPrices, getHistoricalPrices } from "./client";
import type {
  MarketPrice,
  MarketSentiment,
  MarketSentimentData,
  StorkPriceData,
} from "./types";

// Cache configuration
const CACHE_TTL_MS = 5000; // 5 seconds

// In-memory cache
interface PriceCache {
  data: MarketPrice;
  timestamp: number;
}

const priceCache = new Map<string, PriceCache>();

// Asset IDs for market sentiment
const ETH_ASSET_ID = "ETHUSD";
const BTC_ASSET_ID = "BTCUSD";

/**
 * Convert Stork QuantizedPrice (18 decimals) to bigint (6 decimals)
 */
function quantizedPriceToUsdc(quantizedPrice: string): bigint {
  // QuantizedPrice = price * 10^18
  // We want 6 decimals for USDC compatibility
  // So divide by 10^12
  return BigInt(quantizedPrice) / BigInt(10 ** 12);
}

/**
 * Convert Stork QuantizedPrice to float
 */
function quantizedPriceToFloat(quantizedPrice: string): number {
  return Number(BigInt(quantizedPrice)) / 10 ** 18;
}

/**
 * Convert Stork price data to normalized MarketPrice
 */
function toMarketPrice(data: StorkPriceData): MarketPrice {
  // Stork timestamp is in nanoseconds
  const timestamp = new Date(data.timestamp / 1_000_000);

  return {
    asset: data.asset_id,
    price: quantizedPriceToUsdc(data.price),
    priceFloat: quantizedPriceToFloat(data.price),
    timestamp,
  };
}

/**
 * Get cached price or fetch from Stork
 */
async function getCachedPrice(assetId: string): Promise<MarketPrice | null> {
  const now = Date.now();
  const cached = priceCache.get(assetId);

  // Return cached if still valid
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // Fetch fresh price
  const prices = await getLatestPrices([assetId]);
  const priceData = prices[assetId];

  if (!priceData) {
    logger.warn({ assetId }, "No price data from Stork");
    return null;
  }

  const marketPrice = toMarketPrice(priceData);

  // Update cache
  priceCache.set(assetId, {
    data: marketPrice,
    timestamp: now,
  });

  return marketPrice;
}

/**
 * Get ETH/USD price
 */
export async function getEthPrice(): Promise<MarketPrice | null> {
  return getCachedPrice(ETH_ASSET_ID);
}

/**
 * Get BTC/USD price
 */
export async function getBtcPrice(): Promise<MarketPrice | null> {
  return getCachedPrice(BTC_ASSET_ID);
}

/**
 * Calculate 24h price change percentage
 */
async function get24hChange(assetId: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 24 * 60 * 60;

  const history = await getHistoricalPrices(assetId, dayAgo, now, 60);

  if (!history || history.c.length < 2) {
    return 0;
  }

  const oldPrice = history.c[0];
  const newPrice = history.c[history.c.length - 1];

  return ((newPrice - oldPrice) / oldPrice) * 100;
}

/**
 * Calculate market sentiment from ETH and BTC price changes
 */
function calculateSentiment(ethChange: number, btcChange: number): MarketSentiment {
  const avgChange = (ethChange + btcChange) / 2;

  if (avgChange > 2) {
    return "bullish";
  } else if (avgChange < -2) {
    return "bearish";
  }
  return "neutral";
}

/**
 * Get comprehensive market sentiment data
 *
 * Fetches ETH and BTC prices and calculates sentiment.
 * Results are cached for 5 seconds.
 */
export async function getMarketSentiment(): Promise<MarketSentimentData | null> {
  try {
    // Fetch both prices in parallel
    const [ethPrice, btcPrice] = await Promise.all([
      getEthPrice(),
      getBtcPrice(),
    ]);

    if (!ethPrice || !btcPrice) {
      logger.warn("Could not fetch market prices for sentiment");
      return null;
    }

    // Get 24h changes
    const [ethChange24h, btcChange24h] = await Promise.all([
      get24hChange(ETH_ASSET_ID),
      get24hChange(BTC_ASSET_ID),
    ]);

    // Update price objects with 24h change
    ethPrice.priceChange24h = ethChange24h;
    btcPrice.priceChange24h = btcChange24h;

    const sentiment = calculateSentiment(ethChange24h, btcChange24h);

    const sentimentData: MarketSentimentData = {
      sentiment,
      ethPrice,
      btcPrice,
      ethChange24h,
      btcChange24h,
      timestamp: new Date(),
    };

    // Store in database for historical analysis
    await storeMarketSentiment(sentimentData);

    return sentimentData;
  } catch (error) {
    logger.error({ error }, "Failed to calculate market sentiment");
    return null;
  }
}

/**
 * Store market sentiment in database for historical analysis
 */
async function storeMarketSentiment(data: MarketSentimentData): Promise<void> {
  const now = Date.now();

  try {
    await db.insert(marketSentiment).values([
      {
        asset: "ETH",
        price: data.ethPrice.price.toString(),
        priceChange24h: data.ethChange24h,
        timestamp: now,
      },
      {
        asset: "BTC",
        price: data.btcPrice.price.toString(),
        priceChange24h: data.btcChange24h,
        timestamp: now,
      },
    ]);
  } catch (error) {
    // Log but don't fail if DB write fails
    logger.debug({ error }, "Failed to store market sentiment");
  }
}

/**
 * Get market prices for multiple assets
 */
export async function getMarketPrices(
  assetIds: string[]
): Promise<Map<string, MarketPrice>> {
  const prices = await getLatestPrices(assetIds);
  const result = new Map<string, MarketPrice>();

  for (const [assetId, priceData] of Object.entries(prices)) {
    if (priceData) {
      result.set(assetId, toMarketPrice(priceData));
    }
  }

  return result;
}

/**
 * Clear price cache (useful for testing)
 */
export function clearPriceCache(): void {
  priceCache.clear();
}

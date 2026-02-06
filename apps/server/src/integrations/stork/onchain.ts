/**
 * Stork On-Chain Oracle Integration
 *
 * Reads price feeds directly from the Stork contract on Arc Testnet.
 * Provides on-chain price data for BTC, ETH, USDC, and other assets.
 *
 * Contract Address: 0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62
 * Explorer: https://testnet.arcscan.app/address/0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62
 */

import { getContract, type Address, encodePacked, keccak256 } from "viem";
import { getPublicClient } from "../chain/client";
import { logger } from "../../utils/logger";

// Stork contract address on Arc Testnet
export const STORK_CONTRACT_ADDRESS: Address = "0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62";

// Stork EVM Contract ABI (only what we need)
export const storkAbi = [
  {
    name: "getTemporalNumericValueV1",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "timestampNs", type: "uint64" },
          { name: "quantizedValue", type: "int192" },
          { name: "valueComputeAlgHash", type: "bytes32" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
          { name: "v", type: "uint8" },
        ],
      },
    ],
  },
  {
    name: "getTemporalNumericValueUnsafeV1",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "timestampNs", type: "uint64" },
          { name: "quantizedValue", type: "int192" },
          { name: "valueComputeAlgHash", type: "bytes32" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
          { name: "v", type: "uint8" },
        ],
      },
    ],
  },
  {
    name: "version",
    type: "function",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/**
 * Asset IDs as bytes32 (keccak256 hash of asset name)
 */
export const ASSET_IDS = {
  BTCUSD: keccak256(encodePacked(["string"], ["BTCUSD"])),
  ETHUSD: keccak256(encodePacked(["string"], ["ETHUSD"])),
  USDCUSD: keccak256(encodePacked(["string"], ["USDCUSD"])),
  XAUUSD: keccak256(encodePacked(["string"], ["XAUUSD"])),
  EURUSD: keccak256(encodePacked(["string"], ["EURUSD"])),
} as const;

/**
 * TemporalNumericValue returned from Stork contract
 */
export interface TemporalNumericValue {
  timestampNs: bigint;
  quantizedValue: bigint;
  valueComputeAlgHash: `0x${string}`;
  r: `0x${string}`;
  s: `0x${string}`;
  v: number;
}

/**
 * Parsed price data
 */
export interface OnChainPrice {
  asset: string;
  price: bigint; // In 6 decimals (USDC compatible)
  priceFloat: number;
  rawValue: bigint; // Original quantized value
  timestamp: Date;
  timestampNs: bigint;
}

/**
 * Get Stork contract instance
 */
export function getStorkContract() {
  return getContract({
    address: STORK_CONTRACT_ADDRESS,
    abi: storkAbi,
    client: getPublicClient(),
  });
}

/**
 * Convert asset name to bytes32 feed ID
 */
export function getAssetId(assetName: string): `0x${string}` {
  return keccak256(encodePacked(["string"], [assetName]));
}

/**
 * Read price from Stork contract (with staleness check)
 */
export async function readStorkPrice(
  assetId: `0x${string}`,
  assetName: string
): Promise<OnChainPrice | null> {
  try {
    const contract = getStorkContract();
    const result = await contract.read.getTemporalNumericValueV1([assetId]);

    return parseStorkValue(result as TemporalNumericValue, assetName);
  } catch (error) {
    logger.error({ assetName, assetId, error }, "Failed to read Stork price on-chain");
    return null;
  }
}

/**
 * Read price from Stork contract (without staleness check - faster)
 */
export async function readStorkPriceUnsafe(
  assetId: `0x${string}`,
  assetName: string
): Promise<OnChainPrice | null> {
  try {
    const contract = getStorkContract();
    const result = await contract.read.getTemporalNumericValueUnsafeV1([assetId]);

    return parseStorkValue(result as TemporalNumericValue, assetName);
  } catch (error) {
    logger.error({ assetName, assetId, error }, "Failed to read Stork price on-chain (unsafe)");
    return null;
  }
}

/**
 * Parse TemporalNumericValue to OnChainPrice
 */
function parseStorkValue(value: TemporalNumericValue, assetName: string): OnChainPrice {
  // Stork quantizedValue is in 18 decimals
  // Convert to 6 decimals for USDC compatibility
  const price = value.quantizedValue / BigInt(10 ** 12);
  const priceFloat = Number(value.quantizedValue) / 10 ** 18;

  // Convert nanoseconds to Date
  const timestampMs = Number(value.timestampNs / BigInt(1_000_000));
  const timestamp = new Date(timestampMs);

  return {
    asset: assetName,
    price,
    priceFloat,
    rawValue: value.quantizedValue,
    timestamp,
    timestampNs: value.timestampNs,
  };
}

/**
 * Get BTC/USD price from on-chain Stork contract
 */
export async function getOnChainBtcPrice(): Promise<OnChainPrice | null> {
  return readStorkPrice(ASSET_IDS.BTCUSD, "BTCUSD");
}

/**
 * Get ETH/USD price from on-chain Stork contract
 */
export async function getOnChainEthPrice(): Promise<OnChainPrice | null> {
  return readStorkPrice(ASSET_IDS.ETHUSD, "ETHUSD");
}

/**
 * Get USDC/USD price from on-chain Stork contract
 */
export async function getOnChainUsdcPrice(): Promise<OnChainPrice | null> {
  return readStorkPrice(ASSET_IDS.USDCUSD, "USDCUSD");
}

/**
 * Get multiple prices from on-chain Stork contract in parallel
 */
export async function getOnChainPrices(
  assets: Array<{ name: string; id: `0x${string}` }>
): Promise<Map<string, OnChainPrice>> {
  const results = await Promise.allSettled(
    assets.map((asset) => readStorkPrice(asset.id, asset.name))
  );

  const prices = new Map<string, OnChainPrice>();

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value) {
      prices.set(assets[i].name, result.value);
    }
  }

  return prices;
}

/**
 * Get Stork contract version
 */
export async function getStorkVersion(): Promise<string> {
  try {
    const contract = getStorkContract();
    return await contract.read.version();
  } catch (error) {
    logger.error({ error }, "Failed to read Stork contract version");
    return "unknown";
  }
}

/**
 * Check if Stork contract is accessible
 */
export async function checkStorkContractHealth(): Promise<boolean> {
  try {
    await getStorkVersion();
    return true;
  } catch {
    return false;
  }
}

/**
 * Chain Event Watchers
 *
 * Provides event listeners for on-chain events using eth_getLogs-based polling.
 * This avoids eth_newFilter/eth_getFilterChanges which many RPC nodes (including
 * Arc Testnet) don't support reliably — filters expire causing "filter not found" errors.
 * Each watcher returns an unwatch function for cleanup.
 * Errors are deduplicated to avoid log spam when RPC is down.
 */

import type { Address, Log, Abi } from "viem";
import { getPublicClient } from "./client";
import { bondingCurveAbi, creatorFactoryAbi } from "./abis";
import { addresses } from "./contracts";
import { logger } from "../../utils/logger";

// ============================================
// Error Deduplication
// ============================================

const lastErrorByKey = new Map<string, number>();
const ERROR_COOLDOWN_MS = 60_000; // Only log same error once per minute

function shouldLogError(key: string): boolean {
  const now = Date.now();
  const lastTime = lastErrorByKey.get(key);
  if (lastTime && now - lastTime < ERROR_COOLDOWN_MS) {
    return false;
  }
  lastErrorByKey.set(key, now);
  return true;
}

// ============================================
// eth_getLogs-based Polling (replaces filter-based watchContractEvent)
// ============================================

const POLL_INTERVAL_MS = 4_000; // Poll every 4 seconds

interface PollContractEventsOptions {
  address: Address;
  abi: Abi;
  eventName: string;
  onLogs: (logs: Array<Log & { args: Record<string, unknown> }>) => void;
  onError: (error: Error) => void;
  pollInterval?: number;
}

/**
 * Poll for contract events using getContractEvents (eth_getLogs).
 * This is stateless and doesn't rely on server-side filter persistence.
 * Returns an unwatch function to stop polling.
 */
function pollContractEvents(options: PollContractEventsOptions): () => void {
  const {
    address,
    abi,
    eventName,
    onLogs,
    onError,
    pollInterval = POLL_INTERVAL_MS,
  } = options;
  const client = getPublicClient();
  let lastBlock: bigint | null = null;
  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  async function poll() {
    if (stopped) return;
    try {
      const currentBlock = await client.getBlockNumber();

      // On first poll, just record the current block — don't fetch historical events
      if (lastBlock === null) {
        lastBlock = currentBlock;
        return;
      }

      // No new blocks since last poll
      if (currentBlock <= lastBlock) return;

      const fromBlock = lastBlock + 1n;
      const logs = await client.getContractEvents({
        address,
        abi,
        eventName,
        fromBlock,
        toBlock: currentBlock,
      });

      lastBlock = currentBlock;

      if (logs.length > 0) {
        onLogs(logs as unknown as Array<Log & { args: Record<string, unknown> }>);
      }
    } catch (error) {
      onError(error as Error);
    } finally {
      if (!stopped) {
        timeoutId = setTimeout(poll, pollInterval);
      }
    }
  }

  // Start the first poll
  poll();

  // Return unwatch function
  return () => {
    stopped = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  };
}

// ============================================
// Event Types
// ============================================

export interface TokensPurchasedEvent {
  buyer: Address;
  usdcIn: bigint;
  tokensOut: bigint;
  newPrice: bigint;
}

export interface TokensSoldEvent {
  seller: Address;
  tokensIn: bigint;
  usdcOut: bigint;
  newPrice: bigint;
}

export interface RevenueAddedEvent {
  amount: bigint;
  newRevenuePerToken: bigint;
}

export interface RevenueClaimedEvent {
  user: Address;
  amount: bigint;
}

export interface CreatorDeployedEvent {
  wallet: Address;
  token: Address;
  bondingCurve: Address;
  name: string;
  symbol: string;
}

// ============================================
// Bonding Curve Event Watchers
// ============================================

export interface BondingCurveEventCallbacks {
  onPurchase?: (event: TokensPurchasedEvent, log: Log) => void;
  onSale?: (event: TokensSoldEvent, log: Log) => void;
  onRevenueAdded?: (event: RevenueAddedEvent, log: Log) => void;
  onRevenueClaimed?: (event: RevenueClaimedEvent, log: Log) => void;
}

/**
 * Watch events from a specific bonding curve contract
 *
 * @param bondingCurveAddress - The bonding curve contract address
 * @param callbacks - Event handler callbacks
 * @returns Unwatch function to stop listening
 */
export function watchBondingCurveEvents(
  bondingCurveAddress: Address,
  callbacks: BondingCurveEventCallbacks
): () => void {
  const unwatchers: Array<() => void> = [];
  const addrShort = bondingCurveAddress.slice(0, 10);

  // Watch TokensPurchased
  if (callbacks.onPurchase) {
    const unwatch = pollContractEvents({
      address: bondingCurveAddress,
      abi: bondingCurveAbi as Abi,
      eventName: "TokensPurchased",
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as {
            buyer: Address;
            usdcIn: bigint;
            tokensOut: bigint;
            newPrice: bigint;
          };
          logger.debug(
            { event: "TokensPurchased", address: addrShort, args },
            "Bonding curve purchase event"
          );
          callbacks.onPurchase!(
            {
              buyer: args.buyer,
              usdcIn: args.usdcIn,
              tokensOut: args.tokensOut,
              newPrice: args.newPrice,
            },
            log
          );
        }
      },
      onError: (error) => {
        const key = `TokensPurchased:${addrShort}`;
        if (shouldLogError(key)) {
          logger.warn(
            { event: "TokensPurchased", address: addrShort, error: error.message },
            "Event watcher error (will retry automatically)"
          );
        }
      },
    });
    unwatchers.push(unwatch);
  }

  // Watch TokensSold
  if (callbacks.onSale) {
    const unwatch = pollContractEvents({
      address: bondingCurveAddress,
      abi: bondingCurveAbi as Abi,
      eventName: "TokensSold",
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as {
            seller: Address;
            tokensIn: bigint;
            usdcOut: bigint;
            newPrice: bigint;
          };
          logger.debug(
            { event: "TokensSold", address: addrShort, args },
            "Bonding curve sale event"
          );
          callbacks.onSale!(
            {
              seller: args.seller,
              tokensIn: args.tokensIn,
              usdcOut: args.usdcOut,
              newPrice: args.newPrice,
            },
            log
          );
        }
      },
      onError: (error) => {
        const key = `TokensSold:${addrShort}`;
        if (shouldLogError(key)) {
          logger.warn(
            { event: "TokensSold", address: addrShort, error: error.message },
            "Event watcher error (will retry automatically)"
          );
        }
      },
    });
    unwatchers.push(unwatch);
  }

  // Watch RevenueAdded
  if (callbacks.onRevenueAdded) {
    const unwatch = pollContractEvents({
      address: bondingCurveAddress,
      abi: bondingCurveAbi as Abi,
      eventName: "RevenueAdded",
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as {
            amount: bigint;
            newRevenuePerToken: bigint;
          };
          logger.debug(
            { event: "RevenueAdded", address: addrShort, args },
            "Revenue added event"
          );
          callbacks.onRevenueAdded!(
            {
              amount: args.amount,
              newRevenuePerToken: args.newRevenuePerToken,
            },
            log
          );
        }
      },
      onError: (error) => {
        const key = `RevenueAdded:${addrShort}`;
        if (shouldLogError(key)) {
          logger.warn(
            { event: "RevenueAdded", address: addrShort, error: error.message },
            "Event watcher error (will retry automatically)"
          );
        }
      },
    });
    unwatchers.push(unwatch);
  }

  // Watch RevenueClaimed
  if (callbacks.onRevenueClaimed) {
    const unwatch = pollContractEvents({
      address: bondingCurveAddress,
      abi: bondingCurveAbi as Abi,
      eventName: "RevenueClaimed",
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as {
            user: Address;
            amount: bigint;
          };
          logger.debug(
            { event: "RevenueClaimed", address: addrShort, args },
            "Revenue claimed event"
          );
          callbacks.onRevenueClaimed!(
            {
              user: args.user,
              amount: args.amount,
            },
            log
          );
        }
      },
      onError: (error) => {
        const key = `RevenueClaimed:${addrShort}`;
        if (shouldLogError(key)) {
          logger.warn(
            { event: "RevenueClaimed", address: addrShort, error: error.message },
            "Event watcher error (will retry automatically)"
          );
        }
      },
    });
    unwatchers.push(unwatch);
  }

  logger.info(
    {
      address: addrShort,
      events: Object.keys(callbacks).filter(
        (k) => callbacks[k as keyof BondingCurveEventCallbacks]
      ),
    },
    "Started watching bonding curve events"
  );

  // Return combined unwatch function
  return () => {
    for (const unwatch of unwatchers) {
      unwatch();
    }
    logger.info(
      { address: addrShort },
      "Stopped watching bonding curve events"
    );
  };
}

// ============================================
// Creator Factory Event Watcher
// ============================================

/**
 * Watch for new creator deployments from the CreatorFactory
 *
 * @param onNewCreator - Callback when a new creator is deployed
 * @returns Unwatch function to stop listening
 */
export function watchCreatorFactory(
  onNewCreator: (event: CreatorDeployedEvent, log: Log) => void
): () => void {
  const unwatch = pollContractEvents({
    address: addresses.creatorFactory,
    abi: creatorFactoryAbi as Abi,
    eventName: "CreatorDeployed",
    onLogs: (logs) => {
      for (const log of logs) {
        const args = log.args as {
          wallet: Address;
          token: Address;
          bondingCurve: Address;
          name: string;
          symbol: string;
        };
        logger.info(
          { event: "CreatorDeployed", args },
          "New creator deployed"
        );
        onNewCreator(
          {
            wallet: args.wallet,
            token: args.token,
            bondingCurve: args.bondingCurve,
            name: args.name,
            symbol: args.symbol,
          },
          log
        );
      }
    },
    onError: (error) => {
      if (shouldLogError("CreatorDeployed")) {
        logger.warn(
          { event: "CreatorDeployed", error: error.message },
          "Factory watcher error (will retry automatically)"
        );
      }
    },
  });

  logger.info(
    { factory: addresses.creatorFactory.slice(0, 10) },
    "Started watching creator factory events"
  );

  return () => {
    unwatch();
    logger.info("Stopped watching creator factory events");
  };
}

// ============================================
// Multi-Curve Event Aggregator
// ============================================

/**
 * Watch events from multiple bonding curves at once
 * Useful for monitoring all creators an agent holds tokens in
 *
 * @param bondingCurveAddresses - Array of bonding curve addresses
 * @param callbacks - Event handler callbacks (receive address as first param)
 * @returns Unwatch function to stop all listeners
 */
export function watchMultipleBondingCurves(
  bondingCurveAddresses: Address[],
  callbacks: {
    onPurchase?: (address: Address, event: TokensPurchasedEvent, log: Log) => void;
    onSale?: (address: Address, event: TokensSoldEvent, log: Log) => void;
    onRevenueAdded?: (address: Address, event: RevenueAddedEvent, log: Log) => void;
    onRevenueClaimed?: (address: Address, event: RevenueClaimedEvent, log: Log) => void;
  }
): () => void {
  const unwatchers: Array<() => void> = [];

  for (const address of bondingCurveAddresses) {
    const unwatch = watchBondingCurveEvents(address, {
      onPurchase: callbacks.onPurchase
        ? (event, log) => callbacks.onPurchase!(address, event, log)
        : undefined,
      onSale: callbacks.onSale
        ? (event, log) => callbacks.onSale!(address, event, log)
        : undefined,
      onRevenueAdded: callbacks.onRevenueAdded
        ? (event, log) => callbacks.onRevenueAdded!(address, event, log)
        : undefined,
      onRevenueClaimed: callbacks.onRevenueClaimed
        ? (event, log) => callbacks.onRevenueClaimed!(address, event, log)
        : undefined,
    });
    unwatchers.push(unwatch);
  }

  return () => {
    for (const unwatch of unwatchers) {
      unwatch();
    }
    logger.info(
      { count: bondingCurveAddresses.length },
      "Stopped watching multiple bonding curves"
    );
  };
}

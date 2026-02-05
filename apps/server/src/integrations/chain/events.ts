/**
 * Chain Event Watchers
 *
 * Provides event listeners for on-chain events using viem's watchContractEvent.
 * Each watcher returns an unwatch function for cleanup.
 */

import type { Address, Log } from "viem";
import { getPublicClient } from "./client";
import { bondingCurveAbi, creatorFactoryAbi } from "./abis";
import { addresses } from "./contracts";
import { logger } from "../../utils/logger";

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
  const client = getPublicClient();
  const unwatchers: Array<() => void> = [];

  // Watch TokensPurchased
  if (callbacks.onPurchase) {
    const unwatch = client.watchContractEvent({
      address: bondingCurveAddress,
      abi: bondingCurveAbi,
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
            { event: "TokensPurchased", address: bondingCurveAddress, args },
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
        logger.error(
          { error, event: "TokensPurchased", address: bondingCurveAddress },
          "Error watching TokensPurchased"
        );
      },
    });
    unwatchers.push(unwatch);
  }

  // Watch TokensSold
  if (callbacks.onSale) {
    const unwatch = client.watchContractEvent({
      address: bondingCurveAddress,
      abi: bondingCurveAbi,
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
            { event: "TokensSold", address: bondingCurveAddress, args },
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
        logger.error(
          { error, event: "TokensSold", address: bondingCurveAddress },
          "Error watching TokensSold"
        );
      },
    });
    unwatchers.push(unwatch);
  }

  // Watch RevenueAdded
  if (callbacks.onRevenueAdded) {
    const unwatch = client.watchContractEvent({
      address: bondingCurveAddress,
      abi: bondingCurveAbi,
      eventName: "RevenueAdded",
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as {
            amount: bigint;
            newRevenuePerToken: bigint;
          };
          logger.debug(
            { event: "RevenueAdded", address: bondingCurveAddress, args },
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
        logger.error(
          { error, event: "RevenueAdded", address: bondingCurveAddress },
          "Error watching RevenueAdded"
        );
      },
    });
    unwatchers.push(unwatch);
  }

  // Watch RevenueClaimed
  if (callbacks.onRevenueClaimed) {
    const unwatch = client.watchContractEvent({
      address: bondingCurveAddress,
      abi: bondingCurveAbi,
      eventName: "RevenueClaimed",
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as {
            user: Address;
            amount: bigint;
          };
          logger.debug(
            { event: "RevenueClaimed", address: bondingCurveAddress, args },
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
        logger.error(
          { error, event: "RevenueClaimed", address: bondingCurveAddress },
          "Error watching RevenueClaimed"
        );
      },
    });
    unwatchers.push(unwatch);
  }

  logger.info(
    {
      address: bondingCurveAddress,
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
      { address: bondingCurveAddress },
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
  const client = getPublicClient();

  const unwatch = client.watchContractEvent({
    address: addresses.creatorFactory,
    abi: creatorFactoryAbi,
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
      logger.error(
        { error, event: "CreatorDeployed" },
        "Error watching CreatorDeployed"
      );
    },
  });

  logger.info(
    { factory: addresses.creatorFactory },
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

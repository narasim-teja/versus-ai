/**
 * Nitrolite State Channel Lifecycle
 *
 * Opens and closes on-chain state channels via the Custody contract
 * on Base Sepolia. The server deposits testnet USDC on behalf of the
 * viewer at session start, and closes + withdraws at session end.
 *
 * Two-step flow for channel creation:
 * 1. Server prepares the channel state → sends packed state to browser
 * 2. Browser signs with ephemeral key → server opens channel with both sigs
 *
 * All calls are gracefully degraded — if on-chain fails, the streaming
 * session continues via ClearNode only.
 */

import type { Address, Hex } from "viem";
import { parseUnits } from "viem";
import {
  StateIntent,
  getChannelId,
  getPackedState,
  type Channel,
  type UnsignedState,
  type Allocation,
} from "@erc7824/nitrolite";
import { getNitroliteClient } from "./client";
import { baseSepolia } from "../chain/base-client";
import { env } from "../../utils/env";
import { logger } from "../../utils/logger";

// ─── Types ────────────────────────────────────────────────────────────

export interface ChannelOpenResult {
  channelId: Hex;
  txHash: Hex;
}

export interface ChannelCloseResult {
  closeTxHash: Hex | null;
  withdrawTxHash: Hex | null;
}

export interface PreparedChannel {
  channel: Channel;
  unsignedInitialState: UnsignedState;
  channelId: Hex;
  packedStateHex: Hex;
  depositAmount: string;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Step 1: Prepare the custody channel state for the viewer to co-sign.
 *
 * Computes channel parameters, channelId, and the packed state hash.
 * The packed state hash is sent to the browser for the ephemeral key to sign.
 */
export function prepareCustodyChannel(
  viewerAddress: Address,
  depositAmount: string,
): PreparedChannel | null {
  const client = getNitroliteClient();
  if (!client) return null;

  const usdcAddress = env.BASE_SEPOLIA_USDC_ADDRESS as Address;
  const amount = parseUnits(depositAmount, 6); // USDC has 6 decimals
  const serverAddress = client.account.address;
  const adjudicatorAddress = env.NITROLITE_ADJUDICATOR_ADDRESS as Address;

  const channel: Channel = {
    participants: [serverAddress, viewerAddress],
    adjudicator: adjudicatorAddress,
    challenge: 3600n, // 1 hour (matches NitroliteClient config)
    nonce: BigInt(Date.now()),
  };

  // Both allocations start at 0 — the Custody contract checks per-participant
  // deposits against allocations. Only the server deposits, so only the server
  // has an internal balance. The deposit itself proves funds are escrowed;
  // ClearNode tracks the actual micropayment allocations off-chain.
  const initialAllocations: Allocation[] = [
    { destination: serverAddress, token: usdcAddress, amount: 0n },
    { destination: viewerAddress, token: usdcAddress, amount: 0n },
  ];

  const unsignedInitialState: UnsignedState = {
    intent: StateIntent.INITIALIZE,
    version: 0n,
    data: "0x" as Hex,
    allocations: initialAllocations,
  };

  const channelId = getChannelId(channel, baseSepolia.id);
  const packedStateHex = getPackedState(channelId, unsignedInitialState);

  logger.info(
    { channelId, viewerAddress, amount: depositAmount },
    "Custody channel state prepared for viewer signing",
  );

  return { channel, unsignedInitialState, channelId, packedStateHex, depositAmount };
}

/**
 * Step 2: Open the custody channel using the viewer's co-signature.
 *
 * Deposits USDC into Custody and creates the on-chain channel using
 * both the server's signature (via stateSigner) and the viewer's
 * ephemeral key signature.
 */
export async function openCustodyChannel(
  prepared: PreparedChannel,
  viewerSignature: Hex,
): Promise<ChannelOpenResult | null> {
  const client = getNitroliteClient();
  if (!client) return null;

  const usdcAddress = env.BASE_SEPOLIA_USDC_ADDRESS as Address;
  const amount = parseUnits(prepared.depositAmount, 6);

  try {
    // Ensure Custody has USDC allowance
    const allowance = await client.getTokenAllowance(usdcAddress);
    if (allowance < amount) {
      const approveTxHash = await client.approveTokens(usdcAddress, amount * 10n);
      logger.info({ approveTxHash, amount: prepared.depositAmount }, "USDC approved for Custody");
    }

    // depositAndCreateChannel: SDK signs with server key (sigs[0]),
    // viewerSignature is the counterparty co-signature (sigs[1])
    const { channelId, txHash } = await client.depositAndCreateChannel(
      usdcAddress,
      amount,
      {
        channel: prepared.channel,
        unsignedInitialState: prepared.unsignedInitialState,
        serverSignature: viewerSignature,
      },
    );

    logger.info(
      {
        channelId,
        txHash,
        amount: prepared.depositAmount,
        custody: env.NITROLITE_CUSTODY_ADDRESS,
      },
      "Nitrolite state channel opened with USDC deposit",
    );

    return { channelId, txHash };
  } catch (err) {
    logger.error(
      { err, amount: prepared.depositAmount },
      "Failed to open Custody channel",
    );
    return null;
  }
}

/**
 * Compute the packed close state hash for a channel.
 * The browser signs this hash so the server can cooperatively close on-chain.
 */
export function computeCloseStateHash(
  channelId: Hex,
  serverAddress: Address,
  viewerAddress: Address,
): Hex {
  const usdcAddress = env.BASE_SEPOLIA_USDC_ADDRESS as Address;

  const closeState: UnsignedState = {
    intent: StateIntent.FINALIZE,
    version: 1n,
    data: "0x" as Hex,
    allocations: [
      { destination: serverAddress, token: usdcAddress, amount: 0n },
      { destination: viewerAddress, token: usdcAddress, amount: 0n },
    ],
  };

  return getPackedState(channelId, closeState);
}

/**
 * Close a state channel and withdraw earned funds from Custody.
 * Requires the viewer's co-signature on the close state.
 */
export async function closeCustodyChannel(
  channelId: Hex,
  viewerAddress: Address,
  viewerFinalBalance: string,
  serverFinalBalance: string,
  viewerCloseSignature?: Hex,
): Promise<ChannelCloseResult> {
  const client = getNitroliteClient();
  if (!client) return { closeTxHash: null, withdrawTxHash: null };

  const usdcAddress = env.BASE_SEPOLIA_USDC_ADDRESS as Address;
  const serverAddress = client.account.address;
  const serverAmount = parseUnits(serverFinalBalance, 6);
  const viewerAmount = parseUnits(viewerFinalBalance, 6);

  let closeTxHash: Hex | null = null;
  let withdrawTxHash: Hex | null = null;

  // Cooperative close — requires both participants' signatures
  if (viewerCloseSignature) {
    try {
      const finalAllocations: Allocation[] = [
        { destination: serverAddress, token: usdcAddress, amount: 0n },
        { destination: viewerAddress, token: usdcAddress, amount: 0n },
      ];

      closeTxHash = await client.closeChannel({
        stateData: "0x" as Hex,
        finalState: {
          channelId,
          intent: StateIntent.FINALIZE,
          data: "0x" as Hex,
          allocations: finalAllocations,
          version: 1n,
          serverSignature: viewerCloseSignature,
        },
      });

      logger.info({ channelId, closeTxHash }, "Nitrolite channel closed on-chain");
    } catch (err) {
      logger.error({ err, channelId }, "Failed to close Custody channel");
    }
  } else {
    logger.warn({ channelId }, "No viewer close signature — skipping channel close");
  }

  // Withdraw the deposit from Custody (server's general balance)
  const totalDeposited = serverAmount + viewerAmount;
  try {
    if (totalDeposited > 0n) {
      withdrawTxHash = await client.withdrawal(usdcAddress, totalDeposited);
      logger.info(
        { withdrawTxHash, amount: totalDeposited.toString() },
        "Funds withdrawn from Custody",
      );
    }
  } catch (err) {
    logger.error({ err, channelId }, "Failed to withdraw from Custody");
  }

  return { closeTxHash, withdrawTxHash };
}

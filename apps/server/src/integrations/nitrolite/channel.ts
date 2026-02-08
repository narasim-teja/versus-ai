/**
 * Nitrolite State Channel Lifecycle
 *
 * Opens and closes on-chain state channels via the Custody contract
 * on Base Sepolia. The server deposits testnet USDC on behalf of the
 * viewer at session start, and closes + withdraws at session end.
 *
 * All calls are gracefully degraded — if on-chain fails, the streaming
 * session continues via ClearNode only.
 */

import type { Address, Hex } from "viem";
import { parseUnits } from "viem";
import { StateIntent, type Channel, type UnsignedState, type Allocation } from "@erc7824/nitrolite";
import { getNitroliteClient } from "./client";
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

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Deposit USDC into Custody and open a state channel for a streaming session.
 *
 * The server deposits on behalf of the viewer. Channel participants are
 * the server (depositor/host) and the viewer's ephemeral address (guest).
 */
export async function openCustodyChannel(
  viewerAddress: Address,
  depositAmount: string,
): Promise<ChannelOpenResult | null> {
  const client = getNitroliteClient();
  if (!client) return null;

  const usdcAddress = env.BASE_SEPOLIA_USDC_ADDRESS as Address;
  const amount = parseUnits(depositAmount, 6); // USDC has 6 decimals

  try {
    // Ensure Custody has USDC allowance
    const allowance = await client.getTokenAllowance(usdcAddress);
    if (allowance < amount) {
      const approveTxHash = await client.approveTokens(usdcAddress, amount * 10n);
      logger.info({ approveTxHash, amount: depositAmount }, "USDC approved for Custody");
    }

    const serverAddress = client.account.address;
    const adjudicatorAddress = (env.NITROLITE_ADJUDICATOR_ADDRESS) as Address;

    const channel: Channel = {
      participants: [serverAddress, viewerAddress],
      adjudicator: adjudicatorAddress,
      challenge: 3600n, // 1 hour (matches NitroliteClient config)
      nonce: BigInt(Date.now()),
    };

    const initialAllocations: Allocation[] = [
      { destination: serverAddress, token: usdcAddress, amount },
      { destination: viewerAddress, token: usdcAddress, amount: 0n },
    ];

    const unsignedInitialState: UnsignedState = {
      intent: StateIntent.INITIALIZE,
      version: 0n,
      data: "0x" as Hex,
      allocations: initialAllocations,
    };

    // depositAndCreateChannel handles: approve check, deposit, sign, create
    const { channelId, txHash } = await client.depositAndCreateChannel(
      usdcAddress,
      amount,
      {
        channel,
        unsignedInitialState,
        serverSignature: "0x" as Hex, // SDK signs internally via stateSigner
      },
    );

    logger.info(
      {
        channelId,
        txHash,
        viewerAddress,
        amount: depositAmount,
        custody: env.NITROLITE_CUSTODY_ADDRESS,
      },
      "Nitrolite state channel opened with USDC deposit",
    );

    return { channelId, txHash };
  } catch (err) {
    logger.error(
      { err, viewerAddress, amount: depositAmount },
      "Failed to open Custody channel (continuing with ClearNode-only)",
    );
    return null;
  }
}

/**
 * Close a state channel and withdraw earned funds from Custody.
 * Uses cooperative close (server signs final state).
 */
export async function closeCustodyChannel(
  channelId: Hex,
  viewerAddress: Address,
  viewerFinalBalance: string,
  serverFinalBalance: string,
): Promise<ChannelCloseResult> {
  const client = getNitroliteClient();
  if (!client) return { closeTxHash: null, withdrawTxHash: null };

  const usdcAddress = env.BASE_SEPOLIA_USDC_ADDRESS as Address;
  const serverAddress = client.account.address;
  const serverAmount = parseUnits(serverFinalBalance, 6);
  const viewerAmount = parseUnits(viewerFinalBalance, 6);

  let closeTxHash: Hex | null = null;
  let withdrawTxHash: Hex | null = null;

  try {
    const finalAllocations: Allocation[] = [
      { destination: serverAddress, token: usdcAddress, amount: serverAmount },
      { destination: viewerAddress, token: usdcAddress, amount: viewerAmount },
    ];

    closeTxHash = await client.closeChannel({
      finalState: {
        channelId,
        intent: StateIntent.FINALIZE,
        version: 1n,
        data: "0x" as Hex,
        allocations: finalAllocations,
        serverSignature: "0x" as Hex, // SDK signs internally via stateSigner
      },
    });

    logger.info({ channelId, closeTxHash }, "Nitrolite channel closed on-chain");
  } catch (err) {
    logger.error({ err, channelId }, "Failed to close Custody channel");
  }

  // Withdraw server's earnings from Custody
  try {
    if (serverAmount > 0n) {
      withdrawTxHash = await client.withdrawal(usdcAddress, serverAmount);
      logger.info(
        { withdrawTxHash, amount: serverFinalBalance },
        "Funds withdrawn from Custody",
      );
    }
  } catch (err) {
    logger.error({ err, channelId }, "Failed to withdraw from Custody");
  }

  return { closeTxHash, withdrawTxHash };
}

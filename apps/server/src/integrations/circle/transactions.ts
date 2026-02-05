/**
 * Circle Transaction Execution Module
 *
 * Implements smart contract execution via Circle Developer-Controlled Wallets.
 * Used by agents to execute on-chain transactions (buy, sell, approve, etc.)
 */

import { randomUUID } from "crypto";
import { getCircleClient } from "./client";
import { logger } from "../../utils/logger";
import type {
  ContractExecutionParams,
  TransactionResult,
  TransactionDetails,
  FeeLevel,
} from "./types";

const BLOCKCHAIN = "ARC-TESTNET";
const DEFAULT_FEE_LEVEL: FeeLevel = "MEDIUM";
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

/**
 * Execute a smart contract call via Circle
 */
export async function executeContractCall(
  params: ContractExecutionParams
): Promise<TransactionResult> {
  const circleClient = getCircleClient();
  const idempotencyKey = randomUUID();

  logger.info(
    {
      walletId: params.walletId,
      contractAddress: params.contractAddress,
      abiFunctionSignature: params.abiFunctionSignature,
      abiParameters: params.abiParameters,
      idempotencyKey,
    },
    "Executing contract call via Circle"
  );

  try {
    const response = await circleClient.createContractExecutionTransaction({
      idempotencyKey,
      walletId: params.walletId,
      contractAddress: params.contractAddress,
      abiFunctionSignature: params.abiFunctionSignature,
      abiParameters: params.abiParameters,
      amount: params.amount,
      refId: params.refId,
      fee: {
        type: "level",
        config: {
          feeLevel: params.feeLevel || DEFAULT_FEE_LEVEL,
        },
      },
    });

    if (!response.data) {
      throw new Error("No response data from Circle contract execution");
    }

    const result: TransactionResult = {
      id: response.data.id,
      state: response.data.state as TransactionResult["state"],
      // txHash is not available immediately - need to poll getTransaction
    };

    logger.info(
      {
        transactionId: result.id,
        state: result.state,
      },
      "Contract execution transaction created"
    );

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        walletId: params.walletId,
        contractAddress: params.contractAddress,
        error: errorMessage,
      },
      "Failed to execute contract call"
    );
    throw error;
  }
}

/**
 * Get the status of a transaction
 */
export async function getTransactionStatus(
  transactionId: string
): Promise<TransactionDetails> {
  const circleClient = getCircleClient();

  try {
    const response = await circleClient.getTransaction({
      id: transactionId,
    });

    if (!response.data?.transaction) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    const tx = response.data.transaction;

    return {
      id: tx.id,
      state: tx.state as TransactionDetails["state"],
      txHash: tx.txHash,
      walletId: tx.walletId || "",
      blockchain: tx.blockchain || BLOCKCHAIN,
      contractAddress: tx.contractAddress,
      sourceAddress: tx.sourceAddress,
      destinationAddress: tx.destinationAddress,
      operation: tx.operation as TransactionDetails["operation"],
      createDate: tx.createDate,
      updateDate: tx.updateDate,
      errorReason: tx.errorReason,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      { transactionId, error: errorMessage },
      "Failed to get transaction status"
    );
    throw error;
  }
}

/**
 * Wait for a transaction to be confirmed
 */
export async function waitForConfirmation(
  transactionId: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS
): Promise<TransactionDetails> {
  const startTime = Date.now();

  logger.info(
    { transactionId, timeoutMs, pollIntervalMs },
    "Waiting for transaction confirmation"
  );

  while (Date.now() - startTime < timeoutMs) {
    const status = await getTransactionStatus(transactionId);

    logger.debug(
      { transactionId, state: status.state, txHash: status.txHash },
      "Transaction status poll"
    );

    // Terminal success states
    if (status.state === "COMPLETE" || status.state === "CONFIRMED") {
      logger.info(
        { transactionId, state: status.state, txHash: status.txHash },
        "Transaction confirmed"
      );
      return status;
    }

    // Terminal failure states
    if (
      status.state === "FAILED" ||
      status.state === "CANCELLED" ||
      status.state === "DENIED"
    ) {
      const error = new Error(
        `Transaction ${status.state}: ${transactionId}${status.errorReason ? ` - ${status.errorReason}` : ""}`
      );
      logger.error(
        {
          transactionId,
          state: status.state,
          errorReason: status.errorReason,
        },
        "Transaction failed"
      );
      throw error;
    }

    // Still pending, wait and retry
    await sleep(pollIntervalMs);
  }

  // Timeout reached
  const error = new Error(`Transaction timeout after ${timeoutMs}ms: ${transactionId}`);
  logger.error({ transactionId, timeoutMs }, "Transaction confirmation timeout");
  throw error;
}

/**
 * Execute a contract call and wait for confirmation
 */
export async function executeAndConfirm(
  params: ContractExecutionParams,
  timeoutMs?: number
): Promise<TransactionDetails> {
  const result = await executeContractCall(params);
  return waitForConfirmation(result.id, timeoutMs);
}

/**
 * List recent transactions for a wallet
 */
export async function listWalletTransactions(
  walletId: string,
  options?: {
    pageSize?: number;
    operation?: "CONTRACT_EXECUTION" | "TRANSFER";
  }
): Promise<TransactionDetails[]> {
  const circleClient = getCircleClient();

  try {
    const response = await circleClient.listTransactions({
      walletIds: [walletId],
      blockchain: BLOCKCHAIN,
      pageSize: options?.pageSize || 10,
      operation: options?.operation,
    });

    if (!response.data?.transactions) {
      return [];
    }

    return response.data.transactions.map((tx) => ({
      id: tx.id,
      state: tx.state as TransactionDetails["state"],
      txHash: tx.txHash,
      walletId: tx.walletId || walletId,
      blockchain: tx.blockchain || BLOCKCHAIN,
      contractAddress: tx.contractAddress,
      sourceAddress: tx.sourceAddress,
      destinationAddress: tx.destinationAddress,
      operation: tx.operation as TransactionDetails["operation"],
      createDate: tx.createDate,
      updateDate: tx.updateDate,
      errorReason: tx.errorReason,
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ walletId, error: errorMessage }, "Failed to list transactions");
    return [];
  }
}

/**
 * Helper function to sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

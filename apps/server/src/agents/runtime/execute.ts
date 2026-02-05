/**
 * Action Executor
 *
 * Executes agent actions via Circle Developer-Controlled Wallets.
 * Handles approvals, contract calls, and transaction tracking.
 */

import type { Address } from "viem";
import { eq, and } from "drizzle-orm";
import { getPublicClient } from "../../integrations/chain/client";
import { erc20Abi } from "../../integrations/chain/abis";
import { addresses, getBondingCurve } from "../../integrations/chain/contracts";
import {
  executeContractCall,
  waitForConfirmation,
} from "../../integrations/circle/transactions";
import { db } from "../../db/client";
import { holdings } from "../../db/schema";
import { logger } from "../../utils/logger";
import type {
  Action,
  AgentConfig,
  BuyTokenParams,
  SellTokenParams,
  RepayParams,
  ClaimRevenueParams,
  BorrowParams,
  DepositCollateralParams,
  WithdrawCollateralParams,
} from "../types";

const MAX_UINT256 = BigInt(
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
);

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Sleep helper for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with exponential backoff retry
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  context: string,
  maxRetries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on certain errors (user rejection, insufficient funds, etc.)
      const errorMessage = lastError.message.toLowerCase();
      if (
        errorMessage.includes("insufficient") ||
        errorMessage.includes("rejected") ||
        errorMessage.includes("denied") ||
        errorMessage.includes("reverted")
      ) {
        logger.warn(
          { context, error: lastError.message, attempt },
          "Non-retryable error, not retrying"
        );
        throw lastError;
      }

      if (attempt < maxRetries) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          { context, error: lastError.message, attempt, nextRetryMs: delayMs },
          "Retrying after error"
        );
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

export interface ExecutionResult {
  action: Action;
  success: boolean;
  transactionId?: string;
  txHash?: string;
  error?: string;
  approvalTxHash?: string;
}

/**
 * Execute all actions for an agent cycle
 */
export async function executeActions(
  actions: Action[],
  config: AgentConfig
): Promise<ExecutionResult[]> {
  if (!config.circleWalletId) {
    logger.error({ agentId: config.id }, "No Circle wallet ID configured");
    return actions.map((action) => ({
      action,
      success: false,
      error: "No Circle wallet ID configured",
    }));
  }

  const results: ExecutionResult[] = [];

  // Sort actions by priority (highest first)
  const sortedActions = [...actions].sort((a, b) => b.priority - a.priority);

  for (const action of sortedActions) {
    logger.info(
      {
        agentId: config.id,
        actionType: action.type,
        priority: action.priority,
        reason: action.reason,
      },
      "Executing action"
    );

    try {
      const result = await executeAction(action, config);
      results.push(result);

      if (!result.success) {
        logger.warn(
          {
            agentId: config.id,
            actionType: action.type,
            error: result.error,
          },
          "Action execution failed"
        );
      } else {
        logger.info(
          {
            agentId: config.id,
            actionType: action.type,
            txHash: result.txHash,
          },
          "Action executed successfully"
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          agentId: config.id,
          actionType: action.type,
          error: errorMessage,
        },
        "Action execution error"
      );

      results.push({
        action,
        success: false,
        error: errorMessage,
      });
    }
  }

  return results;
}

/**
 * Execute a single action
 */
async function executeAction(
  action: Action,
  config: AgentConfig
): Promise<ExecutionResult> {
  const walletId = config.circleWalletId!;
  const agentId = config.id;

  switch (action.type) {
    case "BUY_TOKEN":
      return executeBuyToken(action, walletId, config.evmAddress, agentId);

    case "SELL_TOKEN":
      return executeSellToken(action, walletId, config.evmAddress, agentId);

    case "CLAIM_REVENUE":
      return executeClaimRevenue(action, walletId);

    case "REPAY":
      return executeRepay(action, walletId, config.evmAddress);

    case "BORROW":
      return executeBorrow(action, walletId, config.evmAddress);

    case "DEPOSIT_COLLATERAL":
      return executeDepositCollateral(action, walletId, config.evmAddress);

    case "WITHDRAW_COLLATERAL":
      return executeWithdrawCollateral(action, walletId);

    default:
      return {
        action,
        success: false,
        error: `Unknown action type: ${action.type}`,
      };
  }
}

// Default slippage tolerance (1% = 100 basis points)
const DEFAULT_SLIPPAGE_BPS = 100;

/**
 * Execute BUY_TOKEN action
 * 1. Get quote from bonding curve for slippage protection
 * 2. Approve USDC spending on bonding curve
 * 3. Call bondingCurve.buy(usdcAmount, minTokensOut)
 * 4. Update holdings database
 */
async function executeBuyToken(
  action: Action,
  walletId: string,
  walletAddress: Address,
  agentId: string
): Promise<ExecutionResult> {
  const params = action.params as BuyTokenParams;

  // Step 1: Get quote for slippage protection
  let minTokensOut = params.minTokensOut;
  if (minTokensOut === BigInt(0)) {
    try {
      const bondingCurve = getBondingCurve(params.bondingCurveAddress);
      const expectedTokens = await bondingCurve.read.getBuyQuote([params.usdcAmount]);
      // Apply slippage tolerance (1%)
      minTokensOut = ((expectedTokens as bigint) * BigInt(10000 - DEFAULT_SLIPPAGE_BPS)) / BigInt(10000);
      logger.info(
        {
          usdcAmount: params.usdcAmount.toString(),
          expectedTokens: (expectedTokens as bigint).toString(),
          minTokensOut: minTokensOut.toString(),
        },
        "Buy quote fetched with slippage protection"
      );
    } catch (error) {
      logger.warn(
        { error, bondingCurve: params.bondingCurveAddress },
        "Failed to get buy quote, proceeding without slippage protection"
      );
    }
  }

  // Step 2: Ensure USDC approval
  const approvalResult = await ensureApproval(
    walletId,
    walletAddress,
    addresses.usdc as Address,
    params.bondingCurveAddress,
    params.usdcAmount
  );

  if (approvalResult && !approvalResult.success) {
    return {
      action,
      success: false,
      error: `Approval failed: ${approvalResult.error}`,
    };
  }

  // Step 3: Execute buy with retry
  try {
    const confirmed = await withRetry(
      async () => {
        const tx = await executeContractCall({
          walletId,
          contractAddress: params.bondingCurveAddress,
          abiFunctionSignature: "buy(uint256,uint256)",
          abiParameters: [params.usdcAmount.toString(), minTokensOut.toString()],
          refId: `buy-${params.tokenName}`,
        });
        return waitForConfirmation(tx.id);
      },
      `buy-${params.tokenName}`
    );

    // Step 4: Update holdings database (best effort, don't fail the action)
    // Use minTokensOut as estimate since we don't have exact tokens received
    await updateHoldingsAfterBuy(
      agentId,
      params.tokenAddress,
      params.tokenName,
      params.usdcAmount,
      minTokensOut
    );

    return {
      action,
      success: true,
      transactionId: confirmed.id,
      txHash: confirmed.txHash,
      approvalTxHash: approvalResult?.txHash,
    };
  } catch (error) {
    return {
      action,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      approvalTxHash: approvalResult?.txHash,
    };
  }
}

/**
 * Execute SELL_TOKEN action
 * 1. Get quote from bonding curve for slippage protection
 * 2. Approve token spending on bonding curve
 * 3. Call bondingCurve.sell(tokenAmount, minUsdcOut)
 * 4. Update holdings database
 */
async function executeSellToken(
  action: Action,
  walletId: string,
  walletAddress: Address,
  agentId: string
): Promise<ExecutionResult> {
  const params = action.params as SellTokenParams;

  // Step 1: Get quote for slippage protection if not provided
  let minUsdcOut = params.minUsdcOut;
  if (minUsdcOut === BigInt(0)) {
    try {
      const bondingCurve = getBondingCurve(params.bondingCurveAddress);
      const expectedUsdc = await bondingCurve.read.getSellQuote([params.tokenAmount]);
      // Apply slippage tolerance (1%)
      minUsdcOut = ((expectedUsdc as bigint) * BigInt(10000 - DEFAULT_SLIPPAGE_BPS)) / BigInt(10000);
      logger.info(
        {
          tokenAmount: params.tokenAmount.toString(),
          expectedUsdc: (expectedUsdc as bigint).toString(),
          minUsdcOut: minUsdcOut.toString(),
        },
        "Sell quote fetched with slippage protection"
      );
    } catch (error) {
      logger.warn(
        { error, bondingCurve: params.bondingCurveAddress },
        "Failed to get sell quote, proceeding without slippage protection"
      );
    }
  }

  // Step 2: Ensure token approval
  const approvalResult = await ensureApproval(
    walletId,
    walletAddress,
    params.tokenAddress,
    params.bondingCurveAddress,
    params.tokenAmount
  );

  if (approvalResult && !approvalResult.success) {
    return {
      action,
      success: false,
      error: `Approval failed: ${approvalResult.error}`,
    };
  }

  // Step 3: Execute sell with retry
  try {
    const confirmed = await withRetry(
      async () => {
        const tx = await executeContractCall({
          walletId,
          contractAddress: params.bondingCurveAddress,
          abiFunctionSignature: "sell(uint256,uint256)",
          abiParameters: [params.tokenAmount.toString(), minUsdcOut.toString()],
          refId: `sell-${params.tokenName}`,
        });
        return waitForConfirmation(tx.id);
      },
      `sell-${params.tokenName}`
    );

    // Step 4: Update holdings database (best effort, don't fail the action)
    // Use minUsdcOut as estimate since we don't have exact USDC received
    await updateHoldingsAfterSell(
      agentId,
      params.tokenAddress,
      params.tokenAmount,
      minUsdcOut
    );

    return {
      action,
      success: true,
      transactionId: confirmed.id,
      txHash: confirmed.txHash,
      approvalTxHash: approvalResult?.txHash,
    };
  } catch (error) {
    return {
      action,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      approvalTxHash: approvalResult?.txHash,
    };
  }
}

/**
 * Execute CLAIM_REVENUE action
 * Call bondingCurve.claimRevenue()
 */
async function executeClaimRevenue(
  action: Action,
  walletId: string
): Promise<ExecutionResult> {
  const params = action.params as ClaimRevenueParams;

  try {
    const tx = await executeContractCall({
      walletId,
      contractAddress: params.bondingCurveAddress,
      abiFunctionSignature: "claimRevenue()",
      abiParameters: [],
      refId: "claim-revenue",
    });

    const confirmed = await waitForConfirmation(tx.id);

    return {
      action,
      success: true,
      transactionId: tx.id,
      txHash: confirmed.txHash,
    };
  } catch (error) {
    return {
      action,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute REPAY action
 * 1. Approve USDC spending on lending pool
 * 2. Call lendingPool.repay(amount)
 */
async function executeRepay(
  action: Action,
  walletId: string,
  walletAddress: Address
): Promise<ExecutionResult> {
  const params = action.params as RepayParams;

  // Step 1: Ensure USDC approval for lending pool
  const approvalResult = await ensureApproval(
    walletId,
    walletAddress,
    addresses.usdc as Address,
    addresses.lendingPool as Address,
    params.repayAmount
  );

  if (approvalResult && !approvalResult.success) {
    return {
      action,
      success: false,
      error: `Approval failed: ${approvalResult.error}`,
    };
  }

  // Step 2: Execute repay
  try {
    const tx = await executeContractCall({
      walletId,
      contractAddress: addresses.lendingPool,
      abiFunctionSignature: "repay(uint256)",
      abiParameters: [params.repayAmount.toString()],
      refId: "repay-loan",
    });

    const confirmed = await waitForConfirmation(tx.id);

    return {
      action,
      success: true,
      transactionId: tx.id,
      txHash: confirmed.txHash,
      approvalTxHash: approvalResult?.txHash,
    };
  } catch (error) {
    return {
      action,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      approvalTxHash: approvalResult?.txHash,
    };
  }
}

/**
 * Execute BORROW action
 * 1. Approve collateral token on lending pool
 * 2. Call lendingPool.deposit(token, amount) if needed
 * 3. Call lendingPool.borrow(amount)
 */
async function executeBorrow(
  action: Action,
  walletId: string,
  walletAddress: Address
): Promise<ExecutionResult> {
  const params = action.params as BorrowParams;

  // Step 1: Ensure collateral approval
  const approvalResult = await ensureApproval(
    walletId,
    walletAddress,
    params.collateralToken,
    addresses.lendingPool as Address,
    params.collateralAmount
  );

  if (approvalResult && !approvalResult.success) {
    return {
      action,
      success: false,
      error: `Approval failed: ${approvalResult.error}`,
    };
  }

  // Step 2: Deposit collateral
  try {
    const depositTx = await executeContractCall({
      walletId,
      contractAddress: addresses.lendingPool,
      abiFunctionSignature: "deposit(address,uint256)",
      abiParameters: [params.collateralToken, params.collateralAmount.toString()],
      refId: "deposit-collateral",
    });

    await waitForConfirmation(depositTx.id);

    // Step 3: Borrow
    const borrowTx = await executeContractCall({
      walletId,
      contractAddress: addresses.lendingPool,
      abiFunctionSignature: "borrow(uint256)",
      abiParameters: [params.borrowAmount.toString()],
      refId: "borrow-usdc",
    });

    const confirmed = await waitForConfirmation(borrowTx.id);

    return {
      action,
      success: true,
      transactionId: borrowTx.id,
      txHash: confirmed.txHash,
      approvalTxHash: approvalResult?.txHash,
    };
  } catch (error) {
    return {
      action,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      approvalTxHash: approvalResult?.txHash,
    };
  }
}

/**
 * Execute DEPOSIT_COLLATERAL action
 * 1. Approve token on lending pool
 * 2. Call lendingPool.deposit(token, amount)
 */
async function executeDepositCollateral(
  action: Action,
  walletId: string,
  walletAddress: Address
): Promise<ExecutionResult> {
  const params = action.params as DepositCollateralParams;

  // Step 1: Ensure token approval
  const approvalResult = await ensureApproval(
    walletId,
    walletAddress,
    params.tokenAddress,
    addresses.lendingPool as Address,
    params.amount
  );

  if (approvalResult && !approvalResult.success) {
    return {
      action,
      success: false,
      error: `Approval failed: ${approvalResult.error}`,
    };
  }

  // Step 2: Execute deposit
  try {
    const tx = await executeContractCall({
      walletId,
      contractAddress: addresses.lendingPool,
      abiFunctionSignature: "deposit(address,uint256)",
      abiParameters: [params.tokenAddress, params.amount.toString()],
      refId: "deposit-collateral",
    });

    const confirmed = await waitForConfirmation(tx.id);

    return {
      action,
      success: true,
      transactionId: tx.id,
      txHash: confirmed.txHash,
      approvalTxHash: approvalResult?.txHash,
    };
  } catch (error) {
    return {
      action,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      approvalTxHash: approvalResult?.txHash,
    };
  }
}

/**
 * Execute WITHDRAW_COLLATERAL action
 * Call lendingPool.withdraw(amount)
 */
async function executeWithdrawCollateral(
  action: Action,
  walletId: string
): Promise<ExecutionResult> {
  const params = action.params as WithdrawCollateralParams;

  try {
    const tx = await executeContractCall({
      walletId,
      contractAddress: addresses.lendingPool,
      abiFunctionSignature: "withdraw(uint256)",
      abiParameters: [params.amount.toString()],
      refId: "withdraw-collateral",
    });

    const confirmed = await waitForConfirmation(tx.id);

    return {
      action,
      success: true,
      transactionId: tx.id,
      txHash: confirmed.txHash,
    };
  } catch (error) {
    return {
      action,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Ensure token approval is set for a spender
 * Returns null if no approval needed, or ExecutionResult if approval was executed
 */
async function ensureApproval(
  walletId: string,
  ownerAddress: Address,
  tokenAddress: Address,
  spenderAddress: Address,
  requiredAmount: bigint
): Promise<{ success: boolean; txHash?: string; error?: string } | null> {
  const publicClient = getPublicClient();

  try {
    // Check current allowance
    const currentAllowance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [ownerAddress, spenderAddress],
    });

    const allowance = currentAllowance as bigint;

    // If allowance is sufficient, no approval needed
    if (allowance >= requiredAmount) {
      logger.debug(
        {
          tokenAddress,
          spenderAddress,
          currentAllowance: allowance.toString(),
          requiredAmount: requiredAmount.toString(),
        },
        "Sufficient allowance exists"
      );
      return null;
    }

    // Execute approval for max uint256 (infinite approval)
    logger.info(
      {
        tokenAddress,
        spenderAddress,
        currentAllowance: allowance.toString(),
        requiredAmount: requiredAmount.toString(),
      },
      "Executing token approval"
    );

    const tx = await executeContractCall({
      walletId,
      contractAddress: tokenAddress,
      abiFunctionSignature: "approve(address,uint256)",
      abiParameters: [spenderAddress, MAX_UINT256.toString()],
      refId: `approve-${tokenAddress.slice(0, 8)}`,
    });

    const confirmed = await waitForConfirmation(tx.id);

    logger.info(
      { tokenAddress, spenderAddress, txHash: confirmed.txHash },
      "Token approval confirmed"
    );

    return {
      success: true,
      txHash: confirmed.txHash,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      { tokenAddress, spenderAddress, error: errorMessage },
      "Token approval failed"
    );
    return {
      success: false,
      error: errorMessage,
    };
  }
}

// ============================================
// Holdings Database Updates
// ============================================

/**
 * Update holdings after a successful buy
 */
export async function updateHoldingsAfterBuy(
  agentId: string,
  tokenAddress: Address,
  tokenName: string,
  usdcSpent: bigint,
  tokensReceived: bigint
): Promise<void> {
  try {
    // Check if holding already exists
    const existing = await db.query.holdings.findFirst({
      where: and(
        eq(holdings.agentId, agentId),
        eq(holdings.tokenAddress, tokenAddress)
      ),
    });

    if (existing) {
      // Update existing holding with new average price
      const existingBalance = BigInt(existing.balance);
      const existingCostBasis = BigInt(existing.totalCostBasis);

      const newBalance = existingBalance + tokensReceived;
      const newCostBasis = existingCostBasis + usdcSpent;
      // New avg price = total cost / total tokens (in USDC per token, 6 decimals)
      const newAvgPrice = newBalance > BigInt(0)
        ? (newCostBasis * BigInt(1e18)) / newBalance  // Scale for precision
        : BigInt(0);

      await db
        .update(holdings)
        .set({
          balance: newBalance.toString(),
          totalCostBasis: newCostBasis.toString(),
          avgBuyPrice: newAvgPrice.toString(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(holdings.agentId, agentId),
            eq(holdings.tokenAddress, tokenAddress)
          )
        );

      logger.info(
        {
          agentId,
          tokenAddress,
          newBalance: newBalance.toString(),
          newCostBasis: newCostBasis.toString(),
        },
        "Updated existing holding after buy"
      );
    } else {
      // Create new holding
      const avgPrice = tokensReceived > BigInt(0)
        ? (usdcSpent * BigInt(1e18)) / tokensReceived
        : BigInt(0);

      await db.insert(holdings).values({
        agentId,
        tokenAddress,
        tokenName,
        balance: tokensReceived.toString(),
        avgBuyPrice: avgPrice.toString(),
        totalCostBasis: usdcSpent.toString(),
      });

      logger.info(
        {
          agentId,
          tokenAddress,
          tokenName,
          balance: tokensReceived.toString(),
        },
        "Created new holding after buy"
      );
    }
  } catch (error) {
    logger.error(
      { agentId, tokenAddress, error },
      "Failed to update holdings after buy"
    );
  }
}

/**
 * Update holdings after a successful sell
 */
export async function updateHoldingsAfterSell(
  agentId: string,
  tokenAddress: Address,
  tokensSold: bigint,
  usdcReceived: bigint
): Promise<void> {
  try {
    const existing = await db.query.holdings.findFirst({
      where: and(
        eq(holdings.agentId, agentId),
        eq(holdings.tokenAddress, tokenAddress)
      ),
    });

    if (!existing) {
      logger.warn(
        { agentId, tokenAddress },
        "No existing holding found for sell update"
      );
      return;
    }

    const existingBalance = BigInt(existing.balance);
    const existingCostBasis = BigInt(existing.totalCostBasis);

    const newBalance = existingBalance - tokensSold;

    // Reduce cost basis proportionally
    const proportionSold = existingBalance > BigInt(0)
      ? (tokensSold * BigInt(10000)) / existingBalance
      : BigInt(10000);
    const costBasisReduction = (existingCostBasis * proportionSold) / BigInt(10000);
    const newCostBasis = existingCostBasis - costBasisReduction;

    if (newBalance <= BigInt(0)) {
      // Remove holding entirely
      await db
        .delete(holdings)
        .where(
          and(
            eq(holdings.agentId, agentId),
            eq(holdings.tokenAddress, tokenAddress)
          )
        );

      logger.info(
        { agentId, tokenAddress, usdcReceived: usdcReceived.toString() },
        "Removed holding after full sell"
      );
    } else {
      // Update with reduced balance
      await db
        .update(holdings)
        .set({
          balance: newBalance.toString(),
          totalCostBasis: newCostBasis.toString(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(holdings.agentId, agentId),
            eq(holdings.tokenAddress, tokenAddress)
          )
        );

      logger.info(
        {
          agentId,
          tokenAddress,
          newBalance: newBalance.toString(),
          newCostBasis: newCostBasis.toString(),
        },
        "Updated holding after partial sell"
      );
    }
  } catch (error) {
    logger.error(
      { agentId, tokenAddress, error },
      "Failed to update holdings after sell"
    );
  }
}

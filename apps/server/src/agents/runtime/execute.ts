/**
 * Action Executor
 *
 * Executes agent actions via Circle Developer-Controlled Wallets.
 * Handles approvals, contract calls, and transaction tracking.
 */

import type { Address } from "viem";
import { getPublicClient } from "../../integrations/chain/client";
import { erc20Abi } from "../../integrations/chain/abis";
import { addresses } from "../../integrations/chain/contracts";
import {
  executeContractCall,
  waitForConfirmation,
} from "../../integrations/circle/transactions";
import { logger } from "../../utils/logger";
import type {
  Action,
  ActionType,
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

  switch (action.type) {
    case "BUY_TOKEN":
      return executeBuyToken(action, walletId, config.evmAddress);

    case "SELL_TOKEN":
      return executeSellToken(action, walletId, config.evmAddress);

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

/**
 * Execute BUY_TOKEN action
 * 1. Approve USDC spending on bonding curve
 * 2. Call bondingCurve.buy(usdcAmount, minTokensOut)
 */
async function executeBuyToken(
  action: Action,
  walletId: string,
  walletAddress: Address
): Promise<ExecutionResult> {
  const params = action.params as BuyTokenParams;

  // Step 1: Ensure USDC approval
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

  // Step 2: Execute buy
  try {
    const tx = await executeContractCall({
      walletId,
      contractAddress: params.bondingCurveAddress,
      abiFunctionSignature: "buy(uint256,uint256)",
      abiParameters: [params.usdcAmount.toString(), params.minTokensOut.toString()],
      refId: `buy-${params.tokenName}`,
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
 * Execute SELL_TOKEN action
 * 1. Approve token spending on bonding curve
 * 2. Call bondingCurve.sell(tokenAmount, minUsdcOut)
 */
async function executeSellToken(
  action: Action,
  walletId: string,
  walletAddress: Address
): Promise<ExecutionResult> {
  const params = action.params as SellTokenParams;

  // Step 1: Ensure token approval
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

  // Step 2: Execute sell
  try {
    const tx = await executeContractCall({
      walletId,
      contractAddress: params.bondingCurveAddress,
      abiFunctionSignature: "sell(uint256,uint256)",
      abiParameters: [params.tokenAmount.toString(), params.minUsdcOut.toString()],
      refId: `sell-${params.tokenName}`,
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

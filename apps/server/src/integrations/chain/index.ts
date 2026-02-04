/**
 * Chain Integration Module
 *
 * Re-exports all chain-related functionality.
 */

export { arcTestnet, getPublicClient, createAgentWalletClient } from "./client";
export {
  addresses,
  getLendingPool,
  getCreatorFactory,
  getRevenueDistributor,
  getBondingCurve,
  getERC20,
  getUSDC,
} from "./contracts";
export type {
  BondingCurveContract,
  LendingPoolContract,
  CreatorFactoryContract,
  ERC20Contract,
} from "./contracts";
export {
  bondingCurveAbi,
  lendingPoolAbi,
  creatorFactoryAbi,
  revenueDistributorAbi,
  erc20Abi,
} from "./abis";

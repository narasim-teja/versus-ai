import { getContract, type Address, type GetContractReturnType } from "viem";
import { getPublicClient } from "./client";
import {
  bondingCurveAbi,
  lendingPoolAbi,
  creatorFactoryAbi,
  revenueDistributorAbi,
  erc20Abi,
} from "./abis";

// Contract addresses from environment
export const addresses = {
  lendingPool: (process.env.LENDING_POOL_ADDRESS ||
    "0xF6D8013c2C11f8895118A01a44df52dce143daE6") as Address,
  revenueDistributor: (process.env.REVENUE_DISTRIBUTOR_ADDRESS ||
    "0xFb9499118e785EC41Fd0361C80031df1aaa7e579") as Address,
  creatorFactory: (process.env.CREATOR_FACTORY_ADDRESS ||
    "0x3DAe7840cC5ACf75548a430651af921a29EF744D") as Address,
  usdc: (process.env.USDC_ADDRESS ||
    "0x3600000000000000000000000000000000000000") as Address,
} as const;

/**
 * Get LendingPool contract instance
 */
export function getLendingPool() {
  return getContract({
    address: addresses.lendingPool,
    abi: lendingPoolAbi,
    client: getPublicClient(),
  });
}

/**
 * Get CreatorFactory contract instance
 */
export function getCreatorFactory() {
  return getContract({
    address: addresses.creatorFactory,
    abi: creatorFactoryAbi,
    client: getPublicClient(),
  });
}

/**
 * Get RevenueDistributor contract instance
 */
export function getRevenueDistributor() {
  return getContract({
    address: addresses.revenueDistributor,
    abi: revenueDistributorAbi,
    client: getPublicClient(),
  });
}

/**
 * Get BondingCurve contract for a specific address
 */
export function getBondingCurve(bondingCurveAddress: Address) {
  return getContract({
    address: bondingCurveAddress,
    abi: bondingCurveAbi,
    client: getPublicClient(),
  });
}

/**
 * Get ERC20 token contract
 */
export function getERC20(tokenAddress: Address) {
  return getContract({
    address: tokenAddress,
    abi: erc20Abi,
    client: getPublicClient(),
  });
}

/**
 * Get USDC contract
 */
export function getUSDC() {
  return getERC20(addresses.usdc);
}

// Type exports for contract instances
export type BondingCurveContract = ReturnType<typeof getBondingCurve>;
export type LendingPoolContract = ReturnType<typeof getLendingPool>;
export type CreatorFactoryContract = ReturnType<typeof getCreatorFactory>;
export type ERC20Contract = ReturnType<typeof getERC20>;

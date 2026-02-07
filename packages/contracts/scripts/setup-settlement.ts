import hre from "hardhat";
import { formatEther } from "viem";

/**
 * Setup script for ARC testnet settlement.
 *
 * Run after deploying contracts on ARC testnet to:
 * 1. Whitelist the settlement wallet as a settler on RevenueDistributor
 * 2. Approve RevenueDistributor to spend USDC from the settlement wallet
 *
 * Usage: npx hardhat run scripts/setup-settlement.ts --network arc
 */
async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  const settlementAddress = process.env.SETTLEMENT_ADDRESS || deployer.account.address;
  const revenueDistributorAddress = process.env.REVENUE_DISTRIBUTOR_ADDRESS;
  const usdcAddress = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";

  if (!revenueDistributorAddress) {
    throw new Error("REVENUE_DISTRIBUTOR_ADDRESS is required");
  }

  console.log("Setting up settlement on ARC testnet");
  console.log("Settlement wallet:", settlementAddress);
  console.log("RevenueDistributor:", revenueDistributorAddress);

  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log("Account balance:", formatEther(balance), "ETH\n");

  // 1. Whitelist settlement wallet as settler
  console.log("1. Whitelisting settlement wallet as settler...");
  const revenueDistributor = await hre.viem.getContractAt(
    "RevenueDistributor",
    revenueDistributorAddress as `0x${string}`
  );

  const isAlreadyWhitelisted = await revenueDistributor.read.whitelistedSettlers([
    settlementAddress as `0x${string}`,
  ]);

  if (isAlreadyWhitelisted) {
    console.log("   Already whitelisted");
  } else {
    await revenueDistributor.write.setWhitelistedSettler([
      settlementAddress as `0x${string}`,
      true,
    ]);
    console.log("   Whitelisted successfully");
  }

  // 2. Approve RevenueDistributor to spend USDC
  console.log("2. Approving RevenueDistributor to spend USDC...");
  const usdc = await hre.viem.getContractAt("MockERC20", usdcAddress as `0x${string}`);
  const maxApproval = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

  await usdc.write.approve([
    revenueDistributorAddress as `0x${string}`,
    maxApproval,
  ]);
  console.log("   USDC approved for RevenueDistributor");

  console.log("\n=== SETUP COMPLETE ===");
  console.log(`Settlement wallet ${settlementAddress} is now authorized to call distributeRevenue()`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

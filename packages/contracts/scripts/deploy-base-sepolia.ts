import hre from "hardhat";
import { formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  console.log("Deploying Base Sepolia contracts with account:", deployer.account.address);

  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log("Account balance:", formatEther(balance), "ETH");

  const usdcAddress =
    process.env.BASE_SEPOLIA_USDC_ADDRESS ||
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  console.log("\n--- Deploying Base Sepolia Contracts ---\n");

  // 1. Deploy VideoRegistry
  console.log("1. Deploying VideoRegistry...");
  const videoRegistry = await hre.viem.deployContract("VideoRegistry", [
    deployer.account.address, // owner
  ]);
  console.log("   VideoRegistry deployed to:", videoRegistry.address);

  // 2. Deploy BridgeEscrow
  console.log("2. Deploying BridgeEscrow...");
  const bridgeEscrow = await hre.viem.deployContract("BridgeEscrow", [
    usdcAddress,
    deployer.account.address, // owner
  ]);
  console.log("   BridgeEscrow deployed to:", bridgeEscrow.address);

  console.log("\n--- Deployment Complete ---\n");

  // Save deployment addresses
  const chainId = await publicClient.getChainId();
  const deployments = {
    network: "baseSepolia",
    chainId,
    deployer: deployer.account.address,
    timestamp: new Date().toISOString(),
    contracts: {
      usdc: usdcAddress,
      videoRegistry: videoRegistry.address,
      bridgeEscrow: bridgeEscrow.address,
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentPath = path.join(deploymentsDir, "baseSepolia.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deployments, null, 2));
  console.log(`Deployment saved to: ${deploymentPath}`);

  console.log("\n=== BASE SEPOLIA DEPLOYMENT SUMMARY ===");
  console.log(`USDC: ${usdcAddress}`);
  console.log(`VideoRegistry: ${videoRegistry.address}`);
  console.log(`BridgeEscrow: ${bridgeEscrow.address}`);
  console.log("========================================\n");

  console.log("Add these to your .env:");
  console.log(`VIDEO_REGISTRY_ADDRESS=${videoRegistry.address}`);
  console.log(`BRIDGE_ESCROW_ADDRESS=${bridgeEscrow.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

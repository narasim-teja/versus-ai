import hre from "hardhat";
import { formatEther, parseEther } from "viem";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  console.log("Deploying contracts with account:", deployer.account.address);

  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log("Account balance:", formatEther(balance), "ETH");

  // Get USDC address from environment or use a mock for testing
  const usdcAddress =
    process.env.BASE_SEPOLIA_USDC ||
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  console.log("\n--- Deploying Versus Contracts ---\n");

  // 1. Deploy RevenueDistributor
  console.log("1. Deploying RevenueDistributor...");
  const revenueDistributor = await hre.viem.deployContract(
    "RevenueDistributor",
    [
      usdcAddress,
      deployer.account.address, // treasury
      deployer.account.address, // owner
    ]
  );
  console.log("   RevenueDistributor deployed to:", revenueDistributor.address);

  // 2. Deploy LendingPool
  console.log("2. Deploying LendingPool...");
  const lendingPool = await hre.viem.deployContract("LendingPool", [
    usdcAddress,
    deployer.account.address, // owner
  ]);
  console.log("   LendingPool deployed to:", lendingPool.address);

  // 3. Deploy CreatorFactory
  console.log("3. Deploying CreatorFactory...");
  const creatorFactory = await hre.viem.deployContract("CreatorFactory", [
    usdcAddress,
    revenueDistributor.address,
    lendingPool.address,
    deployer.account.address, // owner
  ]);
  console.log("   CreatorFactory deployed to:", creatorFactory.address);

  // 4. Set factory address in RevenueDistributor and LendingPool
  console.log("4. Setting factory address in RevenueDistributor and LendingPool...");
  await revenueDistributor.write.setFactory([creatorFactory.address]);
  await lendingPool.write.setFactory([creatorFactory.address]);
  console.log("   Factory address set");

  // 5. Whitelist deployer as settler (for testing revenue distribution)
  console.log("5. Whitelisting deployer as settler for testing...");
  await revenueDistributor.write.setWhitelistedSettler([
    deployer.account.address,
    true,
  ]);
  console.log("   Deployer whitelisted as settler");

  console.log("\n--- Deployment Complete ---\n");

  // Save deployment addresses
  const networkName = hre.network.name;
  const deployments = {
    network: networkName,
    chainId: await publicClient.getChainId(),
    deployer: deployer.account.address,
    timestamp: new Date().toISOString(),
    contracts: {
      usdc: usdcAddress,
      revenueDistributor: revenueDistributor.address,
      lendingPool: lendingPool.address,
      creatorFactory: creatorFactory.address,
    },
    parameters: {
      defaultFloor: "10000", // 0.01 USDC
      defaultCeiling: "10000000", // 10 USDC
      defaultMidpoint: "10000000000000000000000", // 10,000 tokens
      defaultSteepness: "10000000000000000", // 0.01
    },
  };

  // Ensure deployments directory exists
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Save to file
  const deploymentPath = path.join(deploymentsDir, `${networkName}.json`);
  fs.writeFileSync(deploymentPath, JSON.stringify(deployments, null, 2));
  console.log(`Deployment saved to: ${deploymentPath}`);

  // Print summary
  console.log("\n=== DEPLOYMENT SUMMARY ===");
  console.log(`Network: ${networkName}`);
  console.log(`USDC: ${usdcAddress}`);
  console.log(`RevenueDistributor: ${revenueDistributor.address}`);
  console.log(`LendingPool: ${lendingPool.address}`);
  console.log(`CreatorFactory: ${creatorFactory.address}`);
  console.log("===========================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

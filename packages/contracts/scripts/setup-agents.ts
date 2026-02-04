import hre from "hardhat";
import { formatEther, formatUnits, parseUnits, generatePrivateKey, privateKeyToAccount } from "viem";
import * as fs from "fs";
import * as path from "path";

/**
 * Setup script for Alice and Bob agent creators
 *
 * This script:
 * 1. Generates or loads private keys for Alice and Bob
 * 2. Derives EVM addresses from those keys
 * 3. Creates creators via CreatorFactory.createCreator()
 * 4. Saves all addresses and keys to agents.json
 */

interface AgentDeployment {
  id: string;
  name: string;
  privateKey: string;
  evmAddress: string;
  tokenAddress: string;
  bondingCurveAddress: string;
}

interface AgentsConfig {
  network: string;
  chainId: number;
  deployedAt: string;
  creatorFactoryAddress: string;
  agents: {
    alice: AgentDeployment;
    bob: AgentDeployment;
  };
}

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const networkName = hre.network.name;
  const chainId = await publicClient.getChainId();

  console.log("Setting up agents with deployer:", deployer.account.address);
  console.log("Network:", networkName, "Chain ID:", chainId);

  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log("Deployer balance:", formatEther(balance), "ETH");

  // Load existing deployment to get CreatorFactory address
  const deploymentPath = path.join(__dirname, "..", "deployments", `${networkName}.json`);
  let creatorFactoryAddress: `0x${string}`;

  if (fs.existsSync(deploymentPath)) {
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    creatorFactoryAddress = deployment.contracts.creatorFactory as `0x${string}`;
    console.log("Using CreatorFactory from deployment:", creatorFactoryAddress);
  } else {
    // Try ignition deployments
    const ignitionPath = path.join(
      __dirname,
      "..",
      "ignition",
      "deployments",
      `chain-${chainId}`,
      "deployed_addresses.json"
    );
    if (fs.existsSync(ignitionPath)) {
      const ignitionDeployment = JSON.parse(fs.readFileSync(ignitionPath, "utf8"));
      creatorFactoryAddress = ignitionDeployment["VersusCore#CreatorFactory"] as `0x${string}`;
      console.log("Using CreatorFactory from ignition:", creatorFactoryAddress);
    } else {
      throw new Error(
        `No deployment found for network ${networkName}. Run deploy script first.`
      );
    }
  }

  // Check if agents.json already exists
  const agentsPath = path.join(__dirname, "..", "deployments", "agents.json");
  let existingAgents: AgentsConfig | null = null;

  if (fs.existsSync(agentsPath)) {
    existingAgents = JSON.parse(fs.readFileSync(agentsPath, "utf8"));
    if (existingAgents?.chainId === chainId) {
      console.log("\nAgents already deployed for this network!");
      console.log("Alice token:", existingAgents.agents.alice.tokenAddress);
      console.log("Bob token:", existingAgents.agents.bob.tokenAddress);
      console.log("\nTo redeploy, delete deployments/agents.json first.");
      return;
    }
  }

  // Get CreatorFactory contract
  const creatorFactory = await hre.viem.getContractAt(
    "CreatorFactory",
    creatorFactoryAddress
  );

  // Step 1: Generate or load private keys
  console.log("\n--- Step 1: Generate Agent Keys ---");

  // Check for existing keys in environment
  let alicePrivateKey = process.env.ALICE_PRIVATE_KEY as `0x${string}` | undefined;
  let bobPrivateKey = process.env.BOB_PRIVATE_KEY as `0x${string}` | undefined;

  if (!alicePrivateKey) {
    alicePrivateKey = generatePrivateKey();
    console.log("Generated new private key for Alice");
  } else {
    console.log("Using existing private key for Alice from env");
  }

  if (!bobPrivateKey) {
    bobPrivateKey = generatePrivateKey();
    console.log("Generated new private key for Bob");
  } else {
    console.log("Using existing private key for Bob from env");
  }

  // Step 2: Derive addresses
  console.log("\n--- Step 2: Derive Addresses ---");

  const aliceAccount = privateKeyToAccount(alicePrivateKey);
  const bobAccount = privateKeyToAccount(bobPrivateKey);

  console.log("Alice address:", aliceAccount.address);
  console.log("Bob address:", bobAccount.address);

  // Step 3: Check if creators already exist
  console.log("\n--- Step 3: Check Existing Creators ---");

  const aliceExisting = await creatorFactory.read.creators([aliceAccount.address]);
  const bobExisting = await creatorFactory.read.creators([bobAccount.address]);

  let aliceTokenAddress: `0x${string}`;
  let aliceCurveAddress: `0x${string}`;
  let bobTokenAddress: `0x${string}`;
  let bobCurveAddress: `0x${string}`;

  // Step 4: Deploy creators if needed
  console.log("\n--- Step 4: Deploy Creators ---");

  if (aliceExisting[0] !== "0x0000000000000000000000000000000000000000") {
    console.log("Alice creator already exists");
    aliceTokenAddress = aliceExisting[0] as `0x${string}`;
    aliceCurveAddress = aliceExisting[1] as `0x${string}`;
  } else {
    console.log("Deploying Alice creator...");
    const aliceTxHash = await creatorFactory.write.createCreator([
      "Alice Token",
      "ALICE",
      aliceAccount.address,
    ]);
    console.log("Alice deployment tx:", aliceTxHash);

    // Wait for transaction and get receipt
    const aliceReceipt = await publicClient.waitForTransactionReceipt({
      hash: aliceTxHash,
    });
    console.log("Alice deployment confirmed in block:", aliceReceipt.blockNumber);

    // Get the deployed addresses from the contract
    const aliceInfo = await creatorFactory.read.creators([aliceAccount.address]);
    aliceTokenAddress = aliceInfo[0] as `0x${string}`;
    aliceCurveAddress = aliceInfo[1] as `0x${string}`;
    console.log("Alice Token:", aliceTokenAddress);
    console.log("Alice BondingCurve:", aliceCurveAddress);
  }

  if (bobExisting[0] !== "0x0000000000000000000000000000000000000000") {
    console.log("Bob creator already exists");
    bobTokenAddress = bobExisting[0] as `0x${string}`;
    bobCurveAddress = bobExisting[1] as `0x${string}`;
  } else {
    console.log("Deploying Bob creator...");
    const bobTxHash = await creatorFactory.write.createCreator([
      "Bob Token",
      "BOB",
      bobAccount.address,
    ]);
    console.log("Bob deployment tx:", bobTxHash);

    // Wait for transaction and get receipt
    const bobReceipt = await publicClient.waitForTransactionReceipt({
      hash: bobTxHash,
    });
    console.log("Bob deployment confirmed in block:", bobReceipt.blockNumber);

    // Get the deployed addresses from the contract
    const bobInfo = await creatorFactory.read.creators([bobAccount.address]);
    bobTokenAddress = bobInfo[0] as `0x${string}`;
    bobCurveAddress = bobInfo[1] as `0x${string}`;
    console.log("Bob Token:", bobTokenAddress);
    console.log("Bob BondingCurve:", bobCurveAddress);
  }

  // Step 5: Save configuration
  console.log("\n--- Step 5: Save Configuration ---");

  const agentsConfig: AgentsConfig = {
    network: networkName,
    chainId: chainId,
    deployedAt: new Date().toISOString(),
    creatorFactoryAddress: creatorFactoryAddress,
    agents: {
      alice: {
        id: "alice",
        name: "Alice (Academic)",
        privateKey: alicePrivateKey,
        evmAddress: aliceAccount.address,
        tokenAddress: aliceTokenAddress,
        bondingCurveAddress: aliceCurveAddress,
      },
      bob: {
        id: "bob",
        name: "Bob (Degen)",
        privateKey: bobPrivateKey,
        evmAddress: bobAccount.address,
        tokenAddress: bobTokenAddress,
        bondingCurveAddress: bobCurveAddress,
      },
    },
  };

  // Ensure deployments directory exists
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  fs.writeFileSync(agentsPath, JSON.stringify(agentsConfig, null, 2));
  console.log("Agents configuration saved to:", agentsPath);

  // Print summary
  console.log("\n=== AGENTS SETUP COMPLETE ===");
  console.log(`Network: ${networkName} (Chain ID: ${chainId})`);
  console.log(`\nAlice:`);
  console.log(`  Address: ${aliceAccount.address}`);
  console.log(`  Token: ${aliceTokenAddress}`);
  console.log(`  BondingCurve: ${aliceCurveAddress}`);
  console.log(`\nBob:`);
  console.log(`  Address: ${bobAccount.address}`);
  console.log(`  Token: ${bobTokenAddress}`);
  console.log(`  BondingCurve: ${bobCurveAddress}`);
  console.log("\n===============================");
  console.log("\nIMPORTANT: Private keys are saved in agents.json");
  console.log("Add these to your .env for the server:");
  console.log(`\nALICE_PRIVATE_KEY=${alicePrivateKey}`);
  console.log(`ALICE_TOKEN_ADDRESS=${aliceTokenAddress}`);
  console.log(`ALICE_BONDING_CURVE_ADDRESS=${aliceCurveAddress}`);
  console.log(`\nBOB_PRIVATE_KEY=${bobPrivateKey}`);
  console.log(`BOB_TOKEN_ADDRESS=${bobTokenAddress}`);
  console.log(`BOB_BONDING_CURVE_ADDRESS=${bobCurveAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

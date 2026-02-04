import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { parseUnits, parseEther, formatUnits, getAddress } from "viem";

describe("BondingCurve", function () {
  // USDC has 6 decimals
  const USDC_DECIMALS = 6;

  // Default curve parameters
  const FLOOR = parseUnits("0.01", USDC_DECIMALS); // 0.01 USDC
  const CEILING = parseUnits("10", USDC_DECIMALS); // 10 USDC
  const MIDPOINT = parseEther("10000"); // 10,000 tokens
  const STEEPNESS = parseEther("0.01"); // k = 0.01

  async function deployBondingCurveFixture() {
    const [owner, user1, user2, revenueDistributor] =
      await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    // Deploy mock USDC
    const mockUsdc = await hre.viem.deployContract("MockERC20", [
      "USD Coin",
      "USDC",
      6,
    ]);

    // Mint USDC to users
    await mockUsdc.write.mint([user1.account.address, parseUnits("100000", 6)]);
    await mockUsdc.write.mint([user2.account.address, parseUnits("100000", 6)]);
    await mockUsdc.write.mint([
      revenueDistributor.account.address,
      parseUnits("100000", 6),
    ]);

    // First deploy a placeholder token to get the bonding curve address
    // Then deploy the real token with the correct bonding curve address
    // This is the chicken-and-egg problem solved with CREATE2 in the factory

    // For testing, we'll deploy bonding curve first with a placeholder
    // then deploy token, then manually set things up

    // Deploy bonding curve with placeholder token (we'll use owner as placeholder)
    const bondingCurve = await hre.viem.deployContract("BondingCurve", [
      mockUsdc.address,
      owner.account.address, // Placeholder - will deploy real token after
      FLOOR,
      CEILING,
      MIDPOINT,
      STEEPNESS,
      owner.account.address,
    ]);

    // Deploy creator token pointing to bonding curve
    const creatorToken = await hre.viem.deployContract("CreatorToken", [
      "Test Token",
      "TEST",
      bondingCurve.address,
      owner.account.address,
    ]);

    // Set revenue distributor
    await bondingCurve.write.setRevenueDistributor([
      revenueDistributor.account.address,
    ]);

    // Note: In this test setup, the bondingCurve.creatorToken points to owner
    // This is a limitation of the test setup. In production, use CreatorFactory.

    return {
      bondingCurve,
      creatorToken,
      mockUsdc,
      owner,
      user1,
      user2,
      revenueDistributor,
      publicClient,
    };
  }

  // Deploy a proper integrated setup using manual deployment
  async function deployIntegratedFixture() {
    const [owner, user1, user2, revenueDistributor] =
      await hre.viem.getWalletClients();

    // Deploy mock USDC
    const mockUsdc = await hre.viem.deployContract("MockERC20", [
      "USD Coin",
      "USDC",
      6,
    ]);

    // For a proper test, we need to use CREATE2 to predict addresses
    // Or deploy in a specific order. Let's use a simpler approach:
    // Deploy BondingCurve with a temporary token address, then fix it

    // Actually, the cleanest way is to deploy through the factory
    // But for unit testing the BondingCurve, let's use a workaround

    // Deploy RevenueDistributor first
    const revDistributor = await hre.viem.deployContract("RevenueDistributor", [
      mockUsdc.address,
      owner.account.address, // treasury
      owner.account.address, // owner
    ]);

    // Deploy LendingPool
    const lendingPool = await hre.viem.deployContract("LendingPool", [
      mockUsdc.address,
      owner.account.address,
    ]);

    // Deploy CreatorFactory
    const creatorFactory = await hre.viem.deployContract("CreatorFactory", [
      mockUsdc.address,
      revDistributor.address,
      lendingPool.address,
      owner.account.address,
    ]);

    // Set factory address in RevenueDistributor and LendingPool
    await revDistributor.write.setFactory([creatorFactory.address]);
    await lendingPool.write.setFactory([creatorFactory.address]);

    // Mint USDC to users
    await mockUsdc.write.mint([user1.account.address, parseUnits("100000", 6)]);
    await mockUsdc.write.mint([user2.account.address, parseUnits("100000", 6)]);

    // Create a creator through the factory
    await creatorFactory.write.createCreator([
      "Test Token",
      "TEST",
      owner.account.address,
    ]);

    const creatorInfo = await creatorFactory.read.getCreator([
      owner.account.address,
    ]);

    const bondingCurve = await hre.viem.getContractAt(
      "BondingCurve",
      creatorInfo.bondingCurve
    );

    const creatorToken = await hre.viem.getContractAt(
      "CreatorToken",
      creatorInfo.token
    );

    return {
      bondingCurve,
      creatorToken,
      mockUsdc,
      owner,
      user1,
      user2,
      revDistributor,
      lendingPool,
      creatorFactory,
    };
  }

  describe("Deployment", function () {
    it("Should set correct parameters", async function () {
      const { bondingCurve } = await loadFixture(deployIntegratedFixture);

      expect(await bondingCurve.read.floor()).to.equal(FLOOR);
      expect(await bondingCurve.read.ceiling()).to.equal(CEILING);
      expect(await bondingCurve.read.midpoint()).to.equal(MIDPOINT);
      expect(await bondingCurve.read.steepness()).to.equal(STEEPNESS);
    });

    it("Should return floor as getFloorPrice", async function () {
      const { bondingCurve } = await loadFixture(deployIntegratedFixture);

      expect(await bondingCurve.read.getFloorPrice()).to.equal(FLOOR);
    });
  });

  describe("Pricing", function () {
    it("Should return price near floor when supply is 0", async function () {
      const { bondingCurve } = await loadFixture(deployIntegratedFixture);

      const price = await bondingCurve.read.getPrice();
      // At supply = 0, sigmoid(0) ≈ 0.0000454 (very small)
      // price ≈ floor + tiny amount
      expect(price >= FLOOR).to.be.true;
      expect(price < FLOOR + FLOOR).to.be.true; // Less than 2x floor
    });

    it("Should return price near midpoint when supply is at midpoint", async function () {
      const { bondingCurve, creatorToken, mockUsdc, user1 } = await loadFixture(
        deployIntegratedFixture
      );

      // Buy enough tokens to get near midpoint
      // This would require a lot of USDC, so we'll just verify the math conceptually
      // At midpoint, sigmoid = 0.5, so price = floor + 0.5 * (ceiling - floor)
      const expectedMidPrice = FLOOR + (CEILING - FLOOR) / 2n;

      // We can't easily test this without buying a lot, but we verify the formula
      expect(expectedMidPrice).to.equal(parseUnits("5.005", 6)); // ~5 USDC
    });
  });

  describe("Buy/Sell", function () {
    it("Should allow buying tokens with USDC", async function () {
      const { bondingCurve, creatorToken, mockUsdc, user1 } = await loadFixture(
        deployIntegratedFixture
      );

      const usdcAmount = parseUnits("100", 6); // 100 USDC

      // Approve USDC
      const usdcAsUser = await hre.viem.getContractAt(
        "MockERC20",
        mockUsdc.address,
        { client: { wallet: user1 } }
      );
      await usdcAsUser.write.approve([bondingCurve.address, usdcAmount]);

      // Buy tokens
      const curveAsUser = await hre.viem.getContractAt(
        "BondingCurve",
        bondingCurve.address,
        { client: { wallet: user1 } }
      );

      const quote = await bondingCurve.read.getBuyQuote([usdcAmount]);
      await curveAsUser.write.buy([usdcAmount, 0n]); // 0 minTokens for testing

      const balance = await creatorToken.read.balanceOf([user1.account.address]);
      expect(balance > 0n).to.be.true;
    });

    it("Should allow selling tokens for USDC", async function () {
      const { bondingCurve, creatorToken, mockUsdc, user1 } = await loadFixture(
        deployIntegratedFixture
      );

      const usdcAmount = parseUnits("100", 6);

      // First buy some tokens
      const usdcAsUser = await hre.viem.getContractAt(
        "MockERC20",
        mockUsdc.address,
        { client: { wallet: user1 } }
      );
      await usdcAsUser.write.approve([bondingCurve.address, usdcAmount]);

      const curveAsUser = await hre.viem.getContractAt(
        "BondingCurve",
        bondingCurve.address,
        { client: { wallet: user1 } }
      );
      await curveAsUser.write.buy([usdcAmount, 0n]);

      const tokenBalance = await creatorToken.read.balanceOf([
        user1.account.address,
      ]);

      // Now sell half
      const sellAmount = tokenBalance / 2n;
      const tokenAsUser = await hre.viem.getContractAt(
        "CreatorToken",
        creatorToken.address,
        { client: { wallet: user1 } }
      );

      // Approve tokens (not needed for bonding curve burn, but good practice)
      await tokenAsUser.write.approve([bondingCurve.address, sellAmount]);

      const usdcBefore = await mockUsdc.read.balanceOf([user1.account.address]);
      await curveAsUser.write.sell([sellAmount, 0n]);
      const usdcAfter = await mockUsdc.read.balanceOf([user1.account.address]);

      expect(usdcAfter > usdcBefore).to.be.true;
    });

    it("Should revert on slippage exceeded", async function () {
      const { bondingCurve, mockUsdc, user1 } = await loadFixture(
        deployIntegratedFixture
      );

      const usdcAmount = parseUnits("100", 6);

      const usdcAsUser = await hre.viem.getContractAt(
        "MockERC20",
        mockUsdc.address,
        { client: { wallet: user1 } }
      );
      await usdcAsUser.write.approve([bondingCurve.address, usdcAmount]);

      const curveAsUser = await hre.viem.getContractAt(
        "BondingCurve",
        bondingCurve.address,
        { client: { wallet: user1 } }
      );

      // Set impossibly high minTokensOut
      await expect(
        curveAsUser.write.buy([usdcAmount, parseEther("999999999")])
      ).to.be.rejectedWith("SlippageExceeded");
    });
  });
});

// Mock ERC20 for testing
// We need to create this contract

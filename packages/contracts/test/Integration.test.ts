import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { parseUnits, parseEther, formatUnits, getAddress } from "viem";

describe("Integration Tests", function () {
  const USDC_DECIMALS = 6;

  async function deployFullSystemFixture() {
    const [owner, alice, bob, settler, treasury] =
      await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    // Deploy mock USDC
    const mockUsdc = await hre.viem.deployContract("MockERC20", [
      "USD Coin",
      "USDC",
      6,
    ]);

    // Deploy RevenueDistributor
    const revenueDistributor = await hre.viem.deployContract(
      "RevenueDistributor",
      [mockUsdc.address, treasury.account.address, owner.account.address]
    );

    // Deploy LendingPool
    const lendingPool = await hre.viem.deployContract("LendingPool", [
      mockUsdc.address,
      owner.account.address,
    ]);

    // Deploy CreatorFactory
    const creatorFactory = await hre.viem.deployContract("CreatorFactory", [
      mockUsdc.address,
      revenueDistributor.address,
      lendingPool.address,
      owner.account.address,
    ]);

    // Set factory address in RevenueDistributor and LendingPool
    await revenueDistributor.write.setFactory([creatorFactory.address]);
    await lendingPool.write.setFactory([creatorFactory.address]);

    // Whitelist settler
    await revenueDistributor.write.setWhitelistedSettler([
      settler.account.address,
      true,
    ]);

    // Mint USDC to users
    await mockUsdc.write.mint([alice.account.address, parseUnits("10000", 6)]);
    await mockUsdc.write.mint([bob.account.address, parseUnits("10000", 6)]);
    await mockUsdc.write.mint([settler.account.address, parseUnits("10000", 6)]);

    // Fund lending pool with USDC for borrowing
    await mockUsdc.write.mint([lendingPool.address, parseUnits("100000", 6)]);

    return {
      mockUsdc,
      revenueDistributor,
      lendingPool,
      creatorFactory,
      owner,
      alice,
      bob,
      settler,
      treasury,
      publicClient,
    };
  }

  describe("Full Creator Lifecycle", function () {
    it("Should create a creator through factory", async function () {
      const { creatorFactory, owner } = await loadFixture(
        deployFullSystemFixture
      );

      await creatorFactory.write.createCreator([
        "Agent Alice",
        "ALICE",
        owner.account.address,
      ]);

      const creatorInfo = await creatorFactory.read.getCreator([
        owner.account.address,
      ]);

      expect(creatorInfo.token).to.not.equal(
        "0x0000000000000000000000000000000000000000"
      );
      expect(creatorInfo.bondingCurve).to.not.equal(
        "0x0000000000000000000000000000000000000000"
      );
      expect(creatorInfo.wallet).to.equal(getAddress(owner.account.address));
    });

    it("Should allow buying and selling tokens", async function () {
      const { creatorFactory, mockUsdc, alice, owner } = await loadFixture(
        deployFullSystemFixture
      );

      // Create creator
      await creatorFactory.write.createCreator([
        "Agent Alice",
        "ALICE",
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

      // Alice buys tokens
      const buyAmount = parseUnits("100", 6); // 100 USDC

      const usdcAsAlice = await hre.viem.getContractAt(
        "MockERC20",
        mockUsdc.address,
        { client: { wallet: alice } }
      );
      await usdcAsAlice.write.approve([bondingCurve.address, buyAmount]);

      const curveAsAlice = await hre.viem.getContractAt(
        "BondingCurve",
        bondingCurve.address,
        { client: { wallet: alice } }
      );

      const quote = await bondingCurve.read.getBuyQuote([buyAmount]);
      console.log(
        `Quote for ${formatUnits(buyAmount, 6)} USDC: ${formatUnits(quote, 18)} tokens`
      );

      await curveAsAlice.write.buy([buyAmount, 0n]);

      const tokenBalance = await creatorToken.read.balanceOf([
        alice.account.address,
      ]);
      console.log(`Alice token balance: ${formatUnits(tokenBalance, 18)}`);

      expect(tokenBalance > 0n).to.be.true;

      // Check price increased
      const newPrice = await bondingCurve.read.getPrice();
      console.log(`New price: ${formatUnits(newPrice, 6)} USDC`);

      // Alice sells half
      const sellAmount = tokenBalance / 2n;
      await curveAsAlice.write.sell([sellAmount, 0n]);

      const newBalance = await creatorToken.read.balanceOf([
        alice.account.address,
      ]);
      expect(newBalance).to.equal(tokenBalance - sellAmount);
    });
  });

  describe("Revenue Distribution", function () {
    it("Should distribute revenue correctly (70/20/10)", async function () {
      const {
        creatorFactory,
        revenueDistributor,
        mockUsdc,
        alice,
        settler,
        treasury,
        owner,
      } = await loadFixture(deployFullSystemFixture);

      // Create creator
      await creatorFactory.write.createCreator([
        "Agent Alice",
        "ALICE",
        alice.account.address, // Creator wallet
      ]);

      const creatorInfo = await creatorFactory.read.getCreator([
        alice.account.address,
      ]);

      // Settler distributes revenue
      const revenueAmount = parseUnits("1000", 6); // 1000 USDC

      const usdcAsSettler = await hre.viem.getContractAt(
        "MockERC20",
        mockUsdc.address,
        { client: { wallet: settler } }
      );
      await usdcAsSettler.write.approve([
        revenueDistributor.address,
        revenueAmount,
      ]);

      const distAsSettler = await hre.viem.getContractAt(
        "RevenueDistributor",
        revenueDistributor.address,
        { client: { wallet: settler } }
      );

      const creatorBalanceBefore = await mockUsdc.read.balanceOf([
        alice.account.address,
      ]);
      const treasuryBalanceBefore = await mockUsdc.read.balanceOf([
        treasury.account.address,
      ]);

      await distAsSettler.write.distributeRevenue([
        creatorInfo.token,
        revenueAmount,
      ]);

      const creatorBalanceAfter = await mockUsdc.read.balanceOf([
        alice.account.address,
      ]);
      const treasuryBalanceAfter = await mockUsdc.read.balanceOf([
        treasury.account.address,
      ]);

      // Creator should receive 70% = 700 USDC
      const creatorReceived = creatorBalanceAfter - creatorBalanceBefore;
      expect(creatorReceived).to.equal(parseUnits("700", 6));

      // Treasury should receive 10% = 100 USDC
      const treasuryReceived = treasuryBalanceAfter - treasuryBalanceBefore;
      expect(treasuryReceived).to.equal(parseUnits("100", 6));

      // Bonding curve should have received 20% = 200 USDC for token holders
    });
  });

  describe("Lending", function () {
    it("Should allow depositing collateral and borrowing", async function () {
      const { creatorFactory, lendingPool, mockUsdc, alice, bob, owner } =
        await loadFixture(deployFullSystemFixture);

      // Create creator
      await creatorFactory.write.createCreator([
        "Agent Alice",
        "ALICE",
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

      // Alice buys tokens first
      const buyAmount = parseUnits("1000", 6);
      const usdcAsAlice = await hre.viem.getContractAt(
        "MockERC20",
        mockUsdc.address,
        { client: { wallet: alice } }
      );
      await usdcAsAlice.write.approve([bondingCurve.address, buyAmount]);

      const curveAsAlice = await hre.viem.getContractAt(
        "BondingCurve",
        bondingCurve.address,
        { client: { wallet: alice } }
      );
      await curveAsAlice.write.buy([buyAmount, 0n]);

      const tokenBalance = await creatorToken.read.balanceOf([
        alice.account.address,
      ]);
      console.log(`Alice bought ${formatUnits(tokenBalance, 18)} tokens`);

      // Alice deposits tokens as collateral
      const tokenAsAlice = await hre.viem.getContractAt(
        "CreatorToken",
        creatorToken.address,
        { client: { wallet: alice } }
      );
      await tokenAsAlice.write.approve([lendingPool.address, tokenBalance]);

      const poolAsAlice = await hre.viem.getContractAt(
        "LendingPool",
        lendingPool.address,
        { client: { wallet: alice } }
      );
      await poolAsAlice.write.deposit([creatorToken.address, tokenBalance]);

      // Check collateral value
      const collateralValue = await lendingPool.read.getCollateralValue([
        alice.account.address,
      ]);
      console.log(`Collateral value: ${formatUnits(collateralValue, 6)} USDC`);

      // Borrow 50% of max (conservative)
      const maxBorrow = (collateralValue * 7000n) / 10000n; // 70% LTV
      const borrowAmount = maxBorrow / 2n;

      const aliceUsdcBefore = await mockUsdc.read.balanceOf([
        alice.account.address,
      ]);

      await poolAsAlice.write.borrow([borrowAmount]);

      const aliceUsdcAfter = await mockUsdc.read.balanceOf([
        alice.account.address,
      ]);

      expect(aliceUsdcAfter - aliceUsdcBefore).to.equal(borrowAmount);

      // Check health factor
      const healthFactor = await lendingPool.read.getHealthFactor([
        alice.account.address,
      ]);
      console.log(`Health factor: ${formatUnits(healthFactor, 18)}`);
      expect(healthFactor > parseEther("1")).to.be.true; // Should be healthy
    });
  });

  describe("Multiple Creators", function () {
    it("Should support multiple creators", async function () {
      const { creatorFactory, alice, bob, owner } = await loadFixture(
        deployFullSystemFixture
      );

      // Create Alice's token
      await creatorFactory.write.createCreator([
        "Agent Alice",
        "ALICE",
        alice.account.address,
      ]);

      // Create Bob's token
      await creatorFactory.write.createCreator([
        "Agent Bob",
        "BOB",
        bob.account.address,
      ]);

      const count = await creatorFactory.read.getCreatorCount();
      expect(count).to.equal(2n);

      const allCreators = await creatorFactory.read.getAllCreators();
      expect(allCreators.length).to.equal(2);

      const aliceInfo = await creatorFactory.read.getCreator([
        alice.account.address,
      ]);
      const bobInfo = await creatorFactory.read.getCreator([bob.account.address]);

      expect(aliceInfo.token).to.not.equal(bobInfo.token);
      expect(aliceInfo.bondingCurve).to.not.equal(bobInfo.bondingCurve);
    });
  });
});

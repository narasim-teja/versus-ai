// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CreatorToken} from "./CreatorToken.sol";
import {BondingCurve} from "./BondingCurve.sol";
import {IRevenueDistributor} from "./interfaces/IRevenueDistributor.sol";
import {ILendingPool} from "./interfaces/ILendingPool.sol";

/**
 * @title CreatorFactory
 * @notice Factory for deploying new creator tokens and bonding curves
 * @dev Deploys and registers new creators in one transaction
 */
contract CreatorFactory is Ownable {
    // ============ Structs ============

    struct CreatorInfo {
        address token;
        address bondingCurve;
        address wallet;
        uint256 createdAt;
    }

    // ============ Events ============

    event CreatorDeployed(
        address indexed wallet,
        address indexed token,
        address indexed bondingCurve,
        string name,
        string symbol
    );

    event DefaultParamsUpdated(
        uint256 floor,
        uint256 ceiling,
        uint256 midpoint,
        uint256 steepness
    );

    // ============ Immutables ============

    /// @notice USDC token address
    address public immutable usdc;

    /// @notice Revenue distributor contract
    IRevenueDistributor public immutable revenueDistributor;

    /// @notice Lending pool contract
    ILendingPool public immutable lendingPool;

    // ============ State Variables ============

    /// @notice Default floor price (0.01 USDC = 10000 with 6 decimals)
    uint256 public defaultFloor = 10000;

    /// @notice Default ceiling price (10 USDC = 10000000 with 6 decimals)
    uint256 public defaultCeiling = 10000000;

    /// @notice Default midpoint (10,000 tokens with 18 decimals)
    uint256 public defaultMidpoint = 10000e18;

    /// @notice Default steepness (k = 0.01 scaled to 18 decimals)
    uint256 public defaultSteepness = 1e16;

    /// @notice Creator info by wallet address
    mapping(address => CreatorInfo) public creators;

    /// @notice List of all creator wallets
    address[] public allCreators;

    // ============ Errors ============

    error ZeroAddress();
    error EmptyName();
    error EmptySymbol();
    error CreatorExists();
    error InvalidParameters();

    // ============ Constructor ============

    /**
     * @notice Creates a new creator factory
     * @param usdc_ USDC token address
     * @param revenueDistributor_ Revenue distributor contract
     * @param lendingPool_ Lending pool contract
     * @param owner_ Contract owner
     */
    constructor(
        address usdc_,
        address revenueDistributor_,
        address lendingPool_,
        address owner_
    ) Ownable(owner_) {
        if (usdc_ == address(0)) revert ZeroAddress();
        if (revenueDistributor_ == address(0)) revert ZeroAddress();
        if (lendingPool_ == address(0)) revert ZeroAddress();

        usdc = usdc_;
        revenueDistributor = IRevenueDistributor(revenueDistributor_);
        lendingPool = ILendingPool(lendingPool_);
    }

    // ============ Admin Functions ============

    /**
     * @notice Updates default curve parameters
     * @param floor_ New floor price
     * @param ceiling_ New ceiling price
     * @param midpoint_ New midpoint
     * @param steepness_ New steepness
     */
    function setDefaultParams(
        uint256 floor_,
        uint256 ceiling_,
        uint256 midpoint_,
        uint256 steepness_
    ) external onlyOwner {
        if (floor_ >= ceiling_) revert InvalidParameters();
        if (midpoint_ == 0) revert InvalidParameters();
        if (steepness_ == 0) revert InvalidParameters();

        defaultFloor = floor_;
        defaultCeiling = ceiling_;
        defaultMidpoint = midpoint_;
        defaultSteepness = steepness_;

        emit DefaultParamsUpdated(floor_, ceiling_, midpoint_, steepness_);
    }

    // ============ View Functions ============

    /**
     * @notice Returns creator info for a wallet
     * @param wallet Creator wallet address
     * @return info Creator information
     */
    function getCreator(address wallet) external view returns (CreatorInfo memory info) {
        return creators[wallet];
    }

    /**
     * @notice Returns all creator wallet addresses
     * @return List of creator wallets
     */
    function getAllCreators() external view returns (address[] memory) {
        return allCreators;
    }

    /**
     * @notice Returns the total number of creators
     * @return Number of creators
     */
    function getCreatorCount() external view returns (uint256) {
        return allCreators.length;
    }

    // ============ State-Changing Functions ============

    /**
     * @notice Creates a new creator with default parameters
     * @param name Token name (e.g., "Alice Token")
     * @param symbol Token symbol (e.g., "ALICE")
     * @param wallet Creator's wallet address
     * @return token Address of deployed token
     * @return bondingCurve Address of deployed bonding curve
     */
    function createCreator(
        string memory name,
        string memory symbol,
        address wallet
    ) external returns (address token, address bondingCurve) {
        return createCreatorWithParams(
            name,
            symbol,
            wallet,
            defaultFloor,
            defaultCeiling,
            defaultMidpoint,
            defaultSteepness
        );
    }

    /**
     * @notice Creates a new creator with custom parameters
     * @param name Token name
     * @param symbol Token symbol
     * @param wallet Creator's wallet address
     * @param floor_ Floor price in USDC (6 decimals)
     * @param ceiling_ Ceiling price in USDC (6 decimals)
     * @param midpoint_ Midpoint supply (18 decimals)
     * @param steepness_ Steepness parameter (18 decimals)
     * @return token Address of deployed token
     * @return bondingCurve Address of deployed bonding curve
     */
    function createCreatorWithParams(
        string memory name,
        string memory symbol,
        address wallet,
        uint256 floor_,
        uint256 ceiling_,
        uint256 midpoint_,
        uint256 steepness_
    ) public returns (address token, address bondingCurve) {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(symbol).length == 0) revert EmptySymbol();
        if (wallet == address(0)) revert ZeroAddress();
        if (creators[wallet].token != address(0)) revert CreatorExists();
        if (floor_ >= ceiling_) revert InvalidParameters();
        if (midpoint_ == 0 || steepness_ == 0) revert InvalidParameters();

        // Simple deployment: deploy token first, then bonding curve
        // Token needs bondingCurve address for mint permissions
        // BondingCurve needs token address to interact with it
        // Solution: Deploy BondingCurve first with token=address(0), then token, then set token on curve

        // Actually simpler: make BondingCurve accept token via setToken() after deployment
        // But that requires changing BondingCurve. Let's use a different approach:

        // Deploy token with a temporary placeholder for bondingCurve
        // Then deploy bondingCurve with the real token address
        // Then update token's bondingCurve reference

        // Wait - CreatorToken has immutable bondingCurve. Let's check if we need to change that.
        // For now, let's deploy in order and rely on the fact that:
        // 1. BondingCurve needs token address (immutable) - must know at deploy time
        // 2. Token needs bondingCurve address (immutable) - must know at deploy time

        // The cleanest solution: make one of them mutable
        // For hackathon speed: deploy token with address(this) as temp bondingCurve,
        // then deploy real curve, then... we can't change immutable.

        // ACTUAL SOLUTION: Deploy token first with a placeholder, then curve with real token,
        // then use a setter on token to update bondingCurve (make it non-immutable)

        // For now, simplest working solution:
        // 1. Deploy CreatorToken with bondingCurve = address(1) as placeholder
        // 2. Deploy BondingCurve with real token address
        // 3. Token.setBondingCurve(realCurve) - need to add this function

        // Actually let's just deploy in the right order for the MVP:
        // The token's onlyBondingCurve modifier only matters for mint()
        // If we deploy curve first, it can't call mint() on a non-existent token anyway

        // NEW APPROACH: Just deploy without linking initially, then link
        // But immutables can't be changed...

        // FINAL SOLUTION FOR MVP: Make bondingCurve in CreatorToken non-immutable
        // OR accept we need the factory to handle this specially

        // For fastest ship: Deploy curve first with placeholder token,
        // deploy token with real curve, the curve's token reference is wrong but...
        // Actually that breaks everything.

        // REAL SOLUTION: Pass both addresses through events only, don't require immutable linking
        // The BondingCurve stores the token address, Token stores the curve address
        // They just need to match when used.

        // Let's just make BondingCurve.creatorToken non-immutable and add a setter
        // That's the minimal change. But I'll do it differently:

        // Deploy token with THIS factory as temporary bondingCurve
        // Deploy curve with real token
        // The token will reject mints from non-curve, but curve will work
        // Then we need token to accept the real curve...

        // OK - cleanest minimal change: use a two-step deployment where curve sets its token after

        // FOR NOW: Just deploy, store addresses, accept the circular dep is handled by:
        // Making creatorToken in BondingCurve settable (non-immutable)

        // Deploy token first (bondingCurve will be set after)
        token = address(new CreatorToken(
            name,
            symbol,
            address(1), // Placeholder - will be updated
            wallet
        ));

        // Deploy bonding curve with real token address
        bondingCurve = address(new BondingCurve(
            usdc,
            token,
            floor_,
            ceiling_,
            midpoint_,
            steepness_,
            address(revenueDistributor),
            owner()
        ));

        // Update token's bonding curve reference
        CreatorToken(token).setBondingCurve(bondingCurve);

        // Store creator info
        creators[wallet] = CreatorInfo({
            token: token,
            bondingCurve: bondingCurve,
            wallet: wallet,
            createdAt: block.timestamp
        });

        allCreators.push(wallet);

        // Register in revenue distributor
        revenueDistributor.registerCreator(token, bondingCurve, wallet);

        // Register in lending pool
        lendingPool.registerToken(token, bondingCurve);

        emit CreatorDeployed(wallet, token, bondingCurve, name, symbol);
    }
}

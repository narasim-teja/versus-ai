// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IBondingCurve} from "./interfaces/IBondingCurve.sol";
import {IRevenueDistributor} from "./interfaces/IRevenueDistributor.sol";

/**
 * @title RevenueDistributor
 * @notice Splits streaming revenue between creator, token holders, and protocol
 * @dev Called by Yellow Network settlement to distribute USDC revenue
 */
contract RevenueDistributor is IRevenueDistributor, Ownable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @inheritdoc IRevenueDistributor
    uint256 public constant override CREATOR_SHARE = 7000; // 70%

    /// @inheritdoc IRevenueDistributor
    uint256 public constant override HOLDER_SHARE = 2000; // 20%

    /// @inheritdoc IRevenueDistributor
    uint256 public constant override PROTOCOL_SHARE = 1000; // 10%

    /// @notice Basis points denominator
    uint256 private constant BASIS_POINTS = 10000;

    // ============ Immutables ============

    /// @inheritdoc IRevenueDistributor
    address public immutable override usdc;

    // ============ State Variables ============

    /// @inheritdoc IRevenueDistributor
    address public override treasury;

    /// @notice Authorized factory that can register creators
    address public factory;

    /// @inheritdoc IRevenueDistributor
    mapping(address => address) public override creatorWallets;

    /// @inheritdoc IRevenueDistributor
    mapping(address => address) public override bondingCurves;

    /// @inheritdoc IRevenueDistributor
    mapping(address => bool) public override whitelistedSettlers;

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error NotWhitelisted();
    error CreatorNotRegistered();
    error NotAuthorized();

    // ============ Modifiers ============

    modifier onlyWhitelisted() {
        if (!whitelistedSettlers[msg.sender]) revert NotWhitelisted();
        _;
    }

    // ============ Constructor ============

    /**
     * @notice Creates a new revenue distributor
     * @param usdc_ USDC token address
     * @param treasury_ Protocol treasury address
     * @param owner_ Contract owner
     */
    constructor(
        address usdc_,
        address treasury_,
        address owner_
    ) Ownable(owner_) {
        if (usdc_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(0)) revert ZeroAddress();

        usdc = usdc_;
        treasury = treasury_;
    }

    // ============ Admin Functions ============

    /**
     * @notice Sets the authorized factory address
     * @param factory_ New factory address
     */
    function setFactory(address factory_) external onlyOwner {
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
    }

    /// @inheritdoc IRevenueDistributor
    function registerCreator(
        address token,
        address bondingCurve,
        address creatorWallet
    ) external override {
        // Allow owner OR factory to register
        if (msg.sender != owner() && msg.sender != factory) revert NotAuthorized();
        if (token == address(0)) revert ZeroAddress();
        if (bondingCurve == address(0)) revert ZeroAddress();
        if (creatorWallet == address(0)) revert ZeroAddress();

        creatorWallets[token] = creatorWallet;
        bondingCurves[token] = bondingCurve;

        emit CreatorRegistered(token, bondingCurve, creatorWallet);
    }

    /// @inheritdoc IRevenueDistributor
    function setWhitelistedSettler(address settler, bool status) external override onlyOwner {
        if (settler == address(0)) revert ZeroAddress();
        whitelistedSettlers[settler] = status;
        emit SettlerWhitelisted(settler, status);
    }

    /// @inheritdoc IRevenueDistributor
    function setTreasury(address newTreasury) external override onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    // ============ State-Changing Functions ============

    /// @inheritdoc IRevenueDistributor
    function distributeRevenue(address token, uint256 amount) external override onlyWhitelisted {
        if (amount == 0) revert ZeroAmount();

        address creatorWallet = creatorWallets[token];
        address bondingCurve = bondingCurves[token];

        if (creatorWallet == address(0) || bondingCurve == address(0)) {
            revert CreatorNotRegistered();
        }

        // Transfer USDC from settler
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), amount);

        // Calculate splits
        uint256 creatorAmount = (amount * CREATOR_SHARE) / BASIS_POINTS;
        uint256 holderAmount = (amount * HOLDER_SHARE) / BASIS_POINTS;
        uint256 protocolAmount = amount - creatorAmount - holderAmount;

        // Send to creator
        IERC20(usdc).safeTransfer(creatorWallet, creatorAmount);

        // Send to bonding curve for token holder revenue pool
        IERC20(usdc).forceApprove(bondingCurve, holderAmount);
        IBondingCurve(bondingCurve).addRevenue(holderAmount);

        // Send to treasury
        IERC20(usdc).safeTransfer(treasury, protocolAmount);

        emit RevenueDistributed(token, amount, creatorAmount, holderAmount, protocolAmount);
    }
}

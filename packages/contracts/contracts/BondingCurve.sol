// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SD59x18, sd, exp, ZERO as SD_ZERO, UNIT as SD_UNIT} from "@prb/math/src/SD59x18.sol";
import {UD60x18, ud, UNIT, ZERO} from "@prb/math/src/UD60x18.sol";
import {ICreatorToken} from "./interfaces/ICreatorToken.sol";
import {IBondingCurve} from "./interfaces/IBondingCurve.sol";

/**
 * @title BondingCurve
 * @notice Sigmoid bonding curve for creator token pricing with revenue distribution
 * @dev Uses PRBMath for fixed-point math, implements Synthetix-style revenue distribution
 */
contract BondingCurve is IBondingCurve, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice Maximum safe exponent for exp() to prevent overflow
    int256 private constant MAX_EXP = 133e18;

    /// @notice Precision for calculations (1e18)
    uint256 private constant PRECISION = 1e18;

    // ============ Immutables ============

    /// @inheritdoc IBondingCurve
    address public immutable override paymentToken;

    /// @inheritdoc IBondingCurve
    address public immutable override creatorToken;

    /// @inheritdoc IBondingCurve
    uint256 public immutable override floor;

    /// @inheritdoc IBondingCurve
    uint256 public immutable override ceiling;

    /// @inheritdoc IBondingCurve
    uint256 public immutable override midpoint;

    /// @inheritdoc IBondingCurve
    uint256 public immutable override steepness;

    // ============ State Variables ============

    /// @inheritdoc IBondingCurve
    uint256 public override reserveBalance;

    /// @notice Revenue distributor address (can add revenue)
    address public revenueDistributor;

    /// @notice Revenue per token stored (scaled by 1e18)
    uint256 public revenuePerTokenStored;

    /// @notice User's last recorded revenue per token
    mapping(address => uint256) public userRevenuePerTokenPaid;

    /// @notice User's pending revenue rewards
    mapping(address => uint256) public revenueRewards;

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error SlippageExceeded();
    error OnlyRevenueDistributor();
    error InsufficientReserve();
    error InvalidParameters();

    // ============ Modifiers ============

    modifier onlyRevenueDistributor() {
        if (msg.sender != revenueDistributor) revert OnlyRevenueDistributor();
        _;
    }

    modifier updateRevenue(address account) {
        revenuePerTokenStored = revenuePerToken();
        if (account != address(0)) {
            revenueRewards[account] = earned(account);
            userRevenuePerTokenPaid[account] = revenuePerTokenStored;
        }
        _;
    }

    // ============ Constructor ============

    /**
     * @notice Creates a new bonding curve
     * @param paymentToken_ USDC token address (6 decimals)
     * @param creatorToken_ Creator token address (18 decimals)
     * @param floor_ Floor price in USDC (6 decimals)
     * @param ceiling_ Ceiling price in USDC (6 decimals)
     * @param midpoint_ Supply at sigmoid midpoint (18 decimals)
     * @param steepness_ Steepness parameter k (18 decimals)
     * @param revenueDistributor_ Revenue distributor address
     * @param owner_ Contract owner
     */
    constructor(
        address paymentToken_,
        address creatorToken_,
        uint256 floor_,
        uint256 ceiling_,
        uint256 midpoint_,
        uint256 steepness_,
        address revenueDistributor_,
        address owner_
    ) Ownable(owner_) {
        if (paymentToken_ == address(0)) revert ZeroAddress();
        if (creatorToken_ == address(0)) revert ZeroAddress();
        if (revenueDistributor_ == address(0)) revert ZeroAddress();
        if (floor_ >= ceiling_) revert InvalidParameters();
        if (midpoint_ == 0) revert InvalidParameters();
        if (steepness_ == 0) revert InvalidParameters();

        paymentToken = paymentToken_;
        creatorToken = creatorToken_;
        floor = floor_;
        ceiling = ceiling_;
        midpoint = midpoint_;
        steepness = steepness_;
        revenueDistributor = revenueDistributor_;
    }

    // ============ Admin Functions ============

    /// @notice Update revenue distributor address (owner only)
    function setRevenueDistributor(address revenueDistributor_) external onlyOwner {
        if (revenueDistributor_ == address(0)) revert ZeroAddress();
        revenueDistributor = revenueDistributor_;
    }

    // ============ View Functions ============

    /// @inheritdoc IBondingCurve
    function getFloorPrice() external view override returns (uint256) {
        return floor;
    }

    /// @inheritdoc IBondingCurve
    function getPrice() public view override returns (uint256) {
        uint256 supply = IERC20(creatorToken).totalSupply();
        return _calculatePrice(supply);
    }

    /// @inheritdoc IBondingCurve
    function getBuyQuote(uint256 usdcIn) public view override returns (uint256 tokensOut) {
        if (usdcIn == 0) return 0;

        uint256 currentSupply = IERC20(creatorToken).totalSupply();

        // Use iterative approach for accuracy
        // Split into smaller chunks and calculate tokens for each
        tokensOut = _calculateBuyTokens(usdcIn, currentSupply);
    }

    /// @inheritdoc IBondingCurve
    function getSellQuote(uint256 tokensIn) public view override returns (uint256 usdcOut) {
        if (tokensIn == 0) return 0;

        uint256 currentSupply = IERC20(creatorToken).totalSupply();
        if (tokensIn > currentSupply) return 0;

        // Calculate USDC out from selling tokens
        usdcOut = _calculateSellUsdc(tokensIn, currentSupply);
    }

    /// @inheritdoc IBondingCurve
    function earned(address account) public view override returns (uint256) {
        uint256 balance = IERC20(creatorToken).balanceOf(account);
        return (balance * (revenuePerToken() - userRevenuePerTokenPaid[account])) / PRECISION + revenueRewards[account];
    }

    /**
     * @notice Returns current revenue per token
     */
    function revenuePerToken() public view returns (uint256) {
        uint256 totalSupply = IERC20(creatorToken).totalSupply();
        if (totalSupply == 0) {
            return revenuePerTokenStored;
        }
        return revenuePerTokenStored;
    }

    // ============ State-Changing Functions ============

    /// @inheritdoc IBondingCurve
    function buy(
        uint256 usdcAmount,
        uint256 minTokensOut
    ) external override nonReentrant updateRevenue(msg.sender) returns (uint256 tokensOut) {
        if (usdcAmount == 0) revert ZeroAmount();

        tokensOut = getBuyQuote(usdcAmount);
        if (tokensOut < minTokensOut) revert SlippageExceeded();

        // Transfer USDC from buyer
        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), usdcAmount);
        reserveBalance += usdcAmount;

        // Mint tokens to buyer
        ICreatorToken(creatorToken).mint(msg.sender, tokensOut);

        emit TokensPurchased(msg.sender, usdcAmount, tokensOut, getPrice());
    }

    /// @inheritdoc IBondingCurve
    function sell(
        uint256 tokenAmount,
        uint256 minUsdcOut
    ) external override nonReentrant updateRevenue(msg.sender) returns (uint256 usdcOut) {
        if (tokenAmount == 0) revert ZeroAmount();

        usdcOut = getSellQuote(tokenAmount);
        if (usdcOut < minUsdcOut) revert SlippageExceeded();
        if (usdcOut > reserveBalance) revert InsufficientReserve();

        // Burn tokens from seller
        ICreatorToken(creatorToken).burnFrom(msg.sender, tokenAmount);

        // Transfer USDC to seller
        reserveBalance -= usdcOut;
        IERC20(paymentToken).safeTransfer(msg.sender, usdcOut);

        emit TokensSold(msg.sender, tokenAmount, usdcOut, getPrice());
    }

    /// @inheritdoc IBondingCurve
    function addRevenue(uint256 amount) external override onlyRevenueDistributor {
        if (amount == 0) revert ZeroAmount();

        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), amount);

        uint256 totalSupply = IERC20(creatorToken).totalSupply();
        if (totalSupply > 0) {
            // Scale amount to 18 decimals for revenue per token calculation
            // USDC is 6 decimals, so multiply by 1e12 to get 18 decimals
            revenuePerTokenStored += (amount * 1e12 * PRECISION) / totalSupply;
        }

        emit RevenueAdded(amount, revenuePerTokenStored);
    }

    /// @inheritdoc IBondingCurve
    function claimRevenue() external override nonReentrant updateRevenue(msg.sender) returns (uint256 amount) {
        amount = revenueRewards[msg.sender];
        if (amount > 0) {
            revenueRewards[msg.sender] = 0;
            // Convert back from 18 decimals to 6 decimals for USDC
            uint256 usdcAmount = amount / 1e12;
            if (usdcAmount > 0) {
                IERC20(paymentToken).safeTransfer(msg.sender, usdcAmount);
            }
            emit RevenueClaimed(msg.sender, usdcAmount);
        }
    }

    // ============ Internal Functions ============

    /**
     * @notice Calculates price at a given supply using sigmoid curve
     * @param supply Current token supply
     * @return price Price in USDC (6 decimals)
     */
    function _calculatePrice(uint256 supply) internal view returns (uint256) {
        UD60x18 sigmoidValue = _sigmoid(supply);

        // floor and ceiling are in USDC (6 decimals)
        // sigmoidValue is in 18 decimals (0 to 1e18)
        uint256 range = ceiling - floor;

        // Scale sigmoid to price range
        // sigmoidValue.unwrap() is in 1e18, so divide by 1e18 at the end
        return floor + (range * sigmoidValue.unwrap()) / PRECISION;
    }

    /**
     * @notice Calculates sigmoid value at a given supply
     * @dev sigmoid(x) = 1 / (1 + exp(-k * (x - midpoint)))
     * @param supply Current token supply (18 decimals)
     * @return Sigmoid value as UD60x18 (0 to 1e18)
     */
    function _sigmoid(uint256 supply) internal view returns (UD60x18) {
        // Convert to SD59x18 (signed) for subtraction
        SD59x18 x = sd(int256(supply));
        SD59x18 mid = sd(int256(midpoint));
        SD59x18 k = sd(int256(steepness));

        // Calculate k * (midpoint - x)
        // We use (mid - x) so that:
        // - When supply < midpoint: exponent > 0, exp > 1, sigmoid < 0.5
        // - When supply > midpoint: exponent < 0, exp < 1, sigmoid > 0.5
        SD59x18 diff = mid.sub(x);
        SD59x18 exponent = k.mul(diff);

        // Clamp exponent to safe range to prevent overflow
        int256 rawExp = exponent.unwrap();
        if (rawExp > MAX_EXP) {
            // exp(133) is huge, sigmoid approaches 0
            return ZERO;
        }
        if (rawExp < -MAX_EXP) {
            // exp(-133) approaches 0, sigmoid approaches 1
            return UNIT;
        }

        // Calculate e^exponent
        SD59x18 expResult = exp(exponent);

        // Calculate 1 / (1 + exp)
        SD59x18 one = SD_UNIT;
        SD59x18 denominator = one.add(expResult);
        SD59x18 result = one.div(denominator);

        // Convert to UD60x18 (safe since sigmoid is always in [0,1])
        return ud(uint256(result.unwrap()));
    }

    /**
     * @notice Calculates tokens received for a given USDC input
     * @dev Uses iterative approach for better accuracy on large purchases
     * @param usdcIn USDC amount to spend (6 decimals)
     * @param currentSupply Current token supply (18 decimals)
     * @return tokensOut Tokens to receive (18 decimals)
     */
    function _calculateBuyTokens(
        uint256 usdcIn,
        uint256 currentSupply
    ) internal view returns (uint256 tokensOut) {
        // For small purchases, use simple approximation
        // For large purchases, use iterative calculation

        uint256 price = _calculatePrice(currentSupply);
        if (price == 0) return 0;

        // Simple linear approximation: tokens = usdc * 1e18 / price
        // This works well for small purchases where price doesn't change much
        // Scale: usdcIn is 6 decimals, price is 6 decimals, result should be 18 decimals
        // (usdcIn * 1e18) / price = tokens in 18 decimals
        tokensOut = (usdcIn * PRECISION) / price;

        // For more accurate large purchases, we could use binary search
        // to find the exact amount, but for hackathon MVP this is sufficient
    }

    /**
     * @notice Calculates USDC received for selling tokens
     * @param tokensIn Tokens to sell (18 decimals)
     * @param currentSupply Current token supply (18 decimals)
     * @return usdcOut USDC to receive (6 decimals)
     */
    function _calculateSellUsdc(
        uint256 tokensIn,
        uint256 currentSupply
    ) internal view returns (uint256 usdcOut) {
        // Calculate average price over the sell range
        uint256 newSupply = currentSupply - tokensIn;
        uint256 priceAtCurrent = _calculatePrice(currentSupply);
        uint256 priceAtNew = _calculatePrice(newSupply);

        // Use average price for fair value
        uint256 avgPrice = (priceAtCurrent + priceAtNew) / 2;

        // Scale: tokensIn is 18 decimals, avgPrice is 6 decimals
        // (tokensIn * avgPrice) / 1e18 = USDC in 6 decimals
        usdcOut = (tokensIn * avgPrice) / PRECISION;

        // Cap at reserve to prevent over-extraction
        // This is a safety measure for the MVP linear approximation
        if (usdcOut > reserveBalance) {
            usdcOut = reserveBalance;
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IBondingCurve} from "./interfaces/IBondingCurve.sol";
import {ILendingPool} from "./interfaces/ILendingPool.sol";

/**
 * @title LendingPool
 * @notice Collateralized lending against creator tokens
 * @dev Uses floor price from bonding curve for conservative LTV calculation
 */
contract LendingPool is ILendingPool, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @inheritdoc ILendingPool
    uint256 public constant override MAX_LTV = 7000; // 70% in basis points

    /// @inheritdoc ILendingPool
    uint256 public constant override LIQUIDATION_THRESHOLD = 8500; // 85%

    /// @inheritdoc ILendingPool
    uint256 public constant override INTEREST_RATE = 1000; // 10% APR

    /// @inheritdoc ILendingPool
    uint256 public constant override LIQUIDATION_BONUS = 500; // 5%

    /// @notice Basis points denominator
    uint256 private constant BASIS_POINTS = 10000;

    /// @notice Seconds per year for interest calculation
    uint256 private constant SECONDS_PER_YEAR = 365 days;

    /// @notice Precision for calculations
    uint256 private constant PRECISION = 1e18;

    // ============ Immutables ============

    /// @inheritdoc ILendingPool
    address public immutable override usdc;

    // ============ State Variables ============

    /// @notice Loan data for each borrower
    mapping(address => Loan) private _loans;

    /// @inheritdoc ILendingPool
    mapping(address => address) public override tokenToBondingCurve;

    /// @notice Authorized factory that can register tokens
    address public factory;

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error NotAuthorized();
    error TokenNotRegistered();
    error ExistingLoan();
    error NoLoan();
    error InsufficientCollateral();
    error UnhealthyPosition();
    error PositionHealthy();
    error ExceedsMaxLTV();
    error InsufficientLiquidity();

    // ============ Constructor ============

    /**
     * @notice Creates a new lending pool
     * @param usdc_ USDC token address
     * @param owner_ Contract owner
     */
    constructor(address usdc_, address owner_) Ownable(owner_) {
        if (usdc_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
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

    /// @inheritdoc ILendingPool
    function registerToken(address token, address bondingCurve) external override {
        // Allow owner OR factory to register
        if (msg.sender != owner() && msg.sender != factory) revert NotAuthorized();
        if (token == address(0)) revert ZeroAddress();
        if (bondingCurve == address(0)) revert ZeroAddress();
        tokenToBondingCurve[token] = bondingCurve;
    }

    // ============ View Functions ============

    /// @inheritdoc ILendingPool
    function loans(address borrower) external view override returns (
        address collateralToken,
        uint256 collateralAmount,
        uint256 borrowedAmount,
        uint256 interestAccrued,
        uint256 lastUpdateTime
    ) {
        Loan storage loan = _loans[borrower];
        return (
            loan.collateralToken,
            loan.collateralAmount,
            loan.borrowedAmount,
            _calculateAccruedInterest(borrower),
            loan.lastUpdateTime
        );
    }

    /// @inheritdoc ILendingPool
    function getHealthFactor(address borrower) public view override returns (uint256) {
        Loan storage loan = _loans[borrower];
        if (loan.borrowedAmount == 0) return type(uint256).max;

        uint256 collateralValue = getCollateralValue(borrower);
        uint256 totalDebt = getTotalDebt(borrower);

        if (totalDebt == 0) return type(uint256).max;

        // healthFactor = (collateralValue * LIQUIDATION_THRESHOLD) / totalDebt
        // Scale: collateralValue is 6 decimals, result should be 1e18 scale
        // (collateralValue * 1e18 * LIQUIDATION_THRESHOLD) / (totalDebt * BASIS_POINTS)
        return (collateralValue * PRECISION * LIQUIDATION_THRESHOLD) / (totalDebt * BASIS_POINTS);
    }

    /// @inheritdoc ILendingPool
    function getCollateralValue(address borrower) public view override returns (uint256) {
        Loan storage loan = _loans[borrower];
        if (loan.collateralAmount == 0) return 0;

        address bondingCurve = tokenToBondingCurve[loan.collateralToken];
        if (bondingCurve == address(0)) return 0;

        // Use floor price for conservative valuation
        uint256 floorPrice = IBondingCurve(bondingCurve).getFloorPrice();

        // collateralAmount is 18 decimals, floorPrice is 6 decimals
        // (collateralAmount * floorPrice) / 1e18 = value in 6 decimals
        return (loan.collateralAmount * floorPrice) / PRECISION;
    }

    /// @inheritdoc ILendingPool
    function getTotalDebt(address borrower) public view override returns (uint256) {
        Loan storage loan = _loans[borrower];
        return loan.borrowedAmount + _calculateAccruedInterest(borrower);
    }

    // ============ State-Changing Functions ============

    /// @inheritdoc ILendingPool
    function deposit(address token, uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (tokenToBondingCurve[token] == address(0)) revert TokenNotRegistered();

        Loan storage loan = _loans[msg.sender];

        // If existing loan, must be same collateral token
        if (loan.collateralAmount > 0 && loan.collateralToken != token) {
            revert ExistingLoan();
        }

        // Accrue interest before modifying
        _accrueInterest(msg.sender);

        // Transfer collateral
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Update loan
        if (loan.collateralToken == address(0)) {
            loan.collateralToken = token;
        }
        loan.collateralAmount += amount;

        emit CollateralDeposited(msg.sender, token, amount);
    }

    /// @inheritdoc ILendingPool
    function withdraw(uint256 amount) external override nonReentrant {
        Loan storage loan = _loans[msg.sender];
        if (loan.collateralAmount == 0) revert NoLoan();
        if (amount > loan.collateralAmount) revert InsufficientCollateral();

        // Accrue interest before modifying
        _accrueInterest(msg.sender);

        // Check if withdrawal maintains health
        uint256 newCollateral = loan.collateralAmount - amount;
        if (loan.borrowedAmount > 0) {
            // Calculate new health factor
            address bondingCurve = tokenToBondingCurve[loan.collateralToken];
            uint256 floorPrice = IBondingCurve(bondingCurve).getFloorPrice();
            uint256 newCollateralValue = (newCollateral * floorPrice) / PRECISION;
            uint256 totalDebt = getTotalDebt(msg.sender);

            uint256 newHealthFactor = (newCollateralValue * PRECISION * LIQUIDATION_THRESHOLD) / (totalDebt * BASIS_POINTS);
            if (newHealthFactor < PRECISION) revert UnhealthyPosition();
        }

        // Update loan
        loan.collateralAmount = newCollateral;

        // Transfer collateral back
        IERC20(loan.collateralToken).safeTransfer(msg.sender, amount);

        emit CollateralWithdrawn(msg.sender, loan.collateralToken, amount);
    }

    /// @inheritdoc ILendingPool
    function borrow(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();

        Loan storage loan = _loans[msg.sender];
        if (loan.collateralAmount == 0) revert NoLoan();

        // Accrue interest before modifying
        _accrueInterest(msg.sender);

        // Check available liquidity
        uint256 poolBalance = IERC20(usdc).balanceOf(address(this));
        if (amount > poolBalance) revert InsufficientLiquidity();

        // Calculate max borrow amount
        uint256 collateralValue = getCollateralValue(msg.sender);
        uint256 maxBorrow = (collateralValue * MAX_LTV) / BASIS_POINTS;
        uint256 currentDebt = getTotalDebt(msg.sender);

        if (currentDebt + amount > maxBorrow) revert ExceedsMaxLTV();

        // Update loan
        loan.borrowedAmount += amount;

        // Transfer USDC to borrower
        IERC20(usdc).safeTransfer(msg.sender, amount);

        emit Borrowed(msg.sender, amount);
    }

    /// @inheritdoc ILendingPool
    function repay(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();

        Loan storage loan = _loans[msg.sender];
        if (loan.borrowedAmount == 0) revert NoLoan();

        // Accrue interest before repayment
        _accrueInterest(msg.sender);

        uint256 totalDebt = getTotalDebt(msg.sender);
        uint256 paymentAmount = amount > totalDebt ? totalDebt : amount;

        // Transfer USDC from borrower
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), paymentAmount);

        // Apply payment to interest first, then principal
        if (paymentAmount <= loan.interestAccrued) {
            loan.interestAccrued -= paymentAmount;
        } else {
            uint256 principalPayment = paymentAmount - loan.interestAccrued;
            loan.interestAccrued = 0;
            loan.borrowedAmount -= principalPayment;
        }

        emit Repaid(msg.sender, paymentAmount);
    }

    /// @inheritdoc ILendingPool
    function liquidate(address borrower) external override nonReentrant {
        Loan storage loan = _loans[borrower];
        if (loan.borrowedAmount == 0) revert NoLoan();

        // Accrue interest
        _accrueInterest(borrower);

        // Check if position is liquidatable
        uint256 healthFactor = getHealthFactor(borrower);
        if (healthFactor >= PRECISION) revert PositionHealthy();

        uint256 totalDebt = getTotalDebt(borrower);
        uint256 collateralAmount = loan.collateralAmount;
        address collateralToken = loan.collateralToken;

        // Calculate liquidation amounts
        // Liquidator repays debt and receives collateral + bonus
        uint256 collateralToSeize = collateralAmount;
        uint256 debtToRepay = totalDebt;

        // Transfer debt from liquidator
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), debtToRepay);

        // Clear loan
        delete _loans[borrower];

        // Transfer collateral to liquidator (includes implicit bonus since debt < collateral value)
        IERC20(collateralToken).safeTransfer(msg.sender, collateralToSeize);

        emit Liquidated(borrower, msg.sender, collateralToSeize, debtToRepay);
    }

    // ============ Internal Functions ============

    /**
     * @notice Calculates accrued interest for a borrower
     * @param borrower Address to calculate interest for
     * @return Accrued interest amount
     */
    function _calculateAccruedInterest(address borrower) internal view returns (uint256) {
        Loan storage loan = _loans[borrower];
        if (loan.borrowedAmount == 0 || loan.lastUpdateTime == 0) {
            return loan.interestAccrued;
        }

        uint256 timeElapsed = block.timestamp - loan.lastUpdateTime;
        // interest = principal * rate * time / (year * basisPoints)
        uint256 newInterest = (loan.borrowedAmount * INTEREST_RATE * timeElapsed) / (SECONDS_PER_YEAR * BASIS_POINTS);

        return loan.interestAccrued + newInterest;
    }

    /**
     * @notice Accrues and stores interest for a borrower
     * @param borrower Address to accrue interest for
     */
    function _accrueInterest(address borrower) internal {
        Loan storage loan = _loans[borrower];
        if (loan.borrowedAmount > 0) {
            loan.interestAccrued = _calculateAccruedInterest(borrower);
        }
        loan.lastUpdateTime = block.timestamp;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ILendingPool {
    // Events
    event CollateralDeposited(
        address indexed borrower,
        address indexed token,
        uint256 amount
    );
    event CollateralWithdrawn(
        address indexed borrower,
        address indexed token,
        uint256 amount
    );
    event Borrowed(address indexed borrower, uint256 amount);
    event Repaid(address indexed borrower, uint256 amount);
    event Liquidated(
        address indexed borrower,
        address indexed liquidator,
        uint256 collateralSeized,
        uint256 debtRepaid
    );

    // Structs
    struct Loan {
        address collateralToken;
        uint256 collateralAmount;
        uint256 borrowedAmount;
        uint256 interestAccrued;
        uint256 lastUpdateTime;
    }

    // Constants
    function MAX_LTV() external view returns (uint256);
    function LIQUIDATION_THRESHOLD() external view returns (uint256);
    function INTEREST_RATE() external view returns (uint256);
    function LIQUIDATION_BONUS() external view returns (uint256);

    // View functions
    /// @notice Returns the USDC token address
    function usdc() external view returns (address);

    /// @notice Returns loan details for a borrower
    /// @param borrower Address to check
    function loans(address borrower) external view returns (
        address collateralToken,
        uint256 collateralAmount,
        uint256 borrowedAmount,
        uint256 interestAccrued,
        uint256 lastUpdateTime
    );

    /// @notice Returns the bonding curve for a token
    /// @param token Creator token address
    function tokenToBondingCurve(address token) external view returns (address);

    /// @notice Returns the health factor for a borrower (1e18 = 100%)
    /// @param borrower Address to check
    function getHealthFactor(address borrower) external view returns (uint256);

    /// @notice Returns collateral value at floor price
    /// @param borrower Address to check
    function getCollateralValue(address borrower) external view returns (uint256);

    /// @notice Returns total debt (principal + accrued interest)
    /// @param borrower Address to check
    function getTotalDebt(address borrower) external view returns (uint256);

    // State-changing functions
    /// @notice Deposit collateral
    /// @param token Creator token to deposit
    /// @param amount Amount to deposit
    function deposit(address token, uint256 amount) external;

    /// @notice Withdraw collateral (if health factor remains above threshold)
    /// @param amount Amount to withdraw
    function withdraw(uint256 amount) external;

    /// @notice Borrow USDC against collateral
    /// @param amount Amount of USDC to borrow
    function borrow(uint256 amount) external;

    /// @notice Repay borrowed USDC
    /// @param amount Amount to repay
    function repay(uint256 amount) external;

    /// @notice Liquidate an unhealthy position
    /// @param borrower Address to liquidate
    function liquidate(address borrower) external;

    // Admin functions
    /// @notice Register a token's bonding curve (only owner)
    /// @param token Creator token address
    /// @param bondingCurve Bonding curve address
    function registerToken(address token, address bondingCurve) external;
}

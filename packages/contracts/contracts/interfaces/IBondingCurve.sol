// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IBondingCurve {
    // Events
    event TokensPurchased(
        address indexed buyer,
        uint256 usdcIn,
        uint256 tokensOut,
        uint256 newPrice
    );
    event TokensSold(
        address indexed seller,
        uint256 tokensIn,
        uint256 usdcOut,
        uint256 newPrice
    );
    event RevenueAdded(uint256 amount, uint256 newRevenuePerToken);
    event RevenueClaimed(address indexed user, uint256 amount);

    // View functions
    /// @notice Returns the payment token (USDC) address
    function paymentToken() external view returns (address);

    /// @notice Returns the creator token address
    function creatorToken() external view returns (address);

    /// @notice Returns the floor price in USDC (6 decimals)
    function floor() external view returns (uint256);

    /// @notice Returns the ceiling price in USDC (6 decimals)
    function ceiling() external view returns (uint256);

    /// @notice Returns the midpoint supply for sigmoid curve
    function midpoint() external view returns (uint256);

    /// @notice Returns the steepness parameter (k) for sigmoid curve
    function steepness() external view returns (uint256);

    /// @notice Returns the current USDC reserve balance
    function reserveBalance() external view returns (uint256);

    /// @notice Returns the floor price (for LendingPool collateral valuation)
    function getFloorPrice() external view returns (uint256);

    /// @notice Returns the current price per token in USDC (6 decimals)
    function getPrice() external view returns (uint256);

    /// @notice Returns how many tokens you'd receive for a given USDC amount
    /// @param usdcIn Amount of USDC to spend
    function getBuyQuote(uint256 usdcIn) external view returns (uint256 tokensOut);

    /// @notice Returns how much USDC you'd receive for selling tokens
    /// @param tokensIn Amount of tokens to sell
    function getSellQuote(uint256 tokensIn) external view returns (uint256 usdcOut);

    /// @notice Returns pending revenue for an account
    /// @param account Address to check
    function earned(address account) external view returns (uint256);

    // State-changing functions
    /// @notice Buy tokens with USDC
    /// @param usdcAmount Amount of USDC to spend
    /// @param minTokensOut Minimum tokens to receive (slippage protection)
    /// @return tokensOut Amount of tokens received
    function buy(uint256 usdcAmount, uint256 minTokensOut) external returns (uint256 tokensOut);

    /// @notice Sell tokens for USDC
    /// @param tokenAmount Amount of tokens to sell
    /// @param minUsdcOut Minimum USDC to receive (slippage protection)
    /// @return usdcOut Amount of USDC received
    function sell(uint256 tokenAmount, uint256 minUsdcOut) external returns (uint256 usdcOut);

    /// @notice Add revenue to the pool (only callable by revenue distributor)
    /// @param amount Amount of USDC to add as revenue
    function addRevenue(uint256 amount) external;

    /// @notice Claim accumulated revenue
    /// @return amount Amount of USDC claimed
    function claimRevenue() external returns (uint256 amount);
}

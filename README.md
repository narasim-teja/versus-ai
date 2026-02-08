# Versus

Decentralized video streaming platform with autonomous AI agents, bonding curve tokenomics, and micropayments.

## Project Overview

Versus is a platform where:
- **Content is cryptographically pay-per-second** - Viewers pay micropayments via Yellow Network state channels
- **Creator tokens trade on bonding curves** - Each creator has a token representing claim on future streaming revenue
- **Autonomous agents manage treasuries** - AI agents create content, speculate on other creators, and make autonomous financial decisions
- **Self-sustaining economy** - Agents compete for human attention, revenue flows back to fund more creation

## Phase 1 Completed: Smart Contracts

All smart contracts have been implemented, tested, and are ready for deployment.

### Contracts

| Contract | Description | Status |
|----------|-------------|--------|
| `CreatorToken.sol` | ERC20 token for creators with restricted minting/burning | Done |
| `BondingCurve.sol` | Sigmoid pricing curve with revenue distribution (Synthetix pattern) | Done |
| `LendingPool.sol` | Collateralized lending against creator tokens (70% LTV, 85% liquidation) | Done |
| `RevenueDistributor.sol` | Splits streaming revenue 70/20/10 (creator/holders/protocol) | Done |
| `CreatorFactory.sol` | Factory for deploying new creator tokens + bonding curves | Done |

### Technical Decisions

- **Sigmoid bonding curve**: `price = floor + (ceiling - floor) * sigmoid(supply)`
  - Floor: 0.01 USDC (agents can always afford entry)
  - Ceiling: 10 USDC (prevents runaway speculation)
  - Midpoint: 10,000 tokens
  - Steepness (k): 0.01 (aggressive price movement)

- **PRBMath library**: Used for fixed-point sigmoid math with overflow protection
  - Handles signed/unsigned conversion safely
  - Clamps exp() to prevent overflow at extreme values (±133e18)

- **Synthetix StakingRewards pattern**: For revenue distribution to token holders
  - `revenuePerTokenStored` tracks accumulated revenue
  - Pro-rata distribution based on token holdings

- **Floor price valuation for lending**: Conservative LTV protects lenders even if token price dumps

### Test Results

```
20 passing tests

BondingCurve
  ✔ Should set correct parameters
  ✔ Should return floor as getFloorPrice
  ✔ Should return price near floor when supply is 0
  ✔ Should return price near midpoint when supply is at midpoint
  ✔ Should allow buying tokens with USDC
  ✔ Should allow selling tokens for USDC
  ✔ Should revert on slippage exceeded

CreatorToken
  ✔ Should set the correct name and symbol
  ✔ Should set the correct bonding curve address
  ✔ Should set the correct creator address
  ✔ Should revert on zero creator address
  ✔ Should allow bonding curve to mint tokens
  ✔ Should revert if non-bonding-curve tries to mint
  ✔ Should allow bonding curve to burn tokens without allowance
  ✔ Should allow users to burn their own tokens

Integration Tests
  ✔ Should create a creator through factory
  ✔ Should allow buying and selling tokens
  ✔ Should distribute revenue correctly (70/20/10)
  ✔ Should allow depositing collateral and borrowing
  ✔ Should support multiple creators
```

## Project Structure

```
versus/
├── packages/
│   └── contracts/           # Smart contracts (Hardhat + Viem)
│       ├── contracts/
│       │   ├── CreatorToken.sol
│       │   ├── BondingCurve.sol
│       │   ├── LendingPool.sol
│       │   ├── RevenueDistributor.sol
│       │   ├── CreatorFactory.sol
│       │   ├── mocks/
│       │   │   └── MockERC20.sol
│       │   └── interfaces/
│       │       ├── ICreatorToken.sol
│       │       ├── IBondingCurve.sol
│       │       ├── ILendingPool.sol
│       │       └── IRevenueDistributor.sol
│       ├── scripts/
│       │   ├── deploy.ts
│       │   └── seed.ts
│       ├── test/
│       │   ├── BondingCurve.test.ts
│       │   ├── CreatorToken.test.ts
│       │   └── Integration.test.ts
│       └── deployments/     # Deployed contract addresses
├── apps/                    # Future: Frontend + Backend
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm

### Installation

```bash
# Install dependencies
pnpm install

# Compile contracts
cd packages/contracts
pnpm hardhat compile

# Run tests
pnpm hardhat test

# Deploy to Base Sepolia (requires PRIVATE_KEY in .env)
pnpm hardhat run scripts/deploy.ts --network baseSepolia
```

### Environment Variables

Create a `.env` file in `packages/contracts/`:

```bash
# Chain RPC
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# Deployer private key (testnet only!)
PRIVATE_KEY=0x...

# USDC address (Base Sepolia)
BASE_SEPOLIA_USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

## Next Steps

### Phase 2: Agent Runtime
- [ ] Set up server with Hono + Bun
- [ ] Implement chain client for reading state
- [ ] Implement Circle Wallet integration
- [ ] Build decision engine for agents
- [ ] Create Alice (conservative) and Bob (aggressive) strategies

### Phase 3: Yellow Integration
- [ ] Video chunking with FFmpeg
- [ ] Chunk encryption (AES-GCM)
- [ ] Yellow session management
- [ ] Pay-per-second streaming
- [ ] Settlement → RevenueDistributor

### Phase 4: Frontend
- [ ] Agent dashboard with real-time decision logs
- [ ] Video player with Yellow payment
- [ ] Token trading interface
- [ ] Revenue claim panel

## Target Hackathon Prizes

- **Yellow Network** ($5k): Pay-per-second streaming via state channels
- **Circle/Arc** ($2.5k): Agentic commerce powered by RWA (content tokens as collateral)
- **Stork Oracle**: Price feeds and demand signals for agent decisions

## Tech Stack

- **Smart Contracts**: Solidity 0.8.28, Hardhat, OpenZeppelin, PRBMath
- **Testing**: Hardhat + Viem
- **Networks**: Base Sepolia, Arc testnet
- **Stablecoin**: USDC (6 decimals)

## License

MIT

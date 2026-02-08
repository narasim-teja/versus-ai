# Versus — Architecture & Flow Guide

## What Is Versus?

Versus is a decentralized video streaming platform where:

- **Creators** (AI agents) autonomously generate and upload encrypted videos
- **Viewers** pay per-segment via Yellow Network state channels (micropayments)
- **Revenue** flows cross-chain: Base Sepolia → ARC Testnet
- **Token holders** earn passive income from streaming revenue via bonding curves
- **Content** is created autonomously via LTX-2 (video) + Gemini (thumbnails) + LLM (ideation)

---

## Two-Chain Architecture

| Chain | ID | Purpose | Gas Token |
|-------|----|---------|-----------|
| **Base Sepolia** | 84532 | Video registry, settlement recording, USDC bridge, Nitrolite Custody channels | ETH |
| **ARC Testnet** | 5042002 | Bonding curves, revenue distribution, lending | USDC |

---

## End-to-End Flow

```
 UPLOAD                          STREAMING                         SETTLEMENT
 ──────                          ─────────                         ──────────

 Video file                      Viewer opens session              Session closes
   │                                │                                 │
   ▼                                ▼                                 ▼
 FFmpeg split into segments      Browser connects to ClearNode     1. Custody.closeChannel()
   │                             (ephemeral keypair, EIP-712 auth)     on Base Sepolia (co-signed close)
   ▼                                │                                 │
 Encrypt each segment (AES-128)     ▼                                 ▼
   │                             POST /session → server creates     2. Custody.withdrawal()
   ▼                             ClearNode app session +               on Base Sepolia (reclaim deposit)
 Build Merkle tree of keys       Custody channel (USDC deposit)       │
   │                                │                                 ▼
   ▼                                ▼                              3. VideoRegistry.recordSettlement()
 Upload to Supabase Storage      Per-segment loop:                    on Base Sepolia
   │                               Viewer signs state update           │
   ▼                               → POST /cosign                     ▼
 Store in PostgreSQL                → Server co-signs + submits     4. BridgeEscrow.initiateBridge()
 (encrypted masterSecret)          → ClearNode confirms               on Base Sepolia (lock USDC)
   │                               → Server returns AES key           │
   ▼                               → HLS.js decrypts + plays          ▼
 VideoRegistry.registerVideo()      │                              5. RevenueDistributor.distributeRevenue()
 on Base Sepolia                    ▼                                  on ARC Testnet
 (merkleRoot committed on-chain) Balance deducted per segment          │
                                 ($0.01/segment default)               ▼
                                                                   Revenue split:
                                                                     70% → creator wallet
                                                                     20% → bonding curve (token holders)
                                                                     10% → protocol treasury
```

---

## Yellow Network Integration

### What It Does

Yellow Network provides **off-chain state channel micropayments** via ClearNode. Instead of paying on-chain for every 5-second segment, the viewer deposits once and payments happen instantly off-chain through signed state updates.

### How It Works

```
Browser (Viewer)                    Server                         ClearNode
──────────────────                  ──────                         ─────────
1. Generate ephemeral keypair
2. Connect WebSocket ──────────────────────────────────────────→ wss://clearnet-sandbox.yellow.com/ws
3. auth_request ───────────────────────────────────────────────→
4. ←──────────────────────────────────────────────────────────── auth_challenge
5. Sign EIP-712 challenge
6. auth_verify ────────────────────────────────────────────────→
7. ←──────────────────────────────────────────────────────────── authenticated!

8. POST /api/videos/:id/session ──→ createAppSessionMessage() ─→ create_app_session
   { viewerAddress, depositAmount }  participants: [viewer, server]
                                     weights: [50, 50], quorum: 100
                                     + prepareCustodyChannel()
                                       (compute channel state hash)
9. ←── { appSessionId,            ←── app_session_id ←───────────
        custodyChannelData }

--- On-chain Custody channel (two-step co-sign) ---

10. Sign packedStateHex with
    ephemeral key
11. POST /custody-sign ─────────→ openCustodyChannel()
    { signature }                  depositAndCreateChannel()
                                   (USDC deposited on Base Sepolia)
12. ←── { channelId,
          closeStateHash }

--- Per segment (every 5 seconds) ---

10. Sign state update:
    version++, viewerBalance -= 0.01
11. POST /cosign ─────────────────→ Validate + co-sign
    { signedMessage, segmentIndex }  Submit to ClearNode ───────→ submit_app_state
                                     ←──────────────────────────── confirmed
12. ←── raw 16-byte AES key ←──────

--- Session close ---

15. Sign closeStateHash with
    ephemeral key
16. POST /close ──────────────────→ close_app_session ──────────→ closed
    { closeSignature }              closeCustodyChannel()
                                      → closeChannel (co-signed)
                                      → withdrawal (reclaim deposit)
                                    triggerSettlement()
                                      → Base Sepolia: record + bridge
                                      → ARC Testnet: distribute revenue
17. ←── { custodyDepositTxHash,
          channelCloseTxHash,
          custodyWithdrawTxHash,
          settlementTxHash,
          bridgeTxHash,
          distributionTxHash }
```

### Key Concepts

- **Ephemeral Keypair**: Browser generates a fresh ECDSA key per session (no wallet popups)
- **State Channel**: Viewer and server both sign allocation updates; ClearNode enforces constraints
- **Co-signing**: Server validates payment, adds its signature, submits double-signed update to ClearNode
- **Custody Channel**: On-chain USDC escrow via Nitrolite SDK — server deposits at session start, cooperatively closes with viewer's ephemeral key signature at session end
- **Two-step signing**: Both channel open and close require co-signatures from server + viewer ephemeral key. Server prepares packed state hash, browser signs with ephemeral key, server submits with both signatures
- **Asset**: `ytest.usd` (Yellow testnet USD) for ClearNode off-chain; real testnet USDC for Custody on-chain
- **Price**: $0.01 per 5-second segment (configurable via `YELLOW_PRICE_PER_SEGMENT`)
- **Deduplication**: Server tracks paid segments — re-requests for the same segment don't charge twice
- **Nonce Management**: Server wallet uses viem's `nonceManager` to prevent "nonce too low" errors across sequential Base Sepolia transactions (custody close → withdrawal → settlement → bridge)

### ClearNode URLs

| Environment | URL |
|-------------|-----|
| Sandbox | `wss://clearnet-sandbox.yellow.com/ws` |
| Faucet | `https://clearnet-sandbox.yellow.com/faucet/requestTokens` |

---

## Smart Contracts

### Base Sepolia (Chain 84532)

#### VideoRegistry (`0xf03f6d904894478699e542b6dfaa14982af5d8c3`)

Commits video integrity data on-chain. Called at upload time and settlement time.

```
registerVideo(videoIdHash, merkleRoot, creator, totalSegments)
  → emits VideoRegistered(...)
  → Called after video upload succeeds

recordSettlement(videoIdHash, viewer, segmentsWatched, totalPaid, yellowSessionId)
  → emits SettlementRecorded(...)
  → Called when streaming session closes
```

- `videoIdHash` = keccak256 of the video UUID
- Owner-only (server wallet)
- Explorer: https://sepolia.basescan.org

#### Nitrolite Custody (`0x019B65A265EB3363822f2752141b3dF16131b262`)

On-chain state channel escrow using the Nitrolite SDK (`@erc7824/nitrolite`). The server deposits testnet USDC at session start; the channel is cooperatively closed at session end with both participants' signatures.

```
Two-step open flow:
  1. Server: prepareCustodyChannel() → compute packedStateHex
  2. Browser: sign packedStateHex with ephemeral key
  3. Server: depositAndCreateChannel(USDC, amount, {channel, initialState, viewerSig})

Two-step close flow:
  1. Server: computeCloseStateHash() → sent to browser at open time
  2. Browser: sign closeStateHash at close time
  3. Server: closeChannel({finalState, viewerCloseSignature})
  4. Server: withdrawal(USDC, totalDeposited)
```

- Both initial allocations are 0 (Custody checks per-participant deposits vs allocations)
- Challenge duration: 3600 seconds (1 hour minimum)
- Graceful degradation: if on-chain fails, streaming continues via ClearNode only
- Uses viem's `nonceManager` on the server wallet to prevent nonce races between sequential txs

#### Nitrolite Adjudicator (`0x7c7ccbc98469190849BCC6c926307794fDfB11F2`)

Dispute resolution contract for Nitrolite state channels. Referenced by the Custody contract during channel creation.

#### BridgeEscrow (`0x18603a572d318434bfc3867ec31fa92551384d4a`)

Locks USDC on Base Sepolia as part of the cross-chain bridge demo (CCTP pattern).

```
initiateBridge(amount, destinationChainId, creator, creatorToken)
  → Transfers USDC from caller to escrow
  → emits BridgeInitiated(nonce, amount, 84532, 5042002, creator, creatorToken)
```

- USDC on Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Destination chain: ARC Testnet (5042002)
- Owner-only

### ARC Testnet (Chain 5042002)

#### RevenueDistributor (`0xFb9499118e785EC41Fd0361C80031df1aaa7e579`)

Splits streaming revenue three ways:

```
distributeRevenue(creatorTokenAddress, amount)
  → 70% to creator wallet
  → 20% to bonding curve (addRevenue → token holders can claim)
  → 10% to protocol treasury
  → emits RevenueDistributed(token, amount, creatorAmt, holderAmt, protocolAmt)
```

- Caller must be a whitelisted settler
- Server wallet (`0x838fDad...`) should be whitelisted via `setWhitelistedSettler()`

#### BondingCurve (per creator)

Sigmoid curve pricing for creator tokens. Holders earn passive revenue from streaming.

```
Price formula: floor + (ceiling - floor) / (1 + e^(-k * (supply - midpoint)))

Default params:
  floor     = 0.01 USDC
  ceiling   = 10 USDC
  midpoint  = 10,000 tokens
  steepness = 0.01

Key functions:
  buy(usdcAmount, minTokensOut)   — Purchase creator tokens
  sell(tokenAmount, minUsdcOut)   — Sell creator tokens
  addRevenue(amount)              — Add USDC to holder pool (only RevenueDistributor)
  claimRevenue()                  — Holders claim accumulated USDC
  getPrice()                      — Current token price
  getBuyQuote(usdcIn)            — Preview purchase
  getSellQuote(tokensIn)         — Preview sale
```

#### CreatorFactory (`0x3DAe7840cC5ACf75548a430651af921a29EF744D`)

Deploys a new CreatorToken + BondingCurve in one transaction:

```
createCreator(name, symbol, creatorWallet)
  → Deploys CreatorToken (ERC20, mint/burn restricted to bonding curve)
  → Deploys BondingCurve (sigmoid pricing, USDC-denominated)
  → Registers on RevenueDistributor
```

#### LendingPool (`0xF6D8013c2C11f8895118A01a44df52dce143daE6`)

LTV-based lending for agents to borrow USDC against token holdings.

---

## Agent Token Addresses

| Agent | Role | Circle Wallet | Token Address | Bonding Curve |
|-------|------|---------------|---------------|---------------|
| **Alice** | Academic/Conservative | `0xb82dfb0257642a9b9b1b01c98a4f7469bfea714e` | `0xC2061D6a3c6df9Dd2dD9947e58cD146e6bDC55Dc` | `0x521f67CB4f410b4DD13B0E95eb30C3aAF9a641ee` |
| **Bob** | Degen/Aggressive | `0x4b47053879d4131ac5812e64b86b1b8deb55626d` | `0xc2149175e044c2fA7654C40B20d29253E859E699` | `0x31508a1dc0bb348A317396e3F44431b549EDCEdd` |

### Agent Trading Strategies

**Alice (Academic)**:
- Conservative: 50% max LTV, 2 USDC min buffer, 5 USDC target buffer, 50% speculation budget
- Buy signals (any ONE is enough): Revenue growth ≥ 2%, token near floor with growing supply, excess treasury + no position (diversification), bullish sentiment + excess capital, small research position (1-3 USDC)
- Sell signals: Stop-loss at -10%, take-profit at +25%

**Bob (Degen)**:
- Aggressive: 65% max LTV, 1 USDC min buffer, 3 USDC target buffer, 80% speculation budget
- Buy signals (any ONE is enough): Revenue growth ≥ 1%, token near floor (early accumulation), excess treasury above 3 USDC sitting idle, neutral/bullish sentiment, no position in available token (FOMO), increase existing position
- Sell signals: Stop-loss at -20%, take-profit at +15%, need capital for better opportunity
- Philosophy: "idle capital is wasted capital" — ALWAYS be invested

Both agents use OpenRouter LLM (DeepSeek) for decision-making with rule-based fallback. Decision cycles run every 15 seconds with staggered starts to avoid RPC rate limits.

### Agent Runtime Mitigations

- **RPC rate limiting**: ARC testnet limits to 20 req/s. State reads are sequentialized (not parallel) and agent starts are staggered by `interval / agentCount` ms
- **LLM address validation**: If the LLM omits or zeroes out `bondingCurveAddress`, the validator auto-resolves it from `state.otherCreators` (buys) or `holdings` (sells)
- **Market sentiment**: Stork Oracle provides ETH/BTC prices for sentiment analysis (bullish/neutral/bearish based on 24h avg change >2%/<-2%). Exposed via `/api/agents/:id/state` endpoint

### Autonomous Video Generation

Each agent autonomously creates video content on a scheduled cycle, powered by three AI services:

| Service | Purpose | Model | Output |
|---------|---------|-------|--------|
| **OpenRouter** (LLM) | Content ideation — title, description, prompts | Configurable (default: Claude Sonnet) | JSON with video/thumbnail prompts |
| **LTX-2** | Text-to-video generation | `ltx-2-pro` at 1920x1080 | MP4 buffer (6/8/10 seconds) |
| **Gemini** | Thumbnail image generation | `gemini-2.5-flash-image` | PNG uploaded to Supabase |

#### Schedule

```
Alice: T+0, T+4h, T+8h, T+12h, ...   (serene nature & landscapes)
Bob:   T+2h, T+6h, T+10h, T+14h, ... (wildlife & animals)
```

- **Interval**: 4 hours (configurable via `VIDEO_GEN_INTERVAL_MS`)
- **Stagger**: 2 hours between agents (configurable via `VIDEO_GEN_OFFSET_MS`)
- **Restart-safe**: Scheduler queries DB on startup — if a generation happened recently, it waits for the remaining interval instead of re-triggering

#### Pipeline (6 steps)

```
Scheduler triggers
    │
    ▼
┌──────────────────┐
│  1. Ideate       │  OpenRouter LLM generates title, description,
│  (OpenRouter)    │  video prompt, thumbnail prompt, duration (6/8/10s)
└──────────────────┘  Avoids repeating recent titles from DB
    │
    ▼
┌──────────────────┐
│  2. Generate     │  LTX-2 API: POST text-to-video
│  (LTX-2 Pro)    │  Returns MP4 buffer in-memory (not saved to disk)
└──────────────────┘  10-minute timeout, $0.06/sec cost
    │
    ▼
┌──────────────────┐
│  3. Thumbnail    │  Gemini: generateContent with responseModalities: ["image"]
│  (Gemini)        │  Upload PNG to Supabase: thumbnails/{videoId}.png
└──────────────────┘  Non-fatal — continues without thumbnail on failure
    │
    ▼
┌──────────────────┐
│  4. Process      │  Existing video pipeline: FFmpeg → AES encrypt →
│  (FFmpeg)        │  Merkle tree → HLS packaging → Supabase upload
└──────────────────┘  Same pipeline as manual uploads
    │
    ▼
┌──────────────────┐
│  5. Store        │  INSERT into videos table with all metadata,
│  (PostgreSQL)    │  thumbnailUri, creator wallet, token address
└──────────────────┘
    │
    ▼
┌──────────────────┐
│  6. Register     │  VideoRegistry.registerVideo() on Base Sepolia
│  (On-Chain)      │  Fire-and-forget (non-blocking)
└──────────────────┘
```

#### Agent Content Characters

| | Alice (Serene) | Bob (Wild) |
| | --- | --- |
| **Theme** | Calm nature & landscapes | Animals & wildlife action |
| **Topics** | Ocean waves, mountains, forests, sunsets, rain, snow | Dogs, cats, fish, birds, butterflies, horses, wolves |
| **Visual style** | Slow cinematic, golden hour, atmospheric, meditative | Dynamic, vivid colors, macro close-ups, tracking shots |
| **Tone** | Peaceful, contemplative | Energetic, playful, awe-inspiring |

Character files: `agents/configs/alice-character.ts`, `agents/configs/bob-character.ts`

#### LTX-2 Constraints

- **Durations**: Only 6, 8, or 10 seconds supported at 1920x1080 (enforced in code)
- **Cost**: $0.06/second → $0.36–$0.60 per video, ~$2.16–$3.60/day (6 videos)
- **Title/description limits**: Title max 80 chars, description max 200 chars (enforced after LLM response)

#### DB Table: `video_generations`

Tracks the lifecycle of each autonomous generation attempt.

| Column | Purpose |
|--------|---------|
| `agentId` | FK to agents (alice/bob) |
| `status` | pending → ideating → generating_video → generating_thumbnail → processing → uploading → completed / failed |
| `title`, `description` | LLM-generated content metadata |
| `videoPrompt`, `thumbnailPrompt` | Prompts sent to LTX-2 and Gemini |
| `duration` | Requested video duration (6/8/10) |
| `videoId` | FK to videos table (set on completion) |
| `costEstimate` | Estimated LTX-2 cost in USD |
| `error` | Error message if failed |

#### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agents/schedules` | GET | All agents' schedule statuses |
| `/api/agents/:id/schedule` | GET | Single agent schedule (countdown, last generation, count) |
| `/api/agents/:id/generate` | POST | Force-trigger video generation (testing/manual) |

#### Frontend: VideoScheduleCard

Displayed on each agent's detail page (`/agents/:id`):
- Live countdown timer (ticks every 1s) showing time until next video
- Progress bar with status labels during active generation
- Last generation result (title + success/failure icon)
- Total videos generated count (persisted across server restarts via DB)

#### Error Handling

| Scenario | Handling |
|---|---|
| OpenRouter fails | Generation marked "failed", retry next 4h cycle |
| LTX-2 timeout (10min) | AbortController, marked "failed" |
| Gemini thumbnail fails | Non-fatal — video continues without thumbnail |
| processVideo fails (FFmpeg) | Marked "failed" |
| Server restart mid-generation | Schedule recalculated from DB, stale record stays |
| Overlapping generation | Skipped with warning log |

---

## Tokenomics / Revenue Flow

```
Viewer pays $0.50 for 50 segments (example)
                    │
                    ▼
        ┌───────────────────────┐
        │  Session Close        │
        │  totalPaid = $0.50    │
        └───────────────────────┘
                    │
     ┌──────────────┼──────────────┐
     ▼              ▼              ▼
 Creator (70%)  Holders (20%)  Protocol (10%)
   $0.35          $0.10          $0.05
     │              │              │
     ▼              ▼              ▼
 Direct to      BondingCurve   Protocol
 creator's      .addRevenue()  treasury
 wallet         (distributed   address
                pro-rata to
                token holders
                via claimRevenue())
```

### How Token Holders Earn

1. Someone buys Alice's token on the bonding curve (price goes up)
2. Viewers watch Alice's videos, paying per-segment
3. On session close, 20% of revenue goes to `BondingCurve.addRevenue()`
4. Revenue accumulates as `revenuePerTokenStored`
5. Token holders call `claimRevenue()` to withdraw their share (proportional to holdings)

### USDC Addresses

| Chain | Address | Decimals |
|-------|---------|----------|
| ARC Testnet | `0x3600000000000000000000000000000000000000` | 6 |
| Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 6 |

---

## Server Wallet

The server uses a single private key (`YELLOW_SERVER_PRIVATE_KEY`) for:

| Operation | Chain |
|-----------|-------|
| ClearNode authentication & co-signing | Yellow (Sepolia) |
| Custody.depositAndCreateChannel() | Base Sepolia |
| Custody.closeChannel() | Base Sepolia |
| Custody.withdrawal() | Base Sepolia |
| VideoRegistry.registerVideo() | Base Sepolia |
| VideoRegistry.recordSettlement() | Base Sepolia |
| BridgeEscrow.initiateBridge() | Base Sepolia |
| RevenueDistributor.distributeRevenue() | ARC Testnet |

**Address**: `0x838fDad90E28DE95DAB994EA4b4d526972610985`

This wallet must:
- Be the owner of VideoRegistry and BridgeEscrow (it deployed them)
- Be whitelisted as a settler on RevenueDistributor
- Have ETH on Base Sepolia for gas
- Have USDC on both chains for bridge/distribution operations

---

## Video Processing Pipeline

Used by both manual uploads and autonomous generation. For autonomous generation, the input is an in-memory MP4 buffer from LTX-2 (never saved to disk).

```
Input video (MP4/MOV/WebM or in-memory Buffer from LTX-2)
        │
        ▼
┌──────────────────┐
│  FFmpeg          │  Split into 5-second .ts segments
│  segmentation    │  Extract duration, count segments
└──────────────────┘
        │
        ▼
┌──────────────────┐
│  Encryption      │  Generate random masterSecret
│  (AES-128-CBC)   │  Derive per-segment keys: HMAC(masterSecret, videoId+index)
│                  │  Encrypt each .ts segment
└──────────────────┘
        │
        ▼
┌──────────────────┐
│  Merkle Tree     │  Leaves = segment key hashes
│                  │  Compute merkleRoot (committed on-chain)
│                  │  Serialize full tree (stored in DB for proof generation)
└──────────────────┘
        │
        ▼
┌──────────────────┐
│  HLS Packaging   │  Generate master.m3u8 playlist
│                  │  Key URLs point to /api/videos/:id/key/:segment
│                  │  Each segment references its encrypted .ts file
└──────────────────┘
        │
        ▼
┌──────────────────┐
│  Upload          │  All files → Supabase Storage bucket
│  (Supabase)      │  Returns contentUri (master.m3u8 URL)
└──────────────────┘
        │
        ▼
┌──────────────────┐
│  Database        │  Store: videoId, masterSecret (encrypted at rest),
│  (PostgreSQL)    │  merkleRoot, merkleTreeData, contentUri, metadata
└──────────────────┘
        │
        ▼
┌──────────────────┐
│  On-Chain        │  VideoRegistry.registerVideo(hash(videoId), merkleRoot, creator, segments)
│  (Base Sepolia)  │  → registryTxHash stored in DB
│                  │  → "On-Chain Verified" badge on frontend
└──────────────────┘
```

### Key Delivery (Pay-Per-View)

When HLS.js needs a decryption key for a segment:

1. CosignLoader intercepts the key URL (`/key/:segment`)
2. Frontend signs a state update (deducting $0.01 from viewer balance)
3. POSTs to `/api/videos/:id/cosign` with signed message
4. Server validates balance, co-signs, submits to ClearNode
5. Server derives the AES key: `HMAC-SHA256(masterSecret, videoId + segmentIndex)` truncated to 16 bytes
6. Returns raw 16-byte key as `application/octet-stream`
7. HLS.js uses key to decrypt the `.ts` segment in-browser

---

## Database Schema (Key Tables)

### `videos`
Stores video metadata, encrypted crypto material, and on-chain references.

| Column | Purpose |
|--------|---------|
| `masterSecret` | AES-256-GCM encrypted master key for deriving segment keys |
| `merkleRoot` | Committed on-chain via VideoRegistry |
| `registryTxHash` | Base Sepolia tx hash of the on-chain commitment |
| `creatorWallet` | Denormalized from agent (for settlement lookup) |
| `creatorTokenAddress` | Denormalized from agent (for revenue distribution) |

### `yellowSessions`
Tracks state channel payment sessions with cross-chain settlement results.

| Column | Purpose |
|--------|---------|
| `viewerBalance` / `creatorBalance` | Current state channel allocations |
| `channelId` | Nitrolite on-chain state channel ID |
| `custodyDepositTxHash` | Base Sepolia: Custody.depositAndCreateChannel() tx |
| `channelCloseTxHash` | Base Sepolia: Custody.closeChannel() tx |
| `custodyWithdrawTxHash` | Base Sepolia: Custody.withdrawal() tx |
| `settlementTxHashBase` | Base Sepolia: VideoRegistry.recordSettlement() tx |
| `bridgeTxHash` | Base Sepolia: BridgeEscrow.initiateBridge() tx |
| `distributionTxHash` | ARC Testnet: RevenueDistributor.distributeRevenue() tx |

### `agents`
Agent config with Circle wallet and ARC contract addresses.

| Column | Purpose |
|--------|---------|
| `evmAddress` | Circle-managed wallet on ARC Testnet |
| `tokenAddress` | CreatorToken contract on ARC |
| `bondingCurveAddress` | BondingCurve contract on ARC |

### `trades`
Persists bonding curve trade events (TokensPurchased/TokensSold) for chart rendering.

| Column | Purpose |
|--------|---------|
| `tokenAddress` | Which creator token was traded (indexed) |
| `bondingCurveAddress` | Which bonding curve executed the trade |
| `side` | `buy` or `sell` |
| `trader` | Buyer/seller wallet address |
| `usdcAmount` | USDC amount (6 decimals, BigInt string) |
| `tokenAmount` | Token amount (18 decimals, BigInt string) |
| `price` | Post-trade price from bonding curve event |
| `txHash` | On-chain transaction hash |
| `timestamp` | Unix ms, indexed for time-series queries |

Populated in real-time by the event watcher callbacks (`onPurchase`/`onSale`) in `index.ts`.

### `video_generations`
Tracks autonomous video generation lifecycle for each agent.

| Column | Purpose |
|--------|---------|
| `agentId` | FK to agents (alice/bob) |
| `status` | Generation state: pending → ideating → generating_video → generating_thumbnail → processing → uploading → completed/failed |
| `videoPrompt` / `thumbnailPrompt` | Prompts sent to LTX-2 and Gemini |
| `videoId` | FK to videos table (set on successful completion) |
| `costEstimate` | LTX-2 cost in USD (duration * $0.06) |
| `error` | Error message if generation failed |

Indexed on `agentId` and `status`. Used by the scheduler to restore generation count and last generation status across server restarts.

---

## Frontend Architecture

| Page / Component | What It Does |
|------------------|-------------|
| `/videos` | Lists all videos with metadata badges |
| `/videos/[videoId]` | Video detail + player + "On-Chain Verified" badge |
| `/agents/[agentId]` | Agent detail with live metrics, trading chart, trade history, videos, generation schedule |
| `VideoScheduleCard` | Live countdown to next video, generation progress bar, total count (DB-persisted) |
| `VideoPlayer` | HLS.js player with CosignLoader for key interception |
| `PaymentOverlay` | Shows live balance, segments watched, cost ticker |
| `SettlementSummary` | After session close: up to 6 tx cards with explorer links |
| `TradingChart` | DexScreener-style area chart using TradingView Lightweight Charts (10s polling) |
| `TradeHistory` | Scrollable list of recent trades with BUY/SELL badges, price, amount, time |
| `WalletProvider` | Circle wallet connection (ARC Testnet) |

### Trading Chart Architecture

```
Event Watcher (4s polls)  →  trades table (PostgreSQL)  →  REST API  →  Frontend Chart
  onPurchase / onSale          INSERT per event              /api/trading/chart/:token
                                                             (OHLCV candle aggregation)
                                                             /api/trading/history/:token
                                                             (raw trade list)
```

- **Library**: TradingView Lightweight Charts (~45KB, area chart with gradient fill)
- **Polling**: Frontend fetches candles + trades every 10 seconds via `useTradingChart` hook
- **Candle aggregation**: Server-side bucketing into 1m/5m/15m/1h timeframes with carry-forward for empty periods
- **Fallback**: If no trades exist, queries current on-chain bonding curve price as single data point

### HLS.js Custom Loader (CosignLoader)

```
HLS.js requests key URL → CosignLoader intercepts /key/:segment pattern
  → Calls signAndRequestKey(videoId, segmentIndex)
    → Signs state update with ephemeral key
    → POSTs to /cosign endpoint
    → Returns raw AES key ArrayBuffer
  → HLS.js decrypts segment in-browser
```

Non-key requests (manifests, .ts segments) pass through to the default XHR loader.

---

## Explorer Links

| Chain | Explorer | Example |
|-------|----------|---------|
| Base Sepolia | https://sepolia.basescan.org/tx/{hash} | Settlement & bridge txs |
| ARC Testnet | https://explorer-testnet.arc.dev/tx/{hash} | Revenue distribution txs |

---

## Environment Variables Quick Reference

### Required for Core Flow

```bash
# Database
DATABASE_URL=postgresql://...

# Storage
SUPABASE_URL=https://...
SUPABASE_SERVICE_KEY=...

# Video encryption
ENCRYPTION_KEY=<32-byte hex>

# Yellow Network (streaming payments)
YELLOW_SERVER_PRIVATE_KEY=0x...
YELLOW_CLEARNODE_URL=wss://clearnet-sandbox.yellow.com/ws
YELLOW_ASSET=ytest.usd
YELLOW_PRICE_PER_SEGMENT=0.01

# Base Sepolia (on-chain video registry + bridge)
VIDEO_REGISTRY_ADDRESS=0xf03f6d904894478699e542b6dfaa14982af5d8c3
BRIDGE_ESCROW_ADDRESS=0x18603a572d318434bfc3867ec31fa92551384d4a
BASE_SEPOLIA_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e

# Nitrolite Custody (on-chain state channels)
NITROLITE_CUSTODY_ADDRESS=0x019B65A265EB3363822f2752141b3dF16131b262
NITROLITE_ADJUDICATOR_ADDRESS=0x7c7ccbc98469190849BCC6c926307794fDfB11F2

# ARC Testnet (revenue distribution)
REVENUE_DISTRIBUTOR_ADDRESS=0xFb9499118e785EC41Fd0361C80031df1aaa7e579
USDC_ADDRESS=0x3600000000000000000000000000000000000000

# Agent tokens
ALICE_TOKEN_ADDRESS=0xC2061D6a3c6df9Dd2dD9947e58cD146e6bDC55Dc
ALICE_BONDING_CURVE_ADDRESS=0x521f67CB4f410b4DD13B0E95eb30C3aAF9a641ee
BOB_TOKEN_ADDRESS=0xc2149175e044c2fA7654C40B20d29253E859E699
BOB_BONDING_CURVE_ADDRESS=0x31508a1dc0bb348A317396e3F44431b549EDCEdd
```

### Optional

```bash
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org           # default
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network     # default
VIDEO_SEGMENT_DURATION=5                                  # default
VIDEO_QUALITY=720p                                        # default
OPENROUTER_API_KEY=...                                    # for LLM agent decisions + video ideation
CIRCLE_API_KEY=...                                        # for Circle wallet management
STORK_API_KEY=...                                         # for oracle price feeds

# Autonomous Video Generation
LTX_API_KEY=...                                           # LTX-2 text-to-video ($0.06/sec)
GEMINI_API_KEY=...                                        # Gemini thumbnail generation
VIDEO_GEN_INTERVAL_MS=14400000                            # 4 hours (default)
VIDEO_GEN_OFFSET_MS=7200000                               # 2 hour stagger (default)
```

---


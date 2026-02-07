export const config = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
  wsBaseUrl: process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001",
  circleAppId: process.env.NEXT_PUBLIC_CIRCLE_APP_ID || "",
  usdcAddress:
    process.env.NEXT_PUBLIC_USDC_ADDRESS ||
    "0x3600000000000000000000000000000000000000",
  clearNodeUrl:
    process.env.NEXT_PUBLIC_CLEARNODE_URL ||
    "wss://clearnet-sandbox.yellow.com/ws",
  yellowAsset: process.env.NEXT_PUBLIC_YELLOW_ASSET || "ytest.usd",
  yellowPricePerSegment:
    process.env.NEXT_PUBLIC_YELLOW_PRICE_PER_SEGMENT || "0.01",
} as const;

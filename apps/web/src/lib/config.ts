export const config = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
  wsBaseUrl: process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001",
  circleAppId: process.env.NEXT_PUBLIC_CIRCLE_APP_ID || "",
  usdcAddress:
    process.env.NEXT_PUBLIC_USDC_ADDRESS ||
    "0x3600000000000000000000000000000000000000",
} as const;

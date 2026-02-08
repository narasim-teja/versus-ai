/**
 * Yellow Network ClearNode WebSocket Client
 *
 * Manages singleton WebSocket connection to Yellow ClearNode,
 * handles authentication via session keys, and provides
 * message send/receive helpers for app session operations.
 */

import {
  createAuthRequestMessage,
  createAuthVerifyMessage,
  createECDSAMessageSigner,
  createEIP712AuthMessageSigner,
  createGetConfigMessage,
  parseAnyRPCResponse,
  parseAuthChallengeResponse,
  parseAuthVerifyResponse,
  parseGetConfigResponse,
  type RPCNetworkInfo,
  type MessageSigner,
} from "@erc7824/nitrolite";
import {
  createWalletClient,
  http,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { sepolia } from "viem/chains";
import { env } from "../../utils/env";
import { logger } from "../../utils/logger";

// ─── Types ───────────────────────────────────────────────────────────

export interface YellowClient {
  ws: WebSocket;
  serverAddress: Address;
  sessionSigner: MessageSigner;
  isAuthenticated: boolean;
  networks: RPCNetworkInfo[];
  sendAndWait: (message: string, timeoutMs?: number) => Promise<any>;
}

// ─── Singleton State ─────────────────────────────────────────────────

let yellowClient: YellowClient | null = null;
let connectPromise: Promise<YellowClient> | null = null;

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Check if Yellow Network integration is configured
 */
export function isYellowConfigured(): boolean {
  return Boolean(env.YELLOW_SERVER_PRIVATE_KEY);
}

/**
 * Get or create authenticated Yellow client singleton.
 * Lazy-initialized on first call.
 */
export async function getYellowClient(): Promise<YellowClient> {
  if (yellowClient?.isAuthenticated) {
    return yellowClient;
  }

  // Prevent duplicate connection attempts
  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = initializeClient();

  try {
    yellowClient = await connectPromise;
    return yellowClient;
  } finally {
    connectPromise = null;
  }
}

/**
 * Disconnect from ClearNode and clean up
 */
export function disconnectYellow(): void {
  if (yellowClient?.ws) {
    try {
      yellowClient.ws.close();
    } catch {
      // ignore close errors
    }
  }
  yellowClient = null;
  connectPromise = null;
  logger.info("Yellow Network disconnected");
}

// ─── Internal Implementation ─────────────────────────────────────────

/**
 * Pending response handlers keyed by request ID
 */
const pendingRequests = new Map<
  number,
  { resolve: (value: any) => void; reject: (reason: any) => void }
>();

/**
 * Initialize client: connect WebSocket, authenticate, fetch config
 */
async function initializeClient(): Promise<YellowClient> {
  const serverPrivateKey = env.YELLOW_SERVER_PRIVATE_KEY as Hex;
  const account = privateKeyToAccount(serverPrivateKey);
  const serverAddress = account.address;

  // Generate ephemeral session key for ClearNode operations
  const sessionPrivateKey = generatePrivateKey();
  const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);

  // Create wallet client for EIP-712 auth signing
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(),
  });

  logger.info({ address: serverAddress }, "Connecting to Yellow ClearNode...");

  // Connect WebSocket
  const ws = await connectWebSocket(env.YELLOW_CLEARNODE_URL);

  // Set up message handler
  ws.addEventListener("message", (event: MessageEvent) => {
    handleMessage(event.data.toString());
  });

  ws.addEventListener("close", () => {
    logger.warn("Yellow ClearNode WebSocket closed");
    if (yellowClient) {
      yellowClient.isAuthenticated = false;
    }
  });

  ws.addEventListener("error", (error: Event) => {
    logger.error({ error }, "Yellow ClearNode WebSocket error");
  });

  // Respond to server pings to keep connection alive
  ws.addEventListener("message", (event: MessageEvent) => {
    try {
      const parsed = JSON.parse(event.data.toString());
      const method = parsed.res?.[1] || parsed.req?.[1];
      if (method === "ping") {
        // Respond with pong
        const pongMsg = JSON.stringify({
          res: [parsed.res?.[0] || parsed.req?.[0], "pong", {}, Date.now()],
          sig: [],
        });
        ws.send(pongMsg);
      }
    } catch {
      // ignore non-JSON
    }
  });

  // Send periodic pings every 30 seconds
  const pingInterval = setInterval(async () => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(pingInterval);
      return;
    }
    try {
      const pingMsg = JSON.stringify({
        req: [Date.now(), "ping", {}, Date.now()],
        sig: [],
      });
      ws.send(pingMsg);
    } catch {
      // ignore send errors
    }
  }, 30000);

  // Build sendAndWait helper
  let requestCounter = 0;
  const sendAndWait = (message: string, timeoutMs = 15000): Promise<any> => {
    return new Promise((resolve, reject) => {
      // Extract request ID from the message
      try {
        const parsed = JSON.parse(message);
        const reqId = parsed.req?.[0] ?? ++requestCounter;

        pendingRequests.set(reqId, { resolve, reject });

        const timer = setTimeout(() => {
          pendingRequests.delete(reqId);
          reject(new Error(`Yellow RPC timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        // Wrap resolve to clear timer
        const originalResolve = resolve;
        pendingRequests.set(reqId, {
          resolve: (value: any) => {
            clearTimeout(timer);
            originalResolve(value);
          },
          reject: (reason: any) => {
            clearTimeout(timer);
            reject(reason);
          },
        });

        ws.send(message);
      } catch (err) {
        reject(err);
      }
    });
  };

  const client: YellowClient = {
    ws,
    serverAddress,
    sessionSigner,
    isAuthenticated: false,
    networks: [],
    sendAndWait,
  };

  // ─── Authenticate ───

  // Shared auth params (must match between auth_request and EIP-712 signer)
  const authAllowances = [{ asset: env.YELLOW_ASSET, amount: "1000000000" }];
  const authExpiresAt = BigInt(Math.floor(Date.now() / 1000) + 86400); // 24 hours
  const authScope = "app";
  const authApplication = "versus-streaming";

  // Step 1: Send auth_request
  const authRequestMsg = await createAuthRequestMessage({
    address: serverAddress,
    session_key: sessionAccount.address,
    application: authApplication,
    allowances: authAllowances,
    expires_at: authExpiresAt,
    scope: authScope,
  });

  ws.send(authRequestMsg);

  // Step 2: Wait for auth_challenge
  const challengeRaw = await waitForMethod(ws, "auth_challenge", 10000);
  const challengeResponse = parseAuthChallengeResponse(challengeRaw);
  const challengeMessage = challengeResponse.params.challengeMessage;

  // Step 3: Sign challenge with MAIN WALLET via EIP-712 and send auth_verify
  const eip712AuthSigner = createEIP712AuthMessageSigner(
    walletClient,
    {
      scope: authScope,
      session_key: sessionAccount.address,
      expires_at: authExpiresAt,
      allowances: authAllowances,
    },
    { name: authApplication },
  );

  const authVerifyMsg = await createAuthVerifyMessage(
    eip712AuthSigner,
    challengeResponse,
  );

  ws.send(authVerifyMsg);

  // Step 4: Wait for auth_verify response
  const verifyRaw = await waitForMethod(ws, "auth_verify", 10000);
  const verifyResponse = parseAuthVerifyResponse(verifyRaw);

  if (!verifyResponse.params.success) {
    throw new Error("Yellow ClearNode authentication failed");
  }

  client.isAuthenticated = true;
  logger.info(
    { address: serverAddress, sessionKey: sessionAccount.address },
    "Yellow ClearNode authenticated successfully",
  );

  // ─── Get Config ───
  try {
    const configMsg = await createGetConfigMessage(sessionSigner);
    ws.send(configMsg);
    const configRaw = await waitForMethod(ws, "get_config", 10000);
    const configResponse = parseGetConfigResponse(configRaw);
    client.networks = configResponse.params.networks;
    logger.info(
      { networks: client.networks.map((n) => `${n.name}(${n.chainId})`) },
      "Yellow ClearNode config loaded",
    );
  } catch (err) {
    logger.warn({ err }, "Failed to load ClearNode config (non-fatal)");
  }

  return client;
}

/**
 * Connect WebSocket with Promise wrapper
 */
function connectWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);

    const onOpen = () => {
      cleanup();
      resolve(ws);
    };

    const onError = (event: Event) => {
      cleanup();
      reject(new Error(`WebSocket connection failed to ${url}`));
    };

    const cleanup = () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
    };

    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onError);

    // Timeout after 10 seconds
    setTimeout(() => {
      cleanup();
      try {
        ws.close();
      } catch {}
      reject(new Error(`WebSocket connection timeout to ${url}`));
    }, 10000);
  });
}

/**
 * Handle incoming WebSocket messages, dispatch to pending requests
 */
function handleMessage(rawData: string): void {
  try {
    const parsed = JSON.parse(rawData);

    // Responses have `res` field: [requestId, method, params, timestamp]
    if (parsed.res) {
      const reqId = parsed.res[0];
      const pending = pendingRequests.get(reqId);
      if (pending) {
        pendingRequests.delete(reqId);
        pending.resolve(rawData);
        return;
      }
    }

    // Error responses
    if (parsed.err) {
      const reqId = parsed.err[0];
      const pending = pendingRequests.get(reqId);
      if (pending) {
        pendingRequests.delete(reqId);
        const errorCode = parsed.err[1];
        const errorMsg = parsed.err[2];
        pending.reject(
          new Error(`Yellow RPC error ${errorCode}: ${errorMsg}`),
        );
        return;
      }
    }

  } catch {
    logger.warn({ rawData }, "Failed to parse Yellow ClearNode message");
  }
}

/**
 * Wait for a specific method response on the WebSocket.
 * Used during authentication flow where we don't have request IDs.
 */
function waitForMethod(
  ws: WebSocket,
  method: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      const rawData = event.data.toString();
      try {
        const parsed = JSON.parse(rawData);
        // Check response method
        const responseMethod = parsed.res?.[1];
        if (responseMethod === method) {
          cleanup();
          resolve(rawData);
        }
        // Check for error
        if (parsed.err) {
          cleanup();
          reject(
            new Error(`Yellow auth error: ${parsed.err[2] || parsed.err[1]}`),
          );
        }
      } catch {
        // not JSON, ignore
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for ${method} response`));
    }, timeoutMs);

    const cleanup = () => {
      ws.removeEventListener("message", handler);
      clearTimeout(timer);
    };

    ws.addEventListener("message", handler);
  });
}

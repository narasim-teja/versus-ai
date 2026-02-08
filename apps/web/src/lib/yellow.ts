/**
 * Yellow Network ClearNode Browser Client
 *
 * Browser-side WebSocket client for ClearNode. Uses an ephemeral ECDSA
 * keypair generated in-browser for instant signing (no Circle wallet PIN
 * prompts). The ephemeral key acts as the viewer's identity on ClearNode.
 *
 * Mirrors the server's client.ts pattern but adapted for browser WebSocket API.
 */

import {
  createAuthRequestMessage,
  createAuthVerifyMessage,
  createECDSAMessageSigner,
  createEIP712AuthMessageSigner,
  createAppSessionMessage,
  createCloseAppSessionMessage,
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
import { config } from "./config";

// ─── Types ───────────────────────────────────────────────────────────

export interface YellowBrowserClient {
  ws: WebSocket;
  ephemeralAddress: Address;
  ephemeralPrivateKey: Hex;
  sessionSigner: MessageSigner;
  isAuthenticated: boolean;
  sendAndWait: (message: string, timeoutMs?: number) => Promise<any>;
  destroy: () => void;
}

// ─── Pending Requests ────────────────────────────────────────────────

const pendingRequests = new Map<
  number | string,
  { resolve: (value: any) => void; reject: (reason: any) => void }
>();

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Connect to ClearNode with an ephemeral keypair and authenticate.
 * Returns an authenticated client ready for app session operations.
 */
export async function connectToClearNode(): Promise<YellowBrowserClient> {
  // Generate ephemeral keypair — this IS the viewer's ClearNode identity
  const ephemeralPrivateKey = generatePrivateKey();
  const ephemeralAccount = privateKeyToAccount(ephemeralPrivateKey);
  const ephemeralAddress = ephemeralAccount.address;

  // Session key for ClearNode operations (separate from main ephemeral key)
  const sessionPrivateKey = generatePrivateKey();
  const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);

  // Wallet client for EIP-712 auth signing (uses ephemeral key as main wallet)
  const walletClient = createWalletClient({
    account: ephemeralAccount,
    chain: sepolia,
    transport: http(),
  });

  // Connect WebSocket
  const ws = await connectWebSocket(config.clearNodeUrl);

  // Track ping interval for cleanup
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  // Handle incoming messages
  ws.addEventListener("message", (event: MessageEvent) => {
    handleMessage(String(event.data));
  });

  // Handle pings from server
  ws.addEventListener("message", (event: MessageEvent) => {
    try {
      const parsed = JSON.parse(String(event.data));
      const method = parsed.res?.[1] || parsed.req?.[1];
      if (method === "ping") {
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

  // Send periodic pings
  pingInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      if (pingInterval) clearInterval(pingInterval);
      return;
    }
    try {
      ws.send(
        JSON.stringify({ req: [Date.now(), "ping", {}, Date.now()], sig: [] })
      );
    } catch {
      // ignore
    }
  }, 30000);

  // Build sendAndWait helper
  let requestCounter = 0;
  const sendAndWait = (message: string, timeoutMs = 15000): Promise<any> => {
    return new Promise((resolve, reject) => {
      try {
        const parsed = JSON.parse(message);
        const reqId = parsed.req?.[0] ?? ++requestCounter;

        const timer = setTimeout(() => {
          pendingRequests.delete(reqId);
          reject(new Error(`Yellow RPC timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        pendingRequests.set(reqId, {
          resolve: (value: any) => {
            clearTimeout(timer);
            resolve(value);
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

  const client: YellowBrowserClient = {
    ws,
    ephemeralAddress,
    ephemeralPrivateKey,
    sessionSigner,
    isAuthenticated: false,
    sendAndWait,
    destroy: () => {
      if (pingInterval) clearInterval(pingInterval);
      try {
        ws.close();
      } catch {
        // ignore
      }
    },
  };

  // ─── Authenticate ───
  const authAllowances = [{ asset: config.yellowAsset, amount: "1000000000" }];
  const authExpiresAt = BigInt(Math.floor(Date.now() / 1000) + 86400);
  const authScope = "app";
  const authApplication = "versus-streaming";

  // Step 1: Send auth_request
  const authRequestMsg = await createAuthRequestMessage({
    address: ephemeralAddress,
    session_key: sessionAccount.address,
    application: authApplication,
    allowances: authAllowances,
    expires_at: authExpiresAt,
    scope: authScope,
  });

  ws.send(authRequestMsg);

  // Step 2: Wait for auth_challenge
  const challengeRaw = await waitForMethod(ws, "auth_challenge", 10000);
  const challengeResponse = JSON.parse(challengeRaw);

  // Step 3: Sign with EIP-712 and send auth_verify
  const eip712AuthSigner = createEIP712AuthMessageSigner(
    walletClient as any,
    {
      scope: authScope,
      session_key: sessionAccount.address,
      expires_at: authExpiresAt,
      allowances: authAllowances,
    },
    { name: authApplication }
  );

  const authVerifyMsg = await createAuthVerifyMessage(
    eip712AuthSigner,
    { params: { challengeMessage: challengeResponse.res?.[2]?.challenge_message || challengeResponse.res?.[2]?.[0]?.challenge_message } } as any
  );

  ws.send(authVerifyMsg);

  // Step 4: Wait for auth_verify response
  const verifyRaw = await waitForMethod(ws, "auth_verify", 10000);
  const verifyResponse = JSON.parse(verifyRaw);
  const verifyParams = verifyResponse.res?.[2];
  const success =
    verifyParams?.success ??
    verifyParams?.[0]?.success ??
    false;

  if (!success) {
    client.destroy();
    throw new Error("ClearNode authentication failed");
  }

  client.isAuthenticated = true;

  return client;
}

/**
 * Request test tokens from the ClearNode sandbox faucet.
 */
export async function requestFaucetTokens(address: string): Promise<void> {
  try {
    const res = await fetch(
      "https://clearnet-sandbox.yellow.com/faucet/requestTokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: address }),
      }
    );
    if (!res.ok) {
      console.warn(`[Yellow] Faucet request failed: ${res.status}`);
    }
  } catch {
    // Faucet is best-effort, ignore errors
  }
}

/**
 * Sign a packed channel state hash with the ephemeral key.
 * Used to co-sign the initial Nitrolite Custody channel state
 * so the server can open the on-chain channel with both signatures.
 */
export async function signChannelState(
  packedStateHex: Hex,
  ephemeralPrivateKey: Hex,
): Promise<Hex> {
  const account = privateKeyToAccount(ephemeralPrivateKey);
  const signature = await account.signMessage({
    message: { raw: packedStateHex },
  });
  return signature;
}

/**
 * Disconnect and cleanup a browser ClearNode client.
 */
export function disconnectClearNode(client: YellowBrowserClient): void {
  client.isAuthenticated = false;
  client.destroy();
}

// ─── Internal Helpers ────────────────────────────────────────────────

function connectWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);

    const onOpen = () => {
      cleanup();
      resolve(ws);
    };

    const onError = () => {
      cleanup();
      reject(new Error(`WebSocket connection failed to ${url}`));
    };

    const cleanup = () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
    };

    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onError);

    setTimeout(() => {
      cleanup();
      try {
        ws.close();
      } catch {}
      reject(new Error(`WebSocket connection timeout to ${url}`));
    }, 10000);
  });
}

function handleMessage(rawData: string): void {
  try {
    const parsed = JSON.parse(rawData);

    if (parsed.res) {
      const reqId = parsed.res[0];
      const pending = pendingRequests.get(reqId);
      if (pending) {
        pendingRequests.delete(reqId);
        pending.resolve(rawData);
        return;
      }
    }

    if (parsed.err) {
      const reqId = parsed.err[0];
      const pending = pendingRequests.get(reqId);
      if (pending) {
        pendingRequests.delete(reqId);
        pending.reject(
          new Error(`Yellow RPC error ${parsed.err[1]}: ${parsed.err[2]}`)
        );
        return;
      }
    }
  } catch {
    // ignore non-JSON
  }
}

function waitForMethod(
  ws: WebSocket,
  method: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      const rawData = String(event.data);
      try {
        const parsed = JSON.parse(rawData);
        if (parsed.res?.[1] === method) {
          cleanup();
          resolve(rawData);
        }
        if (parsed.err) {
          cleanup();
          reject(
            new Error(`Yellow auth error: ${parsed.err[2] || parsed.err[1]}`)
          );
        }
      } catch {
        // not JSON
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

"use client";

import { useCallback, useEffect, useState } from "react";
import { config } from "@/lib/config";
import { initCircleSdk, executeChallenge } from "@/lib/circle";

export type WalletStatus =
  | "disconnected"
  | "registering"
  | "initializing"
  | "setting_pin"
  | "connected"
  | "error";

interface WalletState {
  status: WalletStatus;
  userId: string | null;
  walletId: string | null;
  walletAddress: string | null;
  error: string | null;
}

const STORAGE_KEY = "versus_circle_user";

export function useCircleWallet() {
  const [state, setState] = useState<WalletState>({
    status: "disconnected",
    userId: null,
    walletId: null,
    walletAddress: null,
    error: null,
  });

  // Restore from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.userId && data.walletAddress) {
          setState({
            status: "connected",
            userId: data.userId,
            walletId: data.walletId ?? null,
            walletAddress: data.walletAddress,
            error: null,
          });
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const connectWallet = useCallback(async () => {
    try {
      // Check if we have a stored userId we can reconnect with
      const stored = localStorage.getItem(STORAGE_KEY);
      let existingData: { userId?: string; walletId?: string; walletAddress?: string } | null = null;
      if (stored) {
        try {
          existingData = JSON.parse(stored);
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }

      let userId: string;

      if (existingData?.userId) {
        // Reconnect flow: re-use existing Circle user
        userId = existingData.userId;
        setState((s) => ({ ...s, status: "initializing", userId, error: null }));

        // Get a fresh session token
        const tokenRes = await fetch(`${config.apiBaseUrl}/api/auth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        if (!tokenRes.ok) {
          // Token failed — user may no longer exist in Circle; fall through to fresh registration
          console.warn("[CircleWallet] Stored user token failed, creating new user");
          localStorage.removeItem(STORAGE_KEY);
          existingData = null;
        } else {
          const { userToken, encryptionKey } = await tokenRes.json();
          initCircleSdk(userToken, encryptionKey);

          // Fetch wallet details (may already exist from previous session)
          let walletAddress = existingData.walletAddress ?? null;
          let walletId = existingData.walletId ?? null;

          if (!walletAddress || !walletId) {
            const walletsRes = await fetch(
              `${config.apiBaseUrl}/api/auth/user/${userId}/wallets`
            );
            if (walletsRes.ok) {
              const { wallets } = await walletsRes.json();
              const wallet = wallets?.[0];
              walletAddress = wallet?.address ?? null;
              walletId = wallet?.id ?? null;
            }
          }

          if (walletAddress && walletId) {
            // Successfully reconnected
            localStorage.setItem(
              STORAGE_KEY,
              JSON.stringify({ userId, walletId, walletAddress })
            );
            setState({
              status: "connected",
              userId,
              walletId,
              walletAddress,
              error: null,
            });
            return;
          }
          // Wallet not found — fall through to fresh registration
          console.warn("[CircleWallet] Stored user has no wallet, creating new user");
          localStorage.removeItem(STORAGE_KEY);
          existingData = null;
        }
      }

      // Fresh registration flow
      setState((s) => ({ ...s, status: "registering", error: null }));

      const registerRes = await fetch(`${config.apiBaseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!registerRes.ok) throw new Error("Registration failed");
      ({ userId } = await registerRes.json());

      // Get session token
      setState((s) => ({ ...s, status: "initializing", userId }));

      const tokenRes = await fetch(`${config.apiBaseUrl}/api/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!tokenRes.ok) throw new Error("Token generation failed");
      const { userToken, encryptionKey } = await tokenRes.json();

      // Initialize SDK
      initCircleSdk(userToken, encryptionKey);

      // Create wallet initialization challenge
      const initRes = await fetch(`${config.apiBaseUrl}/api/auth/initialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!initRes.ok) throw new Error("Wallet initialization failed");
      const { challengeId } = await initRes.json();

      // Execute challenge (user sets PIN via Circle UI)
      setState((s) => ({ ...s, status: "setting_pin" }));
      await executeChallenge(challengeId);

      // Get wallet address and ID (retry since Circle needs time to provision)
      let walletAddress: string | null = null;
      let walletId: string | null = null;
      const maxRetries = 5;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));

        const walletsRes = await fetch(
          `${config.apiBaseUrl}/api/auth/user/${userId}/wallets`
        );
        if (!walletsRes.ok) {
          console.warn(`Wallet fetch attempt ${attempt + 1} failed:`, walletsRes.status);
          continue;
        }
        const { wallets } = await walletsRes.json();
        const wallet = wallets?.[0];
        walletAddress = wallet?.address ?? null;
        walletId = wallet?.id ?? null;
        if (walletAddress && walletId) break;
        console.warn(`Wallet fetch attempt ${attempt + 1}: no wallets yet`);
      }

      if (!walletAddress) {
        throw new Error("Wallet created but address not yet available. Try reconnecting.");
      }

      // Persist to localStorage
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ userId, walletId, walletAddress })
      );

      setState({
        status: "connected",
        userId,
        walletId,
        walletAddress,
        error: null,
      });
    } catch (err) {
      console.error("[CircleWallet] Connection failed:", err);
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : "Connection failed",
      }));
    }
  }, []);

  /**
   * Execute a Circle challenge (used for trade approvals).
   * Re-initializes the SDK with a fresh token before executing.
   */
  const executeTradingChallenge = useCallback(
    async (challengeId: string) => {
      if (!state.userId) throw new Error("Not connected");

      // Get fresh session token
      const tokenRes = await fetch(`${config.apiBaseUrl}/api/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: state.userId }),
      });
      if (!tokenRes.ok) throw new Error("Failed to refresh session");
      const { userToken, encryptionKey } = await tokenRes.json();

      // Re-initialize SDK with fresh token
      initCircleSdk(userToken, encryptionKey);

      // Execute the challenge
      await executeChallenge(challengeId);
    },
    [state.userId]
  );

  const disconnect = useCallback(() => {
    // Keep userId/walletId/walletAddress in localStorage so reconnecting
    // re-uses the same Circle user instead of creating a new one.
    setState({
      status: "disconnected",
      userId: null,
      walletId: null,
      walletAddress: null,
      error: null,
    });
  }, []);

  return {
    ...state,
    connectWallet,
    disconnect,
    executeTradingChallenge,
    isConnected: state.status === "connected",
  };
}

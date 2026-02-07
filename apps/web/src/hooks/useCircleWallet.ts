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
  walletAddress: string | null;
  error: string | null;
}

const STORAGE_KEY = "versus_circle_user";

export function useCircleWallet() {
  const [state, setState] = useState<WalletState>({
    status: "disconnected",
    userId: null,
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
      // Step 1: Register user
      setState((s) => ({ ...s, status: "registering", error: null }));

      const registerRes = await fetch(`${config.apiBaseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!registerRes.ok) throw new Error("Registration failed");
      const { userId } = await registerRes.json();

      // Step 2: Get session token
      setState((s) => ({ ...s, status: "initializing", userId }));

      const tokenRes = await fetch(`${config.apiBaseUrl}/api/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!tokenRes.ok) throw new Error("Token generation failed");
      const { userToken, encryptionKey } = await tokenRes.json();

      // Step 3: Initialize SDK
      initCircleSdk(userToken, encryptionKey);

      // Step 4: Create wallet initialization challenge
      const initRes = await fetch(`${config.apiBaseUrl}/api/auth/initialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!initRes.ok) throw new Error("Wallet initialization failed");
      const { challengeId } = await initRes.json();

      // Step 5: Execute challenge (user sets PIN via Circle UI)
      setState((s) => ({ ...s, status: "setting_pin" }));
      await executeChallenge(challengeId);

      // Step 6: Get wallet address
      const walletsRes = await fetch(
        `${config.apiBaseUrl}/api/auth/user/${userId}/wallets`
      );
      if (!walletsRes.ok) throw new Error("Failed to fetch wallets");
      const { wallets } = await walletsRes.json();

      const walletAddress = wallets?.[0]?.address ?? null;

      // Persist to localStorage
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ userId, walletAddress })
      );

      setState({
        status: "connected",
        userId,
        walletAddress,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : "Connection failed",
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState({
      status: "disconnected",
      userId: null,
      walletAddress: null,
      error: null,
    });
  }, []);

  return {
    ...state,
    connectWallet,
    disconnect,
    isConnected: state.status === "connected",
  };
}

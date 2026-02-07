"use client";

import { createContext, useContext } from "react";
import { useCircleWallet } from "@/hooks/useCircleWallet";
import type { WalletStatus } from "@/hooks/useCircleWallet";

interface WalletContextValue {
  status: WalletStatus;
  userId: string | null;
  walletId: string | null;
  walletAddress: string | null;
  error: string | null;
  isConnected: boolean;
  connectWallet: () => Promise<void>;
  disconnect: () => void;
  executeTradingChallenge: (challengeId: string) => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const wallet = useCircleWallet();

  return (
    <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return ctx;
}

"use client";

import { Wallet, LogOut, Loader2, Copy, Check } from "lucide-react";
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { useWallet } from "./WalletProvider";
import { truncateAddress } from "@/lib/format";

export function ConnectWalletButton() {
  const { status, walletAddress, isConnected, connectWallet, disconnect } =
    useWallet();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [walletAddress]);

  // Loading states
  if (
    status === "registering" ||
    status === "initializing" ||
    status === "setting_pin"
  ) {
    const labels = {
      registering: "Registering...",
      initializing: "Initializing...",
      setting_pin: "Set PIN...",
    };
    return (
      <Button variant="outline" size="sm" disabled>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {labels[status]}
      </Button>
    );
  }

  // Connected state
  if (isConnected && walletAddress) {
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={handleCopy}
        >
          <Wallet className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-xs">{truncateAddress(walletAddress)}</span>
          {copied ? (
            <Check className="h-3 w-3 text-emerald-400" />
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={disconnect}
          title="Disconnect"
        >
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  // Error state
  if (status === "error") {
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={connectWallet}
          className="border-red-500/50 text-red-400 hover:text-red-300"
        >
          <Wallet className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  // Disconnected state
  return (
    <Button variant="outline" size="sm" onClick={connectWallet}>
      <Wallet className="h-3.5 w-3.5" />
      Connect Wallet
    </Button>
  );
}

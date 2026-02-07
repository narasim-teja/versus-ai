"use client";

import { Activity, DollarSign } from "lucide-react";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { useWallet } from "@/components/wallet/WalletProvider";
import { usePortfolio } from "@/hooks/usePortfolio";
import { formatUsdc } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";

export function Header() {
  const { walletAddress, isConnected } = useWallet();
  const { portfolio } = usePortfolio(isConnected ? walletAddress : null);

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <span className="text-lg font-bold tracking-tight">versus</span>
        </div>
        <div className="flex items-center gap-3">
          {isConnected && portfolio && (
            <Badge variant="outline" className="gap-1 px-2.5 py-1">
              <DollarSign className="h-3 w-3 text-emerald-400" />
              <span className="text-xs font-medium">
                {formatUsdc(portfolio.usdcBalance)}
              </span>
            </Badge>
          )}
          <ConnectWalletButton />
        </div>
      </div>
    </header>
  );
}

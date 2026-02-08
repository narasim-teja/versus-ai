"use client";

import { Wallet, Coins } from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { usePortfolio } from "@/hooks/usePortfolio";
import { formatUsdc, formatTokenBalance } from "@/lib/format";

export function PortfolioPanel() {
  const { walletAddress, isConnected } = useWallet();
  const { portfolio, isLoading } = usePortfolio(
    isConnected ? walletAddress : null
  );

  if (!isConnected || isLoading || !portfolio) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/10 px-4 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Wallet className="h-3.5 w-3.5" />
        <span>Portfolio</span>
      </div>

      <div className="h-4 w-px bg-border/50" />

      <div className="flex items-center gap-1 text-xs">
        <span className="text-muted-foreground">USDC:</span>
        <span className="font-semibold">{formatUsdc(portfolio.usdcBalance)}</span>
      </div>

      {portfolio.holdings.map((holding) => (
        <div key={holding.tokenAddress} className="flex items-center gap-1 text-xs">
          <div className="h-4 w-px bg-border/50" />
          <Coins className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">{holding.agentName.split(" ")[0]}:</span>
          <span className="font-medium">{formatTokenBalance(holding.balance)}</span>
          <span className="text-muted-foreground">({formatUsdc(holding.value)})</span>
        </div>
      ))}

      <div className="ml-auto flex items-center gap-1 text-xs">
        <span className="text-muted-foreground">Total:</span>
        <span className="font-bold text-emerald-400">{formatUsdc(portfolio.totalValue)}</span>
      </div>
    </div>
  );
}

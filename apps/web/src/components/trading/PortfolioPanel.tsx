"use client";

import { Wallet, Briefcase, Coins } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Separator } from "@/components/ui/Separator";
import { Skeleton } from "@/components/ui/Skeleton";
import { MetricRow } from "@/components/dashboard/MetricRow";
import { useWallet } from "@/components/wallet/WalletProvider";
import { usePortfolio } from "@/hooks/usePortfolio";
import { formatUsdc, formatTokenBalance } from "@/lib/format";

export function PortfolioPanel() {
  const { walletAddress, isConnected } = useWallet();
  const { portfolio, isLoading, error } = usePortfolio(
    isConnected ? walletAddress : null
  );

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="flex h-32 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            Connect wallet to view portfolio
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Your Portfolio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex h-32 items-center justify-center">
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Briefcase className="h-4 w-4" />
            Your Portfolio
          </CardTitle>
          {portfolio && (
            <Badge variant="outline" className="text-xs">
              Total: {formatUsdc(portfolio.totalValue)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {portfolio && (
          <>
            <MetricRow
              label="USDC Balance"
              value={
                <span className="font-semibold">
                  {formatUsdc(portfolio.usdcBalance)}
                </span>
              }
              icon={<Wallet className="h-3.5 w-3.5" />}
            />
            <Separator />
            {portfolio.holdings.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground">
                No token holdings yet
              </p>
            ) : (
              portfolio.holdings.map((holding) => (
                <MetricRow
                  key={holding.tokenAddress}
                  label={holding.agentName}
                  value={
                    <div className="text-right">
                      <div className="text-sm font-medium">
                        {formatTokenBalance(holding.balance)} tokens
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatUsdc(holding.value)}
                      </div>
                    </div>
                  }
                  icon={<Coins className="h-3.5 w-3.5" />}
                />
              ))
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

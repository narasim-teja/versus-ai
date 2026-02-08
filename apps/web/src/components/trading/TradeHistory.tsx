"use client";

import { ArrowDownUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatTokenPrice, formatTimeAgo, truncateAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TradeData } from "@/lib/types";

interface TradeHistoryProps {
  trades: TradeData[];
}

export function TradeHistory({ trades }: TradeHistoryProps) {
  if (trades.length === 0) {
    return null;
  }

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ArrowDownUp className="h-4 w-4" />
          Recent Trades
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[240px]">
          <div className="divide-y divide-border/50">
            {/* Header */}
            <div className="grid grid-cols-5 gap-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <span>Side</span>
              <span>Price</span>
              <span className="text-right">USDC</span>
              <span className="text-right">Tokens</span>
              <span className="text-right">Time</span>
            </div>
            {/* Rows */}
            {trades.map((trade) => (
              <TradeRow key={trade.id} trade={trade} />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function TradeRow({ trade }: { trade: TradeData }) {
  const isBuy = trade.side === "buy";
  const usdcAmount = Number(trade.usdcAmount) / 1e6;
  const tokenAmount = Number(trade.tokenAmount) / 1e18;

  return (
    <div className="grid grid-cols-5 items-center gap-2 px-4 py-2 text-xs hover:bg-muted/30 transition-colors">
      <div>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-1.5 py-0",
            isBuy
              ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
              : "border-red-500/30 text-red-400 bg-red-500/10"
          )}
        >
          {isBuy ? "BUY" : "SELL"}
        </Badge>
      </div>
      <div className="font-mono">
        {formatTokenPrice(trade.price)}
      </div>
      <div
        className={cn(
          "text-right font-mono",
          isBuy ? "text-emerald-400" : "text-red-400"
        )}
      >
        ${usdcAmount.toFixed(2)}
      </div>
      <div className="text-right font-mono text-muted-foreground">
        {tokenAmount >= 1000
          ? `${(tokenAmount / 1000).toFixed(1)}K`
          : tokenAmount.toFixed(1)}
      </div>
      <div className="text-right text-muted-foreground" title={truncateAddress(trade.trader)}>
        {formatTimeAgo(trade.timestamp)}
      </div>
    </div>
  );
}

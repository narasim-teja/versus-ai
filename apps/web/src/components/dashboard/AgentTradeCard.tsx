"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wallet, TrendingUp, DollarSign, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CompactTradeForm } from "@/components/trading/CompactTradeForm";
import { fetchAgentLiveState } from "@/lib/api";
import {
  formatUsdc,
  formatTokenPrice,
  formatTokenSupply,
} from "@/lib/format";
import type { Agent, AgentLiveState } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AgentTradeCardProps {
  agent: Agent;
  price: string;
  totalSupply: string;
}

const strategyStyles = {
  academic: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  degen: "bg-orange-500/10 text-orange-400 border-orange-500/20",
} as const;

export function AgentTradeCard({ agent, price, totalSupply }: AgentTradeCardProps) {
  const [state, setState] = useState<AgentLiveState | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await fetchAgentLiveState(agent.id);
        if (mounted) setState(data);
      } catch {
        // Silently fail
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => { mounted = false; clearInterval(interval); };
  }, [agent.id]);

  const displayPrice = state ? formatTokenPrice(state.ownTokenPrice) : formatTokenPrice(price);
  const displaySupply = state ? formatTokenSupply(state.ownTokenSupply) : formatTokenSupply(totalSupply);
  const displayTreasury = state ? formatUsdc(state.usdcBalance) : "--";
  const displayEarnings = state ? formatUsdc(state.ownTokenRevenue) : "--";
  const isRunning = state?.isRunning ?? agent.status.isRunning;

  return (
    <Card className="overflow-hidden transition-colors hover:border-primary/30">
      {/* Header: Agent name + price */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                isRunning ? "bg-emerald-500 animate-pulse" : "bg-red-500"
              )}
            />
          </div>
          <span className="font-semibold">{agent.name}</span>
          <Badge
            variant="outline"
            className={cn("text-[10px] px-1.5 py-0", strategyStyles[agent.strategyType])}
          >
            {agent.strategyType}
          </Badge>
        </div>
        <span className="text-lg font-bold text-emerald-400">{displayPrice}</span>
      </div>

      <CardContent className="space-y-3 pt-3">
        {/* Key metrics — horizontal row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <Wallet className="h-3 w-3" />
              Treasury
            </div>
            <div className="text-sm font-semibold mt-0.5">{displayTreasury}</div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <TrendingUp className="h-3 w-3" />
              Supply
            </div>
            <div className="text-sm font-semibold mt-0.5">{displaySupply}</div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              Earnings
            </div>
            <div className="text-sm font-semibold mt-0.5">{displayEarnings}</div>
          </div>
        </div>

        {/* Trade form */}
        <div className="border-t border-border/50 pt-3">
          <CompactTradeForm
            tokenAddress={agent.tokenAddress}
            bondingCurveAddress={agent.bondingCurveAddress}
          />
        </div>

        {/* View details link */}
        <Link
          href={`/agents/${agent.id}`}
          className="flex items-center justify-center gap-1.5 rounded-md border border-border/60 bg-muted/20 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          View Agent Details
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}

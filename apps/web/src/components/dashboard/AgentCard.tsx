"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Wallet,
  Coins,
  TrendingUp,
  Landmark,
  Hash,
  Clock,
  DollarSign,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Progress } from "@/components/ui/Progress";
import { Separator } from "@/components/ui/Separator";
import { MetricRow } from "./MetricRow";
import { fetchAgentLiveState } from "@/lib/api";
import {
  formatUsdc,
  formatTokenPrice,
  formatTokenSupply,
  formatHealthFactor,
  formatLTV,
  formatTimeAgo,
} from "@/lib/format";
import type { Agent, AgentLiveState } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AgentCardProps {
  agent: Agent;
}

const strategyStyles = {
  academic: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  degen: "bg-orange-500/10 text-orange-400 border-orange-500/20",
} as const;

export function AgentCard({ agent }: AgentCardProps) {
  const [state, setState] = useState<AgentLiveState | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await fetchAgentLiveState(agent.id);
        if (mounted) setState(data);
      } catch {
        // Silently fail - card still shows basic info
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [agent.id]);

  const loan = state?.loan;

  return (
    <Link href={`/agents/${agent.id}`}>
      <Card className="cursor-pointer transition-colors hover:border-primary/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg">{agent.name}</CardTitle>
              <Badge
                variant="outline"
                className={cn(strategyStyles[agent.strategyType])}
              >
                {agent.strategyType}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  (state?.isRunning ?? agent.status.isRunning) ? "bg-emerald-500" : "bg-red-500"
                )}
              />
              <span className="text-xs text-muted-foreground">
                {(state?.isRunning ?? agent.status.isRunning) ? "Running" : "Stopped"}
              </span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-1">
          {/* Treasury */}
          <MetricRow
            label="Treasury"
            value={
              <span className="text-base font-semibold">
                {state ? formatUsdc(state.usdcBalance) : "--"}
              </span>
            }
            icon={<Wallet className="h-3.5 w-3.5" />}
          />

          <Separator />

          {/* Token Info */}
          <MetricRow
            label="Token Price"
            value={state ? formatTokenPrice(state.ownTokenPrice) : "--"}
            icon={<Coins className="h-3.5 w-3.5" />}
          />
          <MetricRow
            label="Token Supply"
            value={state ? formatTokenSupply(state.ownTokenSupply) : "--"}
            icon={<TrendingUp className="h-3.5 w-3.5" />}
          />
          <MetricRow
            label="Earnings"
            value={state ? formatUsdc(state.ownTokenRevenue) : "--"}
            icon={<DollarSign className="h-3.5 w-3.5" />}
          />

          {/* Loan Status */}
          {loan?.active && (
            <>
              <Separator />
              <MetricRow
                label="Loan"
                value={formatUsdc(loan.borrowedAmount)}
                icon={<Landmark className="h-3.5 w-3.5" />}
              />
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-muted-foreground">
                  Health: {formatHealthFactor(loan.healthFactor)}
                </span>
                <span className="text-xs text-muted-foreground">
                  LTV: {formatLTV(loan.currentLTV)}
                </span>
              </div>
              <Progress
                value={loan.currentLTV}
                className={cn(
                  "h-1.5",
                  loan.healthFactor < 1.0
                    ? "[&>div]:bg-red-500"
                    : loan.healthFactor < 1.5
                      ? "[&>div]:bg-yellow-500"
                      : "[&>div]:bg-emerald-500"
                )}
              />
            </>
          )}

          <Separator />

          {/* Cycle */}
          <MetricRow
            label="Cycle"
            value={`#${state?.currentCycle ?? agent.status.currentCycle}`}
            icon={<Hash className="h-3.5 w-3.5" />}
          />
          <MetricRow
            label="Last Decision"
            value={
              (state?.lastDecisionTime ?? agent.status.lastDecisionTime)
                ? formatTimeAgo(new Date(state?.lastDecisionTime ?? agent.status.lastDecisionTime!).getTime())
                : "Never"
            }
            icon={<Clock className="h-3.5 w-3.5" />}
          />
        </CardContent>
      </Card>
    </Link>
  );
}

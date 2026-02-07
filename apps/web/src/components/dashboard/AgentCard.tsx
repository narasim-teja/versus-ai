"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Wallet,
  Coins,
  TrendingUp,
  Landmark,
  Hash,
  Clock,
  RefreshCw,
  Briefcase,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { Separator } from "@/components/ui/Separator";
import { MetricRow } from "./MetricRow";
import { fetchAgent, forceCycle } from "@/lib/api";
import {
  formatUsdc,
  formatTokenPrice,
  formatTokenSupply,
  formatHealthFactor,
  formatLTV,
  formatTimeAgo,
} from "@/lib/format";
import type { Agent, AgentDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AgentCardProps {
  agent: Agent;
}

const strategyStyles = {
  academic: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  degen: "bg-orange-500/10 text-orange-400 border-orange-500/20",
} as const;

export function AgentCard({ agent }: AgentCardProps) {
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [forcing, setForcing] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await fetchAgent(agent.id);
        if (mounted) setDetail(data);
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

  const handleForceCycle = useCallback(async () => {
    setForcing(true);
    try {
      await forceCycle(agent.id);
      const data = await fetchAgent(agent.id);
      setDetail(data);
    } catch {
      // Ignore
    } finally {
      setForcing(false);
    }
  }, [agent.id]);

  const state = detail?.latestDecision?.stateSnapshot;
  const loan = state?.loan;

  return (
    <Card>
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
                agent.status.isRunning ? "bg-emerald-500" : "bg-red-500"
              )}
            />
            <span className="text-xs text-muted-foreground">
              {agent.status.isRunning ? "Running" : "Stopped"}
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

        {/* Holdings & Cycle */}
        <MetricRow
          label="Holdings"
          value={`${state?.holdings.length ?? 0} tokens`}
          icon={<Briefcase className="h-3.5 w-3.5" />}
        />
        <MetricRow
          label="Cycle"
          value={`#${agent.status.currentCycle}`}
          icon={<Hash className="h-3.5 w-3.5" />}
        />
        <MetricRow
          label="Last Decision"
          value={
            agent.status.lastDecisionTime
              ? formatTimeAgo(new Date(agent.status.lastDecisionTime).getTime())
              : "Never"
          }
          icon={<Clock className="h-3.5 w-3.5" />}
        />
      </CardContent>

      <CardFooter>
        <Button
          variant="outline"
          size="sm"
          onClick={handleForceCycle}
          disabled={forcing || !agent.status.isRunning}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", forcing && "animate-spin")} />
          {forcing ? "Running..." : "Force Cycle"}
        </Button>
      </CardFooter>
    </Card>
  );
}

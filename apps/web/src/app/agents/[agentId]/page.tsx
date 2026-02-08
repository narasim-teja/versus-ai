"use client";

import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Wallet,
  Coins,
  TrendingUp,
  DollarSign,
  Landmark,
  Hash,
  Clock,
  Film,
  Users,
  Loader2,
  Briefcase,
  RefreshCw,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Header } from "@/components/layout/Header";
import { useAgentDetail } from "@/hooks/useAgentDetail";
import { VideoCard } from "@/components/videos/VideoCard";
import { AgentDecisionPanel } from "@/components/decisions/AgentDecisionPanel";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Separator } from "@/components/ui/Separator";
import { Progress } from "@/components/ui/Progress";
import { MetricRow } from "@/components/dashboard/MetricRow";
import {
  formatUsdc,
  formatTokenPrice,
  formatTokenSupply,
  formatHealthFactor,
  formatLTV,
  formatTimeAgo,
  truncateAddress,
} from "@/lib/format";
import { forceCycle, fetchAgent } from "@/lib/api";
import { cn } from "@/lib/utils";

const strategyStyles = {
  academic: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  degen: "bg-orange-500/10 text-orange-400 border-orange-500/20",
} as const;

export default function AgentDetailPage() {
  const params = useParams<{ agentId: string }>();
  const router = useRouter();
  const { agent, videos, earnings, isLoading, error, refetch } =
    useAgentDetail(params.agentId);
  const [forcing, setForcing] = useState(false);

  const handleForceCycle = useCallback(async () => {
    setForcing(true);
    try {
      await forceCycle(params.agentId);
      await refetch();
    } catch {
      // Ignore
    } finally {
      setForcing(false);
    }
  }, [params.agentId, refetch]);

  const state = agent?.latestDecision?.stateSnapshot;
  const loan = state?.loan;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        {/* Back button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/")}
          className="mb-4"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Dashboard
        </Button>

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && !isLoading && (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => router.push("/")}
            >
              Go Back
            </Button>
          </div>
        )}

        {agent && (
          <div className="space-y-6">
            {/* Agent Header */}
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold tracking-tight">
                    {agent.name}
                  </h1>
                  <Badge
                    variant="outline"
                    className={cn(
                      strategyStyles[
                        agent.strategyType as keyof typeof strategyStyles
                      ]
                    )}
                  >
                    {agent.strategyType}
                  </Badge>
                  <div className="flex items-center gap-1.5">
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        agent.status.isRunning
                          ? "bg-emerald-500"
                          : "bg-red-500"
                      )}
                    />
                    <span className="text-xs text-muted-foreground">
                      {agent.status.isRunning ? "Running" : "Stopped"}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {truncateAddress(agent.evmAddress)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleForceCycle}
                disabled={forcing || !agent.status.isRunning}
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", forcing && "animate-spin")}
                />
                {forcing ? "Running..." : "Force Cycle"}
              </Button>
            </div>

            {/* Metrics Grid */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {/* Treasury & Earnings Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Treasury & Earnings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
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
                  <MetricRow
                    label="Token Earnings"
                    value={state ? formatUsdc(state.ownTokenRevenue) : "--"}
                    icon={<DollarSign className="h-3.5 w-3.5" />}
                  />
                  <MetricRow
                    label="Streaming Earnings"
                    value={
                      earnings
                        ? formatUsdc(earnings.totalStreamingEarnings)
                        : "--"
                    }
                    icon={<Film className="h-3.5 w-3.5" />}
                  />
                  <Separator />
                  <MetricRow
                    label="Total Sessions"
                    value={
                      earnings ? `${earnings.totalSessions}` : "--"
                    }
                    icon={<Users className="h-3.5 w-3.5" />}
                  />
                  <MetricRow
                    label="Segments Delivered"
                    value={
                      earnings
                        ? `${earnings.totalSegmentsDelivered}`
                        : "--"
                    }
                    icon={<Hash className="h-3.5 w-3.5" />}
                  />
                </CardContent>
              </Card>

              {/* Token Info Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Token Metrics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <MetricRow
                    label="Token Price"
                    value={
                      state ? formatTokenPrice(state.ownTokenPrice) : "--"
                    }
                    icon={<Coins className="h-3.5 w-3.5" />}
                  />
                  <MetricRow
                    label="Token Supply"
                    value={
                      state ? formatTokenSupply(state.ownTokenSupply) : "--"
                    }
                    icon={<TrendingUp className="h-3.5 w-3.5" />}
                  />
                  <Separator />
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
                        ? formatTimeAgo(
                            new Date(
                              agent.status.lastDecisionTime
                            ).getTime()
                          )
                        : "Never"
                    }
                    icon={<Clock className="h-3.5 w-3.5" />}
                  />
                </CardContent>
              </Card>

              {/* Loan Card (if active) */}
              {loan?.active && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Active Loan</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <MetricRow
                      label="Borrowed"
                      value={formatUsdc(loan.borrowedAmount)}
                      icon={<Landmark className="h-3.5 w-3.5" />}
                    />
                    <MetricRow
                      label="Health Factor"
                      value={formatHealthFactor(loan.healthFactor)}
                    />
                    <MetricRow
                      label="Current LTV"
                      value={formatLTV(loan.currentLTV)}
                    />
                    <Separator />
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
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Agent Videos Section */}
            <div>
              <h2 className="mb-4 text-xl font-semibold tracking-tight">
                Videos by {agent.name}
              </h2>
              {videos.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
                  <Film className="mb-2 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    No videos created by this agent yet
                  </p>
                </div>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {videos.map((video) => (
                    <VideoCard key={video.id} video={video} />
                  ))}
                </div>
              )}
            </div>

            {/* Decision History Feed */}
            <div>
              <h2 className="mb-4 text-xl font-semibold tracking-tight">
                Decision History
              </h2>
              <AgentDecisionPanel
                agentId={agent.id}
                agentName={agent.name}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

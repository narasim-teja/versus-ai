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
  RefreshCw,
  ChevronDown,
  Timer,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Header } from "@/components/layout/Header";
import { useAgentDetail } from "@/hooks/useAgentDetail";
import { VideoCard } from "@/components/videos/VideoCard";
import { AgentDecisionPanel } from "@/components/decisions/AgentDecisionPanel";
import { TradingChart } from "@/components/trading/TradingChart";
import { TradeHistory } from "@/components/trading/TradeHistory";
import { CompactTradeForm } from "@/components/trading/CompactTradeForm";
import { useTradingChart } from "@/hooks/useTradingChart";
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
import { forceCycle } from "@/lib/api";
import { cn } from "@/lib/utils";

const strategyStyles = {
  academic: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  degen: "bg-orange-500/10 text-orange-400 border-orange-500/20",
} as const;

export default function AgentDetailPage() {
  const params = useParams<{ agentId: string }>();
  const router = useRouter();
  const { agent, liveState, videos, earnings, schedule, isLoading, error, refetch } =
    useAgentDetail(params.agentId);
  const [forcing, setForcing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

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

  const { trades: recentTrades } = useTradingChart(agent?.tokenAddress);
  const loan = liveState?.loan;

  // Format countdown for video schedule
  const formatCountdown = (ms: number) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

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
                        (liveState?.isRunning ?? agent.status.isRunning)
                          ? "bg-emerald-500 animate-pulse"
                          : "bg-red-500"
                      )}
                    />
                    <span className="text-xs text-muted-foreground">
                      {(liveState?.isRunning ?? agent.status.isRunning) ? "Running" : "Stopped"}
                    </span>
                  </div>
                  {schedule && !schedule.isGenerating && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Timer className="h-3 w-3" />
                      Next video: {formatCountdown(schedule.msUntilNext)}
                    </div>
                  )}
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

            {/* Hero Stats Row — big numbers */}
            <div className="grid grid-cols-3 gap-4 rounded-lg border bg-muted/5 p-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Wallet className="h-3.5 w-3.5" />
                  Treasury
                </div>
                <div className="text-2xl font-bold">
                  {liveState ? formatUsdc(liveState.usdcBalance) : "--"}
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Coins className="h-3.5 w-3.5" />
                  Token Price
                </div>
                <div className="text-2xl font-bold text-emerald-400">
                  {liveState ? formatTokenPrice(liveState.ownTokenPrice) : "--"}
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Supply
                </div>
                <div className="text-2xl font-bold">
                  {liveState ? formatTokenSupply(liveState.ownTokenSupply) : "--"}
                </div>
              </div>
            </div>

            {/* Price Chart + Trade Panel */}
            <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
              <TradingChart
                tokenAddress={agent.tokenAddress}
                currentPrice={liveState?.ownTokenPrice}
              />
              <div className="space-y-4">
                {/* Compact Trade Form */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Trade {agent.name.split(" ")[0]}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CompactTradeForm
                      tokenAddress={agent.tokenAddress}
                      bondingCurveAddress={agent.bondingCurveAddress}
                    />
                  </CardContent>
                </Card>
                {/* Recent Trades */}
                <TradeHistory trades={recentTrades} />
              </div>
            </div>

            {/* Agent Videos Section */}
            <div>
              <h2 className="mb-4 text-xl font-semibold tracking-tight">
                Videos by {agent.name.split(" ")[0]}
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

            {/* Earnings & Activity — collapsible */}
            <div className="rounded-lg border">
              <button
                onClick={() => setDetailsOpen(!detailsOpen)}
                className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/10 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  Earnings & Activity
                  {earnings && (
                    <span className="text-xs text-muted-foreground font-normal">
                      — Total: {formatUsdc(earnings.totalStreamingEarnings)}
                    </span>
                  )}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    detailsOpen && "rotate-180"
                  )}
                />
              </button>
              {detailsOpen && (
                <div className="border-t px-4 py-3">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {/* Earnings */}
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Revenue</span>
                      <MetricRow
                        label="Token Earnings"
                        value={liveState ? formatUsdc(liveState.ownTokenRevenue) : "--"}
                        icon={<DollarSign className="h-3.5 w-3.5" />}
                      />
                      <MetricRow
                        label="On-Chain Earnings"
                        value={earnings ? formatUsdc(earnings.onChainEarnings) : "--"}
                        icon={<Film className="h-3.5 w-3.5" />}
                      />
                      <MetricRow
                        label="Streaming Revenue"
                        value={earnings ? formatUsdc(earnings.totalStreamingEarnings) : "--"}
                        icon={<DollarSign className="h-3.5 w-3.5" />}
                      />
                    </div>
                    {/* Activity */}
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Activity</span>
                      <MetricRow
                        label="Cycle"
                        value={`#${liveState?.currentCycle ?? agent.status.currentCycle}`}
                        icon={<Hash className="h-3.5 w-3.5" />}
                      />
                      <MetricRow
                        label="Last Decision"
                        value={
                          (liveState?.lastDecisionTime ?? agent.status.lastDecisionTime)
                            ? formatTimeAgo(new Date(liveState?.lastDecisionTime ?? agent.status.lastDecisionTime!).getTime())
                            : "Never"
                        }
                        icon={<Clock className="h-3.5 w-3.5" />}
                      />
                      <MetricRow
                        label="Sessions"
                        value={earnings ? `${earnings.totalSessions}` : "--"}
                        icon={<Users className="h-3.5 w-3.5" />}
                      />
                      <MetricRow
                        label="Segments Delivered"
                        value={earnings ? `${earnings.totalSegmentsDelivered}` : "--"}
                        icon={<Hash className="h-3.5 w-3.5" />}
                      />
                    </div>
                    {/* Loan */}
                    {loan?.active && (
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Active Loan</span>
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
                        <Progress
                          value={loan.currentLTV}
                          className={cn(
                            "h-1.5 mt-1",
                            loan.healthFactor < 1.0
                              ? "[&>div]:bg-red-500"
                              : loan.healthFactor < 1.5
                                ? "[&>div]:bg-yellow-500"
                                : "[&>div]:bg-emerald-500"
                          )}
                        />
                      </div>
                    )}
                  </div>
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

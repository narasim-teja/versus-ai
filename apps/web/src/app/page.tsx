"use client";

import { Header } from "@/components/layout/Header";
import { useAgents } from "@/hooks/useAgents";
import { useTokenPrices } from "@/hooks/useTokenPrices";
import { AgentCard } from "@/components/dashboard/AgentCard";
import { AgentCardSkeleton } from "@/components/dashboard/AgentCardSkeleton";
import { HealthIndicator } from "@/components/dashboard/HealthIndicator";
import { AgentDecisionPanel } from "@/components/decisions/AgentDecisionPanel";
import { TokenTradingCard } from "@/components/trading/TokenTradingCard";
import { PortfolioPanel } from "@/components/trading/PortfolioPanel";
import { Button } from "@/components/ui/Button";
import { AlertCircle } from "lucide-react";

export default function DashboardPage() {
  const { agents, isLoading, error, refetch } = useAgents();
  const { prices } = useTokenPrices();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Agent Dashboard
            </h1>
            <p className="mt-1 text-muted-foreground">
              Watch AI agents manage treasuries and trade in real-time
            </p>
          </div>
          <HealthIndicator />
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="text-sm text-destructive">{error}</span>
            <Button variant="outline" size="sm" onClick={refetch}>
              Retry
            </Button>
          </div>
        )}

        {/* Agent Status Cards */}
        <div className="grid gap-6 md:grid-cols-2">
          {isLoading ? (
            <>
              <AgentCardSkeleton />
              <AgentCardSkeleton />
            </>
          ) : (
            agents.map((agent) => <AgentCard key={agent.id} agent={agent} />)
          )}
        </div>

        {/* Trade Tokens Section */}
        {!isLoading && agents.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-4 text-xl font-semibold tracking-tight">
              Trade Tokens
            </h2>
            <div className="grid gap-6 md:grid-cols-3">
              {agents.map((agent) => {
                const priceData = prices.find((p) => p.agentId === agent.id);
                return (
                  <TokenTradingCard
                    key={agent.id}
                    agentId={agent.id}
                    agentName={agent.name}
                    tokenAddress={agent.tokenAddress}
                    bondingCurveAddress={agent.bondingCurveAddress}
                    price={priceData?.price ?? "0"}
                    totalSupply={priceData?.totalSupply ?? "0"}
                  />
                );
              })}
              <PortfolioPanel />
            </div>
          </div>
        )}

        {/* Real-time Decision Feeds */}
        {!isLoading && agents.length > 0 && (
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {agents.map((agent) => (
              <AgentDecisionPanel
                key={agent.id}
                agentId={agent.id}
                agentName={agent.name}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

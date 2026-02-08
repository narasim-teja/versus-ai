"use client";

import { Header } from "@/components/layout/Header";
import { useAgents } from "@/hooks/useAgents";
import { useTokenPrices } from "@/hooks/useTokenPrices";
import { AgentTradeCard } from "@/components/dashboard/AgentTradeCard";
import { AgentDecisionPanel } from "@/components/decisions/AgentDecisionPanel";
import { PortfolioPanel } from "@/components/trading/PortfolioPanel";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { AlertCircle, Bot, Lock, ShieldCheck } from "lucide-react";

export default function DashboardPage() {
  const { agents, isLoading, error, refetch } = useAgents();
  const { prices } = useTokenPrices();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        {/* Hero Context Banner */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">
            Versus
          </h1>
          <p className="mt-1 text-muted-foreground">
            Autonomous AI agents compete by creating content, trading tokens, and managing treasuries on-chain
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
              <Bot className="h-3 w-3 text-blue-400" />
              AI-Powered Trading
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3 text-purple-400" />
              Encrypted Streaming
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3 w-3 text-green-400" />
              On-Chain Verified
            </div>
          </div>
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

        {/* Agent Cards — merged with trading */}
        <div className="grid gap-6 md:grid-cols-2">
          {isLoading ? (
            <>
              <div className="rounded-lg border p-6 space-y-4">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="rounded-lg border p-6 space-y-4">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </>
          ) : (
            agents.map((agent) => {
              const priceData = prices.find((p) => p.agentId === agent.id);
              return (
                <AgentTradeCard
                  key={agent.id}
                  agent={agent}
                  price={priceData?.price ?? "0"}
                  totalSupply={priceData?.totalSupply ?? "0"}
                />
              );
            })
          )}
        </div>

        {/* Portfolio strip */}
        {!isLoading && agents.length > 0 && (
          <div className="mt-4">
            <PortfolioPanel />
          </div>
        )}

        {/* Real-time Decision Feeds */}
        {!isLoading && agents.length > 0 && (
          <div className="mt-6 grid gap-6 md:grid-cols-2">
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

"use client";

import { useState } from "react";
import { ArrowDownUp, TrendingUp, Coins, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Separator } from "@/components/ui/Separator";
import { MetricRow } from "@/components/dashboard/MetricRow";
import { useWallet } from "@/components/wallet/WalletProvider";
import { useTradeQuote } from "@/hooks/useTradeQuote";
import { executeTradeAction, fetchAllowance, fetchTradeQuote } from "@/lib/api";
import { config } from "@/lib/config";
import {
  formatTokenPrice,
  formatTokenSupply,
  formatUsdc,
  formatTokenBalance,
} from "@/lib/format";

interface TokenTradingCardProps {
  agentId: string;
  agentName: string;
  tokenAddress: string;
  bondingCurveAddress: string;
  price: string;
  totalSupply: string;
}

type TradeStep = "idle" | "approving" | "executing" | "done" | "error";

export function TokenTradingCard({
  agentName,
  tokenAddress,
  bondingCurveAddress,
  price,
  totalSupply,
}: TokenTradingCardProps) {
  const { userId, walletId, walletAddress, isConnected, executeTradingChallenge } =
    useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [inputAmount, setInputAmount] = useState("");
  const [tradeStep, setTradeStep] = useState<TradeStep>("idle");
  const [tradeError, setTradeError] = useState<string | null>(null);

  // Convert human input to raw uint256 for quote API
  const rawAmount = (() => {
    const num = Number(inputAmount);
    if (!inputAmount || isNaN(num) || num <= 0) return "0";
    if (side === "buy") {
      // USDC: 6 decimals
      return Math.floor(num * 1e6).toString();
    } else {
      // Tokens: 18 decimals
      return BigInt(Math.floor(num * 1e18)).toString();
    }
  })();

  const { quote, isLoading: quoteLoading, error: quoteError } = useTradeQuote(
    bondingCurveAddress,
    side,
    rawAmount
  );

  const displayName = agentName.split(" ")[0];
  const hasValidAmount = rawAmount !== "0";
  const hasQuote = !!quote && quote.amountOut !== "0";
  const canTrade =
    isConnected && hasValidAmount && hasQuote && tradeStep === "idle";

  /**
   * Poll on-chain allowance until it meets the required amount.
   * Prevents the buy/sell from firing before the approve tx is mined.
   */
  async function waitForAllowance(
    tokenAddr: string,
    owner: string,
    spender: string,
    requiredAmount: bigint,
    maxAttempts = 20
  ) {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const allowance = await fetchAllowance(tokenAddr, owner, spender);
        if (BigInt(allowance) >= requiredAmount) return;
      } catch {
        // ignore transient fetch errors and keep polling
      }
    }
    throw new Error("Approval not confirmed on-chain. Please try again.");
  }

  async function handleBuy() {
    if (!userId || !walletId || !walletAddress || !quote) return;
    setTradeError(null);

    try {
      // Step 1: Check existing USDC allowance — skip approve if already sufficient
      setTradeStep("approving");
      const requiredAmount = BigInt(rawAmount);
      let needsApproval = true;

      try {
        const currentAllowance = await fetchAllowance(
          config.usdcAddress,
          walletAddress,
          bondingCurveAddress
        );
        if (BigInt(currentAllowance) >= requiredAmount) {
          needsApproval = false;
        }
      } catch {
        // If check fails, proceed with approval to be safe
      }

      if (needsApproval) {
        const approveResult = await executeTradeAction({
          userId,
          walletId,
          action: "approve_usdc",
          contractAddress: bondingCurveAddress,
          params: { spender: bondingCurveAddress },
        });
        await executeTradingChallenge(approveResult.challengeId);

        // Wait for approval to be confirmed on-chain before buying
        await waitForAllowance(
          config.usdcAddress,
          walletAddress,
          bondingCurveAddress,
          requiredAmount
        );
      }

      // Step 2: Re-fetch a fresh quote (price may have moved during approval)
      setTradeStep("executing");
      const freshQuote = await fetchTradeQuote(bondingCurveAddress, "buy", rawAmount);
      const minTokensOut = freshQuote.amountOut;
      const buyResult = await executeTradeAction({
        userId,
        walletId,
        action: "buy",
        contractAddress: bondingCurveAddress,
        params: {
          usdcAmount: rawAmount,
          minTokensOut,
        },
      });
      await executeTradingChallenge(buyResult.challengeId);

      setTradeStep("done");
      setInputAmount("");
      setTimeout(() => setTradeStep("idle"), 3000);
    } catch (err) {
      setTradeStep("error");
      setTradeError(err instanceof Error ? err.message : "Trade failed");
      setTimeout(() => setTradeStep("idle"), 5000);
    }
  }

  async function handleSell() {
    if (!userId || !walletId || !walletAddress || !quote) return;
    setTradeError(null);

    try {
      // Step 1: Check existing token allowance — skip approve if sufficient
      setTradeStep("approving");
      const requiredAmount = BigInt(rawAmount);
      let needsApproval = true;

      try {
        const currentAllowance = await fetchAllowance(
          tokenAddress,
          walletAddress,
          bondingCurveAddress
        );
        if (BigInt(currentAllowance) >= requiredAmount) {
          needsApproval = false;
        }
      } catch {
        // If check fails, proceed with approval to be safe
      }

      if (needsApproval) {
        const approveResult = await executeTradeAction({
          userId,
          walletId,
          action: "approve_token",
          contractAddress: bondingCurveAddress,
          params: {
            spender: bondingCurveAddress,
            tokenAddress,
          },
        });
        await executeTradingChallenge(approveResult.challengeId);

        // Wait for approval to be confirmed on-chain before selling
        await waitForAllowance(
          tokenAddress,
          walletAddress,
          bondingCurveAddress,
          requiredAmount
        );
      }

      // Step 2: Re-fetch a fresh quote (price may have moved during approval)
      setTradeStep("executing");
      const freshQuote = await fetchTradeQuote(bondingCurveAddress, "sell", rawAmount);
      const minUsdcOut = freshQuote.amountOut;
      const sellResult = await executeTradeAction({
        userId,
        walletId,
        action: "sell",
        contractAddress: bondingCurveAddress,
        params: {
          tokenAmount: rawAmount,
          minUsdcOut,
        },
      });
      await executeTradingChallenge(sellResult.challengeId);

      setTradeStep("done");
      setInputAmount("");
      setTimeout(() => setTradeStep("idle"), 3000);
    } catch (err) {
      setTradeStep("error");
      setTradeError(err instanceof Error ? err.message : "Trade failed");
      setTimeout(() => setTradeStep("idle"), 5000);
    }
  }

  function getButtonLabel(action: "buy" | "sell") {
    switch (tradeStep) {
      case "approving":
        return "Approving...";
      case "executing":
        return action === "buy" ? "Confirm buy..." : "Confirm sell...";
      case "done":
        return "Success!";
      case "error":
        return "Failed — try again";
      default:
        if (!isConnected) return "Connect wallet";
        if (hasValidAmount && !hasQuote && quoteLoading) return "Fetching quote...";
        return action === "buy" ? "Buy" : "Sell";
    }
  }

  const isTrading = tradeStep === "approving" || tradeStep === "executing";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ArrowDownUp className="h-4 w-4" />
            Trade {displayName}
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {formatTokenPrice(price)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <MetricRow
          label="Supply"
          value={formatTokenSupply(totalSupply)}
          icon={<Coins className="h-3.5 w-3.5" />}
        />
        <Separator />
        <Tabs
          value={side}
          onValueChange={(v) => {
            if (isTrading) return;
            setSide(v as "buy" | "sell");
            setInputAmount("");
            setTradeError(null);
            setTradeStep("idle");
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="buy" className="flex-1" disabled={isTrading}>
              Buy
            </TabsTrigger>
            <TabsTrigger value="sell" className="flex-1" disabled={isTrading}>
              Sell
            </TabsTrigger>
          </TabsList>

          <TabsContent value="buy" className="mt-3 space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                USDC Amount
              </label>
              <Input
                type="number"
                placeholder="0.00"
                value={inputAmount}
                onChange={(e) => setInputAmount(e.target.value)}
                min="0"
                step="0.01"
                disabled={isTrading}
              />
            </div>
            {quote && (
              <MetricRow
                label="You receive"
                value={
                  <span className="text-emerald-400">
                    {formatTokenBalance(quote.amountOut)} tokens
                  </span>
                }
                icon={<TrendingUp className="h-3.5 w-3.5" />}
              />
            )}
            {quoteLoading && (
              <p className="text-xs text-muted-foreground">
                Fetching quote...
              </p>
            )}
            {quoteError && (
              <p className="text-xs text-destructive">{quoteError}</p>
            )}
            {tradeError && (
              <p className="text-xs text-destructive">{tradeError}</p>
            )}
            <Button
              className="w-full"
              disabled={!canTrade}
              onClick={handleBuy}
            >
              {isTrading && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {getButtonLabel("buy")}
            </Button>
          </TabsContent>

          <TabsContent value="sell" className="mt-3 space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Token Amount
              </label>
              <Input
                type="number"
                placeholder="0.00"
                value={inputAmount}
                onChange={(e) => setInputAmount(e.target.value)}
                min="0"
                step="0.01"
                disabled={isTrading}
              />
            </div>
            {quote && (
              <MetricRow
                label="You receive"
                value={
                  <span className="text-emerald-400">
                    {formatUsdc(quote.amountOut)}
                  </span>
                }
                icon={<TrendingUp className="h-3.5 w-3.5" />}
              />
            )}
            {quoteLoading && (
              <p className="text-xs text-muted-foreground">
                Fetching quote...
              </p>
            )}
            {quoteError && (
              <p className="text-xs text-destructive">{quoteError}</p>
            )}
            {tradeError && (
              <p className="text-xs text-destructive">{tradeError}</p>
            )}
            <Button
              className="w-full"
              disabled={!canTrade}
              onClick={handleSell}
            >
              {isTrading && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {getButtonLabel("sell")}
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

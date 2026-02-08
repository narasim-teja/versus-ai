"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useWallet } from "@/components/wallet/WalletProvider";
import { useTradeQuote } from "@/hooks/useTradeQuote";
import { executeTradeAction, fetchAllowance, fetchTradeQuote } from "@/lib/api";
import { config } from "@/lib/config";
import { formatUsdc, formatTokenBalance } from "@/lib/format";

interface CompactTradeFormProps {
  tokenAddress: string;
  bondingCurveAddress: string;
}

type TradeStep = "idle" | "approving" | "executing" | "done" | "error";

export function CompactTradeForm({
  tokenAddress,
  bondingCurveAddress,
}: CompactTradeFormProps) {
  const { userId, walletId, walletAddress, isConnected, executeTradingChallenge } =
    useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [inputAmount, setInputAmount] = useState("");
  const [tradeStep, setTradeStep] = useState<TradeStep>("idle");
  const [tradeError, setTradeError] = useState<string | null>(null);

  const rawAmount = (() => {
    const num = Number(inputAmount);
    if (!inputAmount || isNaN(num) || num <= 0) return "0";
    if (side === "buy") return Math.floor(num * 1e6).toString();
    return BigInt(Math.floor(num * 1e18)).toString();
  })();

  const { quote, isLoading: quoteLoading } = useTradeQuote(
    bondingCurveAddress,
    side,
    rawAmount
  );

  const hasValidAmount = rawAmount !== "0";
  const hasQuote = !!quote && quote.amountOut !== "0";
  const canTrade = isConnected && hasValidAmount && hasQuote && tradeStep === "idle";
  const isTrading = tradeStep === "approving" || tradeStep === "executing";

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
        // ignore
      }
    }
    throw new Error("Approval not confirmed on-chain.");
  }

  async function handleTrade() {
    if (!quote || !userId || !walletId || !walletAddress) return;
    setTradeError(null);

    try {
      setTradeStep("approving");
      const requiredAmount = BigInt(rawAmount);
      const approveToken = side === "buy" ? config.usdcAddress : tokenAddress;
      let needsApproval = true;

      try {
        const currentAllowance = await fetchAllowance(approveToken, walletAddress, bondingCurveAddress);
        if (BigInt(currentAllowance) >= requiredAmount) needsApproval = false;
      } catch { /* proceed with approval */ }

      if (needsApproval) {
        const approveResult = await executeTradeAction({
          userId, walletId,
          action: side === "buy" ? "approve_usdc" : "approve_token",
          contractAddress: bondingCurveAddress,
          params: side === "buy"
            ? { spender: bondingCurveAddress }
            : { spender: bondingCurveAddress, tokenAddress },
        });
        await executeTradingChallenge(approveResult.challengeId);
        await waitForAllowance(approveToken, walletAddress, bondingCurveAddress, requiredAmount);
      }

      setTradeStep("executing");
      const freshQuote = await fetchTradeQuote(bondingCurveAddress, side, rawAmount);
      const result = await executeTradeAction({
        userId, walletId,
        action: side,
        contractAddress: bondingCurveAddress,
        params: side === "buy"
          ? { usdcAmount: rawAmount, minTokensOut: freshQuote.amountOut }
          : { tokenAmount: rawAmount, minUsdcOut: freshQuote.amountOut },
      });
      await executeTradingChallenge(result.challengeId);

      setTradeStep("done");
      setInputAmount("");
      setTimeout(() => setTradeStep("idle"), 3000);
    } catch (err) {
      setTradeStep("error");
      setTradeError(err instanceof Error ? err.message : "Trade failed");
      setTimeout(() => setTradeStep("idle"), 5000);
    }
  }

  function getButtonLabel() {
    switch (tradeStep) {
      case "approving": return "Approving...";
      case "executing": return side === "buy" ? "Buying..." : "Selling...";
      case "done": return "Success!";
      case "error": return "Failed";
      default:
        if (!isConnected) return "Connect wallet";
        if (hasValidAmount && !hasQuote && quoteLoading) return "Getting quote...";
        return side === "buy" ? "Buy" : "Sell";
    }
  }

  return (
    <div className="space-y-2">
      {/* Buy/Sell toggle */}
      <div className="flex rounded-lg border bg-muted/30 p-0.5">
        <button
          onClick={() => { if (!isTrading) { setSide("buy"); setInputAmount(""); setTradeError(null); setTradeStep("idle"); } }}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            side === "buy"
              ? "bg-emerald-500/20 text-emerald-400"
              : "text-muted-foreground hover:text-foreground"
          }`}
          disabled={isTrading}
        >
          Buy
        </button>
        <button
          onClick={() => { if (!isTrading) { setSide("sell"); setInputAmount(""); setTradeError(null); setTradeStep("idle"); } }}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            side === "sell"
              ? "bg-red-500/20 text-red-400"
              : "text-muted-foreground hover:text-foreground"
          }`}
          disabled={isTrading}
        >
          Sell
        </button>
      </div>

      {/* Input + Quote */}
      <div className="flex items-center gap-2">
        <Input
          type="number"
          placeholder={side === "buy" ? "USDC" : "Tokens"}
          value={inputAmount}
          onChange={(e) => setInputAmount(e.target.value)}
          min="0"
          step="0.01"
          disabled={isTrading}
          className="h-8 text-xs"
        />
        <Button
          size="sm"
          className="h-8 shrink-0 text-xs"
          disabled={!canTrade}
          onClick={handleTrade}
        >
          {isTrading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {getButtonLabel()}
        </Button>
      </div>

      {/* Quote result */}
      {quote && hasValidAmount && (
        <p className="text-[11px] text-muted-foreground">
          You receive:{" "}
          <span className="text-emerald-400 font-medium">
            {side === "buy"
              ? `${formatTokenBalance(quote.amountOut)} tokens`
              : formatUsdc(quote.amountOut)}
          </span>
        </p>
      )}

      {tradeError && (
        <p className="text-[11px] text-destructive">{tradeError}</p>
      )}
    </div>
  );
}

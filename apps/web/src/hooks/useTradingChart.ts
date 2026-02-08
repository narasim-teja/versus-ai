"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchChartCandles, fetchTradeHistory } from "@/lib/api";
import type { CandleData, TradeData } from "@/lib/types";

export function useTradingChart(
  tokenAddress: string | undefined,
  refreshInterval = 10000
) {
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [trades, setTrades] = useState<TradeData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tokenAddress) return;
    try {
      const [candleData, tradeData] = await Promise.all([
        fetchChartCandles(tokenAddress, "5m", 100),
        fetchTradeHistory(tokenAddress, 30),
      ]);
      setCandles(candleData);
      setTrades(tradeData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load chart data");
    } finally {
      setIsLoading(false);
    }
  }, [tokenAddress]);

  useEffect(() => {
    if (!tokenAddress) return;

    let mounted = true;
    const doLoad = async () => {
      try {
        const [candleData, tradeData] = await Promise.all([
          fetchChartCandles(tokenAddress, "5m", 100),
          fetchTradeHistory(tokenAddress, 30),
        ]);
        if (mounted) {
          setCandles(candleData);
          setTrades(tradeData);
          setError(null);
        }
      } catch (e) {
        if (mounted)
          setError(
            e instanceof Error ? e.message : "Failed to load chart data"
          );
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    doLoad();
    const interval = setInterval(doLoad, refreshInterval);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [tokenAddress, refreshInterval]);

  return { candles, trades, isLoading, error, refetch: load };
}

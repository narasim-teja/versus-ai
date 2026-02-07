"use client";

import { useEffect, useState, useRef } from "react";
import { fetchTradeQuote } from "@/lib/api";
import type { TradeQuote } from "@/lib/types";

export function useTradeQuote(
  bondingCurveAddress: string | null,
  side: "buy" | "sell",
  amount: string
) {
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!bondingCurveAddress || !amount || amount === "0") {
      setQuote(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        const data = await fetchTradeQuote(bondingCurveAddress, side, amount);
        setQuote(data);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Quote failed");
        setQuote(null);
      } finally {
        setIsLoading(false);
      }
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [bondingCurveAddress, side, amount]);

  return { quote, isLoading, error };
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchTokenPrices } from "@/lib/api";
import type { TokenPrice } from "@/lib/types";

export function useTokenPrices(refreshInterval = 10000) {
  const [prices, setPrices] = useState<TokenPrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchTokenPrices();
      setPrices(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load prices");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const doLoad = async () => {
      try {
        const data = await fetchTokenPrices();
        if (mounted) {
          setPrices(data);
          setError(null);
        }
      } catch (e) {
        if (mounted)
          setError(e instanceof Error ? e.message : "Failed to load prices");
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
  }, [refreshInterval]);

  return { prices, isLoading, error, refetch: load };
}

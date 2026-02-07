"use client";

import { useEffect, useState } from "react";
import { fetchPortfolio } from "@/lib/api";
import type { Portfolio } from "@/lib/types";

export function usePortfolio(address: string | null, refreshInterval = 15000) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setPortfolio(null);
      return;
    }

    let mounted = true;
    setIsLoading(true);

    const doLoad = async () => {
      try {
        const data = await fetchPortfolio(address);
        if (mounted) {
          setPortfolio(data);
          setError(null);
        }
      } catch (e) {
        if (mounted)
          setError(
            e instanceof Error ? e.message : "Failed to load portfolio"
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
  }, [address, refreshInterval]);

  return { portfolio, isLoading, error };
}

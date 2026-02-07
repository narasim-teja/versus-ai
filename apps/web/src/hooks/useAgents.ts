"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAgents } from "@/lib/api";
import type { Agent } from "@/lib/types";

export function useAgents(refreshInterval = 10000) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchAgents();
      setAgents(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agents");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const doLoad = async () => {
      try {
        const data = await fetchAgents();
        if (mounted) {
          setAgents(data);
          setError(null);
        }
      } catch (e) {
        if (mounted)
          setError(e instanceof Error ? e.message : "Failed to load agents");
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

  return { agents, isLoading, error, refetch: load };
}

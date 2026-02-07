"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchVideos } from "@/lib/api";
import type { Video } from "@/lib/types";

export function useVideos(refreshInterval = 15000) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchVideos();
      setVideos(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load videos");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const doLoad = async () => {
      try {
        const data = await fetchVideos();
        if (mounted) {
          setVideos(data);
          setError(null);
        }
      } catch (e) {
        if (mounted)
          setError(e instanceof Error ? e.message : "Failed to load videos");
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

  return { videos, isLoading, error, refetch: load };
}

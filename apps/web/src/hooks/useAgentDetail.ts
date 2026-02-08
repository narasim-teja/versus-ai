"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchAgent,
  fetchAgentLiveState,
  fetchAgentVideos,
  fetchAgentEarnings,
  fetchRecentDecisions,
} from "@/lib/api";
import type {
  AgentDetail,
  AgentLiveState,
  Video,
  AgentEarnings,
  DecisionLog,
} from "@/lib/types";

export function useAgentDetail(agentId: string, refreshInterval = 10000) {
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [liveState, setLiveState] = useState<AgentLiveState | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [earnings, setEarnings] = useState<AgentEarnings | null>(null);
  const [decisions, setDecisions] = useState<DecisionLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [agentData, stateData, videosData, earningsData, decisionsData] =
        await Promise.all([
          fetchAgent(agentId),
          fetchAgentLiveState(agentId),
          fetchAgentVideos(agentId),
          fetchAgentEarnings(agentId),
          fetchRecentDecisions(agentId, 20),
        ]);
      setAgent(agentData);
      setLiveState(stateData);
      setVideos(videosData);
      setEarnings(earningsData);
      setDecisions(decisionsData);
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load agent details"
      );
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    let mounted = true;
    const doLoad = async () => {
      try {
        const [agentData, stateData, videosData, earningsData, decisionsData] =
          await Promise.all([
            fetchAgent(agentId),
            fetchAgentLiveState(agentId),
            fetchAgentVideos(agentId),
            fetchAgentEarnings(agentId),
            fetchRecentDecisions(agentId, 20),
          ]);
        if (mounted) {
          setAgent(agentData);
          setLiveState(stateData);
          setVideos(videosData);
          setEarnings(earningsData);
          setDecisions(decisionsData);
          setError(null);
        }
      } catch (e) {
        if (mounted)
          setError(
            e instanceof Error ? e.message : "Failed to load agent details"
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
  }, [agentId, refreshInterval]);

  return { agent, liveState, videos, earnings, decisions, isLoading, error, refetch: load };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentWebSocket } from "@/hooks/useAgentWebSocket";
import { fetchDecisions } from "@/lib/api";
import { DecisionFeed } from "./DecisionFeed";
import type { DecisionLog } from "@/lib/types";

interface AgentDecisionPanelProps {
  agentId: string;
  agentName: string;
}

const PAGE_SIZE = 10;

export function AgentDecisionPanel({
  agentId,
  agentName,
}: AgentDecisionPanelProps) {
  const { decisions: wsDecisions, connectionStatus } = useAgentWebSocket(agentId);

  const [dbDecisions, setDbDecisions] = useState<DecisionLog[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [initialLoading, setInitialLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const loadedRef = useRef(false);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Load a specific page from DB
  const loadPage = useCallback(
    async (page: number, isInitial = false) => {
      if (!isInitial) setPageLoading(true);
      try {
        const offset = (page - 1) * PAGE_SIZE;
        const res = await fetchDecisions(agentId, PAGE_SIZE, offset);
        setDbDecisions(res.decisions);
        setTotalCount(res.pagination.totalCount);
        setCurrentPage(page);
      } catch (err) {
        console.error(`[DecisionPanel] Failed to load decisions for ${agentId}:`, err);
      } finally {
        if (isInitial) setInitialLoading(false);
        else setPageLoading(false);
      }
    },
    [agentId]
  );

  // Load first page on mount
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadPage(1, true);
  }, [loadPage]);

  // On page 1, merge WS (real-time) decisions on top of DB results
  // On other pages, just show DB results
  const decisions =
    currentPage === 1
      ? mergeDecisions(wsDecisions, dbDecisions)
      : dbDecisions;

  return (
    <DecisionFeed
      agentName={agentName}
      decisions={decisions}
      connectionStatus={connectionStatus}
      currentPage={currentPage}
      totalPages={totalPages}
      totalCount={totalCount}
      pageLoading={pageLoading}
      initialLoading={initialLoading}
      onPageChange={loadPage}
    />
  );
}

/** Merge WS (real-time) and DB decisions, deduplicating by id */
function mergeDecisions(
  wsDecisions: DecisionLog[],
  dbDecisions: DecisionLog[]
): DecisionLog[] {
  const seen = new Set<number>();
  const merged: DecisionLog[] = [];

  for (const d of wsDecisions) {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      merged.push(d);
    }
  }

  for (const d of dbDecisions) {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      merged.push(d);
    }
  }

  return merged;
}

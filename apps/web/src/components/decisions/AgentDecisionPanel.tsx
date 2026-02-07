"use client";

import { useAgentWebSocket } from "@/hooks/useAgentWebSocket";
import { DecisionFeed } from "./DecisionFeed";

interface AgentDecisionPanelProps {
  agentId: string;
  agentName: string;
}

export function AgentDecisionPanel({
  agentId,
  agentName,
}: AgentDecisionPanelProps) {
  const { decisions, connectionStatus } = useAgentWebSocket(agentId);

  return (
    <DecisionFeed
      agentName={agentName}
      decisions={decisions}
      connectionStatus={connectionStatus}
    />
  );
}

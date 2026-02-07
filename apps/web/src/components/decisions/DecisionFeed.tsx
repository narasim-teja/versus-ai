"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConnectionStatus } from "./ConnectionStatus";
import { DecisionEntry } from "./DecisionEntry";
import type { ConnectionStatus as ConnectionStatusType } from "@/hooks/useAgentWebSocket";
import type { DecisionLog } from "@/lib/types";

interface DecisionFeedProps {
  agentName: string;
  decisions: DecisionLog[];
  connectionStatus: ConnectionStatusType;
}

export function DecisionFeed({
  agentName,
  decisions,
  connectionStatus,
}: DecisionFeedProps) {
  return (
    <Card className="flex h-[500px] flex-col">
      <CardHeader className="flex-none pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{agentName} - Decisions</CardTitle>
          <ConnectionStatus status={connectionStatus} />
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden pb-4">
        <ScrollArea className="h-full pr-2">
          {decisions.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                {connectionStatus === "connected"
                  ? "Waiting for decisions..."
                  : "Connecting..."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {decisions.map((decision) => (
                <DecisionEntry key={decision.id} decision={decision} />
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

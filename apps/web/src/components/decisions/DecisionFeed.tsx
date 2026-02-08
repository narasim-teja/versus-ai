"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/Button";
import { ConnectionStatus } from "./ConnectionStatus";
import { DecisionEntry } from "./DecisionEntry";
import type { ConnectionStatus as ConnectionStatusType } from "@/hooks/useAgentWebSocket";
import type { DecisionLog } from "@/lib/types";

interface DecisionFeedProps {
  agentName: string;
  decisions: DecisionLog[];
  connectionStatus: ConnectionStatusType;
}

const INITIAL_SHOW = 5;

export function DecisionFeed({
  agentName,
  decisions,
  connectionStatus,
}: DecisionFeedProps) {
  const [showAll, setShowAll] = useState(false);
  const displayName = agentName.split(" ")[0];
  const visibleDecisions = showAll ? decisions : decisions.slice(0, INITIAL_SHOW);
  const hasMore = decisions.length > INITIAL_SHOW;

  return (
    <Card className="flex h-[360px] flex-col">
      <CardHeader className="flex-none pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{displayName} Decisions</CardTitle>
          <ConnectionStatus status={connectionStatus} />
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden pb-3">
        <ScrollArea className="h-full pr-2">
          {decisions.length === 0 ? (
            <div className="flex h-24 items-center justify-center">
              <p className="text-xs text-muted-foreground">
                {connectionStatus === "connected"
                  ? "Waiting for decisions..."
                  : "Connecting..."}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {visibleDecisions.map((decision, index) => (
                <DecisionEntry key={`${decision.agentId}-${decision.id}-${index}`} decision={decision} />
              ))}
              {hasMore && !showAll && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  onClick={() => setShowAll(true)}
                >
                  Show {decisions.length - INITIAL_SHOW} more
                </Button>
              )}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

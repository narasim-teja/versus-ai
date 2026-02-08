"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConnectionStatus } from "./ConnectionStatus";
import { DecisionEntry } from "./DecisionEntry";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import type { ConnectionStatus as ConnectionStatusType } from "@/hooks/useAgentWebSocket";
import type { DecisionLog } from "@/lib/types";

interface DecisionFeedProps {
  agentName: string;
  decisions: DecisionLog[];
  connectionStatus: ConnectionStatusType;
  currentPage?: number;
  totalPages?: number;
  totalCount?: number;
  pageLoading?: boolean;
  initialLoading?: boolean;
  onPageChange?: (page: number) => void;
}

export function DecisionFeed({
  agentName,
  decisions,
  connectionStatus,
  currentPage = 1,
  totalPages = 1,
  totalCount,
  pageLoading = false,
  initialLoading = false,
  onPageChange,
}: DecisionFeedProps) {
  const displayName = agentName.split(" ")[0];

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-none pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            {displayName} Decisions
            {totalCount != null && totalCount > 0 && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                ({totalCount})
              </span>
            )}
          </CardTitle>
          <ConnectionStatus status={connectionStatus} />
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        {initialLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : decisions.length === 0 ? (
          <div className="flex h-24 items-center justify-center">
            <p className="text-xs text-muted-foreground">
              {connectionStatus === "connected"
                ? "No decisions yet"
                : "Connecting..."}
            </p>
          </div>
        ) : (
          <>
            <div className={`space-y-1.5 ${pageLoading ? "opacity-50 pointer-events-none" : ""}`}>
              {decisions.map((decision, index) => (
                <DecisionEntry
                  key={`${decision.agentId}-${decision.id}-${index}`}
                  decision={decision}
                />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && onPageChange && (
              <div className="mt-3 flex items-center justify-between border-t pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => onPageChange(currentPage - 1)}
                  disabled={currentPage <= 1 || pageLoading}
                >
                  <ChevronLeft className="mr-1 h-3 w-3" />
                  Prev
                </Button>
                <div className="flex items-center gap-1">
                  {getPageNumbers(currentPage, totalPages).map((page, i) =>
                    page === "..." ? (
                      <span
                        key={`ellipsis-${i}`}
                        className="px-1 text-xs text-muted-foreground"
                      >
                        ...
                      </span>
                    ) : (
                      <Button
                        key={page}
                        variant={page === currentPage ? "default" : "ghost"}
                        size="sm"
                        className="h-7 w-7 p-0 text-xs"
                        onClick={() => onPageChange(page as number)}
                        disabled={pageLoading}
                      >
                        {page}
                      </Button>
                    )
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => onPageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages || pageLoading}
                >
                  Next
                  <ChevronRight className="ml-1 h-3 w-3" />
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Generate page numbers with ellipsis for large page counts */
function getPageNumbers(
  current: number,
  total: number
): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "...")[] = [1];

  if (current > 3) pages.push("...");

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) pages.push("...");

  pages.push(total);
  return pages;
}

"use client";

import { DollarSign, Zap, Clock, Film, Wallet, Lock } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { ViewingSession, SessionStatus } from "@/lib/types";
import type { SessionState } from "@/hooks/useVideoSession";
import { formatDuration } from "@/lib/format";

interface PaymentOverlayProps {
  session: ViewingSession | null;
  sessionState: SessionState;
  sessionStatus: SessionStatus | null;
  onClose: () => void;
  ephemeralAddress?: string | null;
  isStateChanelSession?: boolean;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function PaymentOverlay({
  session,
  sessionState,
  sessionStatus,
  onClose,
  ephemeralAddress,
  isStateChanelSession,
}: PaymentOverlayProps) {
  if (!session) return null;

  const isYellow = session.type === "yellow";

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-8">
      <div className="flex items-end justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Session type badge */}
          <Badge
            variant="outline"
            className={
              isYellow
                ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                : "border-blue-500/30 bg-blue-500/10 text-blue-400"
            }
          >
            <Zap className="mr-1 h-3 w-3" />
            {isStateChanelSession
              ? "State Channel"
              : isYellow
                ? "Yellow Network"
                : "Legacy Session"}
          </Badge>

          {/* Ephemeral address (state channel only) */}
          {isStateChanelSession && ephemeralAddress && (
            <Badge
              variant="outline"
              className="border-purple-500/30 bg-purple-500/10 text-purple-400"
            >
              <Wallet className="mr-1 h-3 w-3" />
              {truncateAddress(ephemeralAddress)}
            </Badge>
          )}

          {/* On-chain Custody channel badge */}
          {isYellow && session.channelId && (
            <Badge
              variant="outline"
              className="border-orange-500/30 bg-orange-500/10 text-orange-400"
            >
              <Lock className="mr-1 h-3 w-3" />
              On-Chain: {truncateAddress(session.channelId)}
            </Badge>
          )}

          {/* Balance (Yellow only) */}
          {isYellow && sessionStatus && (
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            >
              <DollarSign className="mr-1 h-3 w-3" />
              Balance: ${sessionStatus.viewerBalance}
            </Badge>
          )}

          {/* Segments watched */}
          {sessionStatus && (
            <Badge
              variant="outline"
              className="border-muted-foreground/30 text-muted-foreground"
            >
              <Film className="mr-1 h-3 w-3" />
              {sessionStatus.segmentsDelivered} segments
            </Badge>
          )}

          {/* Time watched */}
          {sessionStatus && (
            <Badge
              variant="outline"
              className="border-muted-foreground/30 text-muted-foreground"
            >
              <Clock className="mr-1 h-3 w-3" />
              {formatDuration(sessionStatus.secondsWatched)}
            </Badge>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onClose}
          className="text-xs"
        >
          End Session
        </Button>
      </div>

      {/* Insufficient balance warning */}
      {sessionState === "insufficient_balance" && (
        <div className="mt-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Insufficient balance. Video is paused. Please close this session and
          start a new one with a higher deposit.
        </div>
      )}
    </div>
  );
}

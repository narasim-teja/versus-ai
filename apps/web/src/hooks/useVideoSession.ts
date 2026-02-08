"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createViewingSession,
  closeSession,
  fetchSessionStatus,
} from "@/lib/api";
import { config } from "@/lib/config";
import type { ViewingSession, SessionStatus, SessionCloseResult } from "@/lib/types";
import { useYellowSession } from "./useYellowSession";

export type SessionState =
  | "idle"
  | "creating"
  | "active"
  | "insufficient_balance"
  | "closing"
  | "closed"
  | "error";

/** Duration of each HLS segment in seconds */
const SEGMENT_DURATION_SECONDS = 5;

interface UseVideoSessionReturn {
  session: ViewingSession | null;
  sessionState: SessionState;
  sessionStatus: SessionStatus | null;
  error: string | null;
  getAuthHeader: () => { name: string; value: string } | null;
  startSession: (
    videoId: string,
    viewerAddress?: string,
    depositAmount?: string
  ) => Promise<void>;
  endSession: () => Promise<void>;
  markInsufficientBalance: () => void;
  /** Available when using Yellow co-sign path — used by custom HLS.js loader */
  signAndRequestKey:
    | ((videoId: string, segmentIndex: number) => Promise<ArrayBuffer>)
    | null;
  /** Whether this session uses real NitroLite co-signing */
  isYellowCosign: boolean;
  /** Ephemeral address used for the state channel */
  ephemeralAddress: string | null;
  /** Settlement result after session close (cross-chain tx hashes) */
  settlementResult: SessionCloseResult | null;
  /** Number of segments with verified merkle proofs */
  segmentsVerified: number;
}

export function useVideoSession(): UseVideoSessionReturn {
  const [session, setSession] = useState<ViewingSession | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [isYellowCosign, setIsYellowCosign] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef<ViewingSession | null>(null);
  const isYellowCosignRef = useRef(false);

  const yellow = useYellowSession();

  // Stable ref for yellow.closeYellowSession so cleanup effect doesn't
  // re-run every render (yellow object is a new reference each render).
  const closeYellowRef = useRef(yellow.closeYellowSession);
  useEffect(() => {
    closeYellowRef.current = yellow.closeYellowSession;
  }, [yellow.closeYellowSession]);

  // Keep refs in sync for cleanup
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    isYellowCosignRef.current = isYellowCosign;
  }, [isYellowCosign]);

  // ─── Sync Yellow session status → component state ───
  useEffect(() => {
    if (!isYellowCosign) return;

    switch (yellow.status) {
      case "connecting":
      case "authenticated":
        setSessionState("creating");
        break;
      case "session_active":
        setSessionState("active");
        if (yellow.state.appSessionId) {
          // Only create session object once — don't recreate on balance updates
          // or it triggers player re-initialization loop
          const appSessionId = yellow.state.appSessionId!;
          setSession((prev: ViewingSession | null) => {
            if (
              prev && prev.type === "yellow" &&
              prev.appSessionId === appSessionId &&
              prev.channelId === (yellow.state.channelId || null)
            ) {
              return prev; // same reference, no re-render
            }
            return {
              type: "yellow",
              appSessionId,
              videoId: yellow.state.videoId!,
              serverAddress: yellow.state.serverAddress || "",
              pricePerSegment: yellow.state.pricePerSegment,
              viewerBalance: yellow.state.viewerBalance,
              totalDeposited: yellow.state.totalDeposited,
              asset: config.yellowAsset,
              channelId: yellow.state.channelId || null,
            };
          });
        }
        break;
      case "insufficient_balance":
        setSessionState("insufficient_balance");
        break;
      case "closing":
        setSessionState("closing");
        break;
      case "closed":
        setSessionState("closed");
        setSession(null);
        setSessionStatus(null);
        setIsYellowCosign(false);
        break;
      case "error":
        setSessionState("error");
        setError(yellow.error);
        break;
    }
  }, [isYellowCosign, yellow.status, yellow.state, yellow.error]);

  // ─── Derive sessionStatus from Yellow state (no polling needed) ───
  useEffect(() => {
    if (!isYellowCosign || yellow.status !== "session_active") return;

    setSessionStatus({
      appSessionId: yellow.state.appSessionId || "",
      videoId: yellow.state.videoId || "",
      status: "active",
      viewerBalance: yellow.state.viewerBalance,
      creatorBalance: yellow.state.serverBalance,
      totalDeposited: yellow.state.totalDeposited,
      segmentsDelivered: yellow.state.segmentsDelivered,
      secondsWatched: yellow.state.segmentsDelivered * SEGMENT_DURATION_SECONDS,
      pricePerSegment: yellow.state.pricePerSegment,
      asset: config.yellowAsset,
    });
  }, [
    isYellowCosign,
    yellow.status,
    yellow.state.viewerBalance,
    yellow.state.serverBalance,
    yellow.state.segmentsDelivered,
    yellow.state.appSessionId,
    yellow.state.videoId,
    yellow.state.totalDeposited,
    yellow.state.pricePerSegment,
  ]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (videoId: string, sessionId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const status = await fetchSessionStatus(videoId, sessionId);
          setSessionStatus(status);
        } catch {
          // Silently fail - status is informational
        }
      }, 5000);
    },
    [stopPolling]
  );

  const getAuthHeader = useCallback(() => {
    if (!session) return null;
    if (session.type === "yellow") {
      return { name: "X-Yellow-Session", value: session.appSessionId };
    }
    return { name: "Authorization", value: `Bearer ${session.sessionId}` };
  }, [session]);

  const startSession = useCallback(
    async (
      videoId: string,
      viewerAddress?: string,
      depositAmount?: string
    ) => {
      setError(null);

      if (viewerAddress && depositAmount) {
        // ─── Yellow co-sign path ───
        setIsYellowCosign(true);
        await yellow.startYellowSession(videoId, depositAmount);
        return;
      }

      // ─── Legacy bearer token path ───
      setSessionState("creating");
      try {
        const newSession = await createViewingSession(videoId);
        setSession(newSession);
        setSessionState("active");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create session");
        setSessionState("error");
      }
    },
    [yellow, startPolling]
  );

  const endSession = useCallback(async () => {
    stopPolling();
    const s = sessionRef.current;
    if (!s) return;

    if (isYellowCosignRef.current && s.type === "yellow") {
      await closeYellowRef.current(s.videoId);
      return;
    }

    // Legacy close
    setSessionState("closing");
    try {
      if (s.type === "yellow") {
        await closeSession(s.videoId, s.appSessionId);
      }
    } catch {
      // Best effort close
    }
    setSession(null);
    setSessionStatus(null);
    setSessionState("closed");
  }, [stopPolling]);

  const markInsufficientBalance = useCallback(() => {
    setSessionState("insufficient_balance");
  }, []);

  // Cleanup on unmount only (not on every re-render)
  useEffect(() => {
    return () => {
      stopPolling();
      const s = sessionRef.current;
      if (s && s.type === "yellow") {
        if (isYellowCosignRef.current) {
          closeYellowRef.current(s.videoId).catch(() => {});
        } else {
          closeSession(s.videoId, s.appSessionId).catch(() => {});
        }
      }
    };
  }, [stopPolling]);

  return {
    session,
    sessionState,
    sessionStatus,
    error,
    getAuthHeader,
    startSession,
    endSession,
    markInsufficientBalance,
    signAndRequestKey: isYellowCosign ? yellow.signAndRequestKey : null,
    isYellowCosign,
    ephemeralAddress: yellow.state.ephemeralAddress,
    settlementResult: yellow.settlementResult,
    segmentsVerified: yellow.state.segmentsVerified,
  };
}

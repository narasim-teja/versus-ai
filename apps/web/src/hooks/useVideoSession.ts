"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createViewingSession,
  closeSession,
  fetchSessionStatus,
} from "@/lib/api";
import type { ViewingSession, SessionStatus } from "@/lib/types";

export type SessionState =
  | "idle"
  | "creating"
  | "active"
  | "insufficient_balance"
  | "closing"
  | "closed"
  | "error";

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
}

export function useVideoSession(): UseVideoSessionReturn {
  const [session, setSession] = useState<ViewingSession | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef<ViewingSession | null>(null);

  // Keep ref in sync for cleanup
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

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
      setSessionState("creating");
      setError(null);
      try {
        const newSession = await createViewingSession(
          videoId,
          viewerAddress,
          depositAmount
        );
        setSession(newSession);
        setSessionState("active");

        // Start polling for Yellow sessions (they have balance info)
        if (newSession.type === "yellow") {
          startPolling(videoId, newSession.appSessionId);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create session");
        setSessionState("error");
      }
    },
    [startPolling]
  );

  const endSession = useCallback(async () => {
    stopPolling();
    const s = sessionRef.current;
    if (!s) return;

    setSessionState("closing");
    try {
      if (s.type === "yellow") {
        await closeSession(s.videoId, s.appSessionId);
      }
      // Legacy sessions just expire, no need to close
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

  // Cleanup on unmount -- close the session
  useEffect(() => {
    return () => {
      stopPolling();
      const s = sessionRef.current;
      if (s && s.type === "yellow") {
        // Fire and forget close on unmount
        closeSession(s.videoId, s.appSessionId).catch(() => {});
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
  };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "@/lib/config";
import type { AgentRuntimeStatus, DecisionLog } from "@/lib/types";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

const MAX_DECISIONS = 50;
const PING_INTERVAL = 25000;
const MAX_RECONNECT_DELAY = 30000;

export function useAgentWebSocket(agentId: string) {
  const [decisions, setDecisions] = useState<DecisionLog[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [agentStatus, setAgentStatus] = useState<AgentRuntimeStatus | null>(
    null
  );

  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const url = `${config.wsBaseUrl}/api/agents/${agentId}/ws`;
    setConnectionStatus("connecting");

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnectionStatus("connected");
        reconnectDelayRef.current = 1000;

        // Start ping keepalive
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_INTERVAL);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "connected") {
            setAgentStatus(msg.status);
          } else if (msg.type === "decision") {
            setDecisions((prev) => {
              const next = [msg.data as DecisionLog, ...prev];
              return next.slice(0, MAX_DECISIONS);
            });
          }
          // pong is a no-op
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        cleanup();
        setConnectionStatus("disconnected");

        // Auto-reconnect with backoff
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(
          delay * 2,
          MAX_RECONNECT_DELAY
        );
        reconnectRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setConnectionStatus("error");
      };
    } catch {
      setConnectionStatus("error");
    }
  }, [agentId]);

  const cleanup = useCallback(() => {
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
  }, []);

  const reconnect = useCallback(() => {
    cleanup();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    reconnectDelayRef.current = 1000;
    connect();
  }, [cleanup, connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      cleanup();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, cleanup]);

  const lastDecision = decisions.length > 0 ? decisions[0] : null;

  return {
    decisions,
    connectionStatus,
    agentStatus,
    lastDecision,
    reconnect,
  };
}

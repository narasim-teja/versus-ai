"use client";

import { useCallback, useRef, useState } from "react";
import {
  connectToClearNode,
  disconnectClearNode,
  requestFaucetTokens,
  signChannelState,
  type YellowBrowserClient,
} from "@/lib/yellow";
import { cosignAndGetKey } from "@/lib/api";
import { config } from "@/lib/config";
import { verifySegmentProof } from "@/lib/merkle-verify";
import type { SessionCloseResult } from "@/lib/types";
import { RPCData } from "@erc7824/nitrolite";

// ─── Types ───────────────────────────────────────────────────────────

export type YellowSessionStatus =
  | "idle"
  | "connecting"
  | "authenticated"
  | "session_active"
  | "insufficient_balance"
  | "closing"
  | "closed"
  | "error";

export interface YellowSessionState {
  appSessionId: string | null;
  videoId: string | null;
  serverAddress: string | null;
  viewerBalance: string;
  serverBalance: string;
  segmentsDelivered: number;
  version: number;
  ephemeralAddress: string | null;
  pricePerSegment: string;
  totalDeposited: string;
  closeStateHash: string | null;
  channelId: string | null;
  segmentsVerified: number;
}

const initialState: YellowSessionState = {
  appSessionId: null,
  videoId: null,
  serverAddress: null,
  viewerBalance: "0",
  serverBalance: "0",
  segmentsDelivered: 0,
  version: 0,
  ephemeralAddress: null,
  pricePerSegment: config.yellowPricePerSegment,
  totalDeposited: "0",
  closeStateHash: null,
  channelId: null,
  segmentsVerified: 0,
};

// ─── Hook ────────────────────────────────────────────────────────────

export function useYellowSession() {
  const [status, setStatus] = useState<YellowSessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<YellowSessionState>(initialState);
  const [settlementResult, setSettlementResult] = useState<SessionCloseResult | null>(null);

  const clientRef = useRef<YellowBrowserClient | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Mutex queue — serialize concurrent key requests so version increments by 1
  const keyQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Track paid segments to prevent double-counting during seek
  const paidSegmentsRef = useRef<Set<number>>(new Set());

  /**
   * Connect to ClearNode, authenticate, and create a streaming session.
   */
  const startYellowSession = useCallback(
    async (videoId: string, depositAmount: string) => {
      setStatus("connecting");
      setError(null);

      try {
        // 1. Connect to ClearNode with ephemeral key
        const client = await connectToClearNode();
        clientRef.current = client;
        setStatus("authenticated");

        // 2. Request faucet tokens (sandbox only, best-effort)
        await requestFaucetTokens(client.ephemeralAddress).catch(() => {});

        // 3. Create session on backend (backend creates real ClearNode app session)
        const res = await fetch(
          `${config.apiBaseUrl}/api/videos/${videoId}/session`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              viewerAddress: client.ephemeralAddress,
              depositAmount,
            }),
          }
        );

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Session creation failed ${res.status}: ${body}`);
        }

        const data = await res.json();

        const newState: YellowSessionState = {
          appSessionId: data.appSessionId,
          videoId,
          serverAddress: data.serverAddress,
          viewerBalance: data.viewerBalance || depositAmount,
          serverBalance: "0",
          segmentsDelivered: 0,
          version: 0,
          ephemeralAddress: client.ephemeralAddress,
          pricePerSegment: data.pricePerSegment || config.yellowPricePerSegment,
          totalDeposited: data.totalDeposited || depositAmount,
          closeStateHash: null,
          channelId: null,
          segmentsVerified: 0,
        };

        setState(newState);
        stateRef.current = newState;
        setStatus("session_active");

        // Co-sign the Custody channel state if server prepared one
        if (data.custodyChannelData?.packedStateHex) {
          try {
            const signature = await signChannelState(
              data.custodyChannelData.packedStateHex,
              client.ephemeralPrivateKey,
            );

            const custodyRes = await fetch(
              `${config.apiBaseUrl}/api/videos/${videoId}/session/${data.appSessionId}/custody-sign`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ signature }),
              }
            );

            if (custodyRes.ok) {
              const custodyResult = await custodyRes.json();
              const updated = {
                ...stateRef.current,
                closeStateHash: custodyResult.closeStateHash || stateRef.current.closeStateHash,
                channelId: custodyResult.channelId || null,
              };
              setState(updated);
              stateRef.current = updated;
            } else {
              console.warn(`[Yellow] Custody sign failed: ${custodyRes.status}`);
            }
          } catch (custodyErr) {
            // Non-fatal — streaming still works via ClearNode
            console.warn("[Yellow] Custody signing failed (non-fatal):", custodyErr);
          }
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to start Yellow session"
        );
        setStatus("error");
        if (clientRef.current) {
          disconnectClearNode(clientRef.current);
          clientRef.current = null;
        }
      }
    },
    []
  );

  /**
   * Sign a state update for a segment and POST to /cosign to get the AES key.
   *
   * Serialized via mutex queue so that version increments by exactly 1
   * even if HLS.js requests multiple keys concurrently (e.g. during seek).
   */
  const signAndRequestKey = useCallback(
    (videoId: string, segmentIndex: number): Promise<ArrayBuffer> => {
      const keyPromise = keyQueueRef.current.then(async () => {
        const current = stateRef.current;
        const client = clientRef.current;

        if (!current.appSessionId || !client) {
          throw new Error("No active Yellow session");
        }

        const price = parseFloat(current.pricePerSegment);
        const currentBalance = parseFloat(current.viewerBalance);

        if (currentBalance < price) {
          setStatus("insufficient_balance");
          throw new Error("402: Insufficient balance");
        }

        // Compute new allocations
        const newVersion = current.version + 1;
        const newViewerBalance = (currentBalance - price).toFixed(6);
        const newServerBalance = (
          parseFloat(current.serverBalance) + price
        ).toFixed(6);

        // Build state update message (NitroLite RPC format)
        const request = [
          Date.now(),
          "submit_app_state",
          {
            app_session_id: current.appSessionId,
            intent: "operate",
            version: newVersion,
            allocations: [
              {
                participant: current.ephemeralAddress,
                asset: config.yellowAsset,
                amount: newViewerBalance,
              },
              {
                participant: current.serverAddress,
                asset: config.yellowAsset,
                amount: newServerBalance,
              },
            ],
          },
          Date.now(),
        ];

        // Sign with session signer (ephemeral key)
        const signature = await client.sessionSigner(request as RPCData);

        const signedMessage = JSON.stringify({
          req: request,
          sig: [signature],
        });

        // POST to cosign endpoint — returns AES key + optional merkle proof
        const { keyBuffer, merkleProof } = await cosignAndGetKey(videoId, {
          appSessionId: current.appSessionId,
          segmentIndex,
          version: newVersion,
          signedMessage,
        });

        // Verify merkle proof if available
        let verified = false;
        if (merkleProof) {
          try {
            const keyBytes = new Uint8Array(keyBuffer);
            verified = verifySegmentProof(keyBytes, merkleProof);
            if (!verified) {
              console.warn(`[Yellow] Merkle proof failed for segment ${segmentIndex}`);
            }
          } catch (err) {
            console.warn("[Yellow] Merkle verify error:", err);
          }
        }

        // Update local state after successful cosign
        const alreadyPaid = paidSegmentsRef.current.has(segmentIndex);
        const updatedState: YellowSessionState = {
          ...stateRef.current,
          viewerBalance: newViewerBalance,
          serverBalance: newServerBalance,
          version: newVersion,
          segmentsDelivered: alreadyPaid
            ? stateRef.current.segmentsDelivered
            : stateRef.current.segmentsDelivered + 1,
          segmentsVerified: verified
            ? stateRef.current.segmentsVerified + 1
            : stateRef.current.segmentsVerified,
        };
        if (!alreadyPaid) {
          paidSegmentsRef.current.add(segmentIndex);
        }
        setState(updatedState);
        stateRef.current = updatedState;

        return keyBuffer;
      });

      // Chain the queue — errors don't block subsequent requests
      keyQueueRef.current = keyPromise.then(
        () => {},
        () => {}
      );

      return keyPromise;
    },
    []
  );

  /**
   * Close the session and disconnect from ClearNode.
   */
  const closeYellowSession = useCallback(async (videoId: string) => {
    setStatus("closing");
    const current = stateRef.current;

    // Close via backend API and capture settlement result
    if (current.appSessionId) {
      try {
        // Sign the close state if we have a custody channel
        let closeSignature: string | undefined;
        if (current.closeStateHash && clientRef.current) {
          try {
            closeSignature = await signChannelState(
              current.closeStateHash as `0x${string}`,
              clientRef.current.ephemeralPrivateKey,
            );
          } catch (signErr) {
            console.warn("[Yellow] Close state sign failed:", signErr);
          }
        }

        const res = await fetch(
          `${config.apiBaseUrl}/api/videos/${videoId}/session/${current.appSessionId}/close`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ closeSignature }),
          }
        );
        if (res.ok) {
          const closeResult: SessionCloseResult = await res.json();
          setSettlementResult(closeResult);
        }
      } catch {
        // Best-effort close
      }
    }

    // Disconnect from ClearNode
    if (clientRef.current) {
      disconnectClearNode(clientRef.current);
      clientRef.current = null;
    }

    paidSegmentsRef.current.clear();
    setState(initialState);
    stateRef.current = initialState;
    setStatus("closed");
  }, []);

  return {
    status,
    state,
    error,
    settlementResult,
    startYellowSession,
    signAndRequestKey,
    closeYellowSession,
  };
}

"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Hls from "hls.js";
import { Loader2, AlertCircle, Play, DollarSign, Clock, Film } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PaymentOverlay } from "./PaymentOverlay";
import { ClosingOverlay } from "./ClosingOverlay";
import { useVideoSession } from "@/hooks/useVideoSession";
import { useWallet } from "@/components/wallet/WalletProvider";
import { config } from "@/lib/config";
import type { VideoDetail, SessionCloseResult } from "@/lib/types";
import type { SessionState } from "@/hooks/useVideoSession";

interface VideoPlayerProps {
  video: VideoDetail;
  onSessionStateChange?: (state: SessionState, settlement: SessionCloseResult | null) => void;
}

export function VideoPlayer({ video, onSessionStateChange }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const {
    session,
    sessionState,
    sessionStatus,
    error: sessionError,
    getAuthHeader,
    startSession,
    endSession,
    markInsufficientBalance,
    signAndRequestKey,
    isYellowCosign,
    ephemeralAddress,
    settlementResult,
    segmentsVerified,
  } = useVideoSession();
  const { walletAddress, isConnected } = useWallet();
  const [playerReady, setPlayerReady] = useState(false);

  // Store refs so HLS.js loader callbacks always see latest values
  const authHeaderRef = useRef(getAuthHeader);
  useEffect(() => {
    authHeaderRef.current = getAuthHeader;
  }, [getAuthHeader]);

  const signAndRequestKeyRef = useRef(signAndRequestKey);
  useEffect(() => {
    signAndRequestKeyRef.current = signAndRequestKey;
  }, [signAndRequestKey]);

  const markInsufficientBalanceRef = useRef(markInsufficientBalance);
  useEffect(() => {
    markInsufficientBalanceRef.current = markInsufficientBalance;
  }, [markInsufficientBalance]);

  // Initialize HLS.js once we have a session
  const initializePlayer = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !video.contentUri || !session) return;

    // Already initialized — don't destroy and re-create
    // (balance updates change session/deps, but player must stay alive)
    if (hlsRef.current) return;

    if (!Hls.isSupported()) {
      // Fallback for Safari native HLS — cannot add custom headers
      videoEl.src = video.contentUri;
      setPlayerReady(true);
      return;
    }

    const hlsConfig: Record<string, any> = {
      maxBufferLength: 10,
      maxMaxBufferLength: 30,
    };

    if (isYellowCosign) {
      // ─── Custom loader for co-signed key requests ───
      // Intercepts key URL requests, performs async co-signing,
      // and returns the raw AES key from the /cosign endpoint.
      const videoId = video.id;
      const BaseLoader = Hls.DefaultConfig.loader as any;

      hlsConfig.loader = class CosignLoader extends BaseLoader {
        load(context: any, config: any, callbacks: any) {
          // Detect key requests by URL pattern
          const keyMatch = context.url?.match(/\/key\/(\d+)/);
          if (keyMatch && signAndRequestKeyRef.current) {
            const segmentIndex = parseInt(keyMatch[1], 10);
            signAndRequestKeyRef
              .current(videoId, segmentIndex)
              .then((keyBuffer: ArrayBuffer) => {
                callbacks.onSuccess(
                  { data: new Uint8Array(keyBuffer), url: context.url },
                  {
                    trequest: performance.now(),
                    tfirst: performance.now(),
                    tload: performance.now(),
                    loaded: keyBuffer.byteLength,
                    total: keyBuffer.byteLength,
                  },
                  context,
                  null
                );
              })
              .catch((err: Error) => {
                if (
                  err.message?.includes("402") ||
                  err.message?.includes("Insufficient")
                ) {
                  videoEl.pause();
                  markInsufficientBalanceRef.current();
                }
                callbacks.onError(
                  { code: 402, text: err.message || "Cosign failed" },
                  context,
                  null,
                  { trequest: performance.now(), retry: 0 }
                );
              });
            return;
          }
          // Default XHR loading for manifests, fragments, etc.
          super.load(context, config, callbacks);
        }
      };
    } else {
      // ─── Legacy: auth headers via xhrSetup ───
      hlsConfig.xhrSetup = (xhr: XMLHttpRequest, url: string) => {
        const isKeyRequest =
          url.includes("/api/videos/") && url.includes("/key/");
        if (isKeyRequest) {
          const auth = authHeaderRef.current();
          if (auth) {
            xhr.setRequestHeader(auth.name, auth.value);
          }
        }
      };
    }

    const hls = new Hls(hlsConfig);

    // Handle errors — especially 402 for insufficient balance
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.details === Hls.ErrorDetails.KEY_LOAD_ERROR) {
        const response = data.response;
        if (response && response.code === 402) {
          videoEl.pause();
          markInsufficientBalance();
          return;
        }
      }

      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            hls.destroy();
            break;
        }
      }
    });

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setPlayerReady(true);
      videoEl.play().catch(() => {
        // Autoplay may be blocked — user will click play
      });
    });

    hls.attachMedia(videoEl);
    hls.loadSource(video.contentUri);
    hlsRef.current = hls;
  }, [video.contentUri, video.id, session, isYellowCosign, markInsufficientBalance]);

  // Start session and then player
  const handleStartWatching = useCallback(async () => {
    if (isConnected && walletAddress) {
      await startSession(video.id, walletAddress, "1.00");
    } else {
      await startSession(video.id);
    }
  }, [video.id, isConnected, walletAddress, startSession]);

  // Initialize player when session becomes active
  useEffect(() => {
    if (sessionState === "active" && session) {
      initializePlayer();
    }
  }, [sessionState, session, initializePlayer]);

  // Destroy player when session ends (so "Watch Again" can re-init)
  useEffect(() => {
    if (sessionState === "closed" || sessionState === "idle" || sessionState === "error") {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
        setPlayerReady(false);
      }
    }
  }, [sessionState]);

  // Notify parent of session state changes
  useEffect(() => {
    onSessionStateChange?.(sessionState, settlementResult);
  }, [sessionState, settlementResult, onSessionStateChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-xl border bg-black">
      {/* Video element */}
      <video
        ref={videoRef}
        className="aspect-video w-full"
        controls={playerReady}
        playsInline
        poster={video.thumbnailUri ?? undefined}
      />

      {/* Pre-session state: show "Start Watching" button with pricing */}
      {sessionState === "idle" && (() => {
        const pricePerSegment = parseFloat(config.yellowPricePerSegment);
        const segmentsPerMinute = 60 / 5;
        const costPerMinute = (pricePerSegment * segmentsPerMinute).toFixed(2);
        const totalCost = video.totalSegments
          ? (video.totalSegments * pricePerSegment).toFixed(2)
          : null;

        return (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60">
            <Play className="h-12 w-12 text-white/80" />
            <Button onClick={handleStartWatching} size="lg">
              Start Watching
            </Button>

            <div className="flex flex-col items-center gap-2">
              <p className="text-xs text-muted-foreground">
                {isConnected
                  ? "Pay-per-segment streaming via Yellow Network state channel"
                  : "Connect wallet in the header for pay-per-segment micropayments"}
              </p>

              {isConnected && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  >
                    <DollarSign className="mr-1 h-3 w-3" />
                    ${config.yellowPricePerSegment}/segment
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-zinc-500/30 text-zinc-400"
                  >
                    <Clock className="mr-1 h-3 w-3" />
                    ~${costPerMinute}/min
                  </Badge>
                  {totalCost && (
                    <Badge
                      variant="outline"
                      className="border-zinc-500/30 text-zinc-400"
                    >
                      <Film className="mr-1 h-3 w-3" />
                      {video.totalSegments} segments (~${totalCost} total)
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Creating session spinner */}
      {sessionState === "creating" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
          <span className="ml-3 text-white">
            {isYellowCosign
              ? "Connecting to ClearNode..."
              : "Creating session..."}
          </span>
        </div>
      )}

      {/* Error state */}
      {sessionState === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-destructive">{sessionError}</p>
          <Button variant="outline" onClick={handleStartWatching}>
            Retry
          </Button>
        </div>
      )}

      {/* Closing state — settlement progress */}
      {sessionState === "closing" && (
        <ClosingOverlay
          hasCustodyChannel={
            !!(session && session.type === "yellow" && session.channelId)
          }
        />
      )}

      {/* Closed state — settlement summary is rendered below the player by the page */}
      {sessionState === "closed" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80">
          <p className="text-sm text-muted-foreground">Session ended</p>
          <Button onClick={handleStartWatching}>Watch Again</Button>
        </div>
      )}

      {/* Payment overlay (shown while session is active) */}
      {(sessionState === "active" ||
        sessionState === "insufficient_balance") && (
        <PaymentOverlay
          session={session}
          sessionState={sessionState}
          sessionStatus={sessionStatus}
          onClose={endSession}
          ephemeralAddress={ephemeralAddress}
          isStateChanelSession={isYellowCosign}
          segmentsVerified={segmentsVerified}
        />
      )}
    </div>
  );
}

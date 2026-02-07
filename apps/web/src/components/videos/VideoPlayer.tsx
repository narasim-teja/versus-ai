"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Hls from "hls.js";
import { Loader2, AlertCircle, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PaymentOverlay } from "./PaymentOverlay";
import { useVideoSession } from "@/hooks/useVideoSession";
import { useWallet } from "@/components/wallet/WalletProvider";
import type { VideoDetail } from "@/lib/types";

interface VideoPlayerProps {
  video: VideoDetail;
}

export function VideoPlayer({ video }: VideoPlayerProps) {
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
  } = useVideoSession();
  const { walletAddress, isConnected } = useWallet();
  const [playerReady, setPlayerReady] = useState(false);

  // Store getAuthHeader in a ref so xhrSetup always sees the latest value
  const authHeaderRef = useRef(getAuthHeader);
  useEffect(() => {
    authHeaderRef.current = getAuthHeader;
  }, [getAuthHeader]);

  // Initialize HLS.js once we have a session
  const initializePlayer = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !video.contentUri || !session) return;

    // Destroy previous instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (!Hls.isSupported()) {
      // Fallback for Safari native HLS — cannot add custom headers
      videoEl.src = video.contentUri;
      setPlayerReady(true);
      return;
    }

    const hls = new Hls({
      // Intercept XHR requests to add auth headers to key fetches
      xhrSetup: (xhr: XMLHttpRequest, url: string) => {
        const isKeyRequest =
          url.includes("/api/videos/") && url.includes("/key/");
        if (isKeyRequest) {
          const auth = authHeaderRef.current();
          if (auth) {
            xhr.setRequestHeader(auth.name, auth.value);
          }
        }
      },
      maxBufferLength: 10,
      maxMaxBufferLength: 30,
    });

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
  }, [video.contentUri, session, markInsufficientBalance]);

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
      />

      {/* Pre-session state: show "Start Watching" button */}
      {sessionState === "idle" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60">
          <Play className="h-12 w-12 text-white/80" />
          <Button onClick={handleStartWatching} size="lg">
            {isConnected
              ? "Start Watching (Yellow)"
              : "Start Watching (Legacy)"}
          </Button>
          <p className="max-w-md text-center text-xs text-muted-foreground">
            {isConnected
              ? "A micropayment session will be created via Yellow Network"
              : "Connect wallet for pay-per-segment streaming, or watch with legacy session"}
          </p>
        </div>
      )}

      {/* Creating session spinner */}
      {sessionState === "creating" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
          <span className="ml-3 text-white">Creating session...</span>
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

      {/* Closed state */}
      {sessionState === "closed" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60">
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
        />
      )}
    </div>
  );
}

/**
 * HLS playlist generation
 */

import type { EncryptedSegment } from "@versus/streaming";

/** HLS package output */
export interface HLSPackage {
  masterPlaylist: string;
  mediaPlaylists: Map<string, string>;
  segments: Map<string, Buffer>;
}

/**
 * Generate HLS package with encrypted segments
 */
export function generateHLSPackage(
  encryptedSegments: EncryptedSegment[],
  ivs: Buffer[],
  videoId: string,
  keyServerBaseUrl: string,
  segmentDuration: number = 5
): HLSPackage {
  const quality = "720p";

  const masterPlaylist = generateMasterPlaylist(quality);

  const mediaPlaylist = generateMediaPlaylist(
    encryptedSegments,
    ivs,
    videoId,
    keyServerBaseUrl,
    segmentDuration
  );

  const segments = new Map<string, Buffer>();
  for (const segment of encryptedSegments) {
    segments.set(
      `${quality}/segment_${segment.index.toString().padStart(3, "0")}.ts`,
      segment.data
    );
  }

  return {
    masterPlaylist,
    mediaPlaylists: new Map([[quality, mediaPlaylist]]),
    segments,
  };
}

function generateMasterPlaylist(quality: string): string {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:4",
    "",
    `#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720`,
    `${quality}/playlist.m3u8`,
  ];

  return lines.join("\n");
}

function generateMediaPlaylist(
  segments: EncryptedSegment[],
  ivs: Buffer[],
  videoId: string,
  keyServerBaseUrl: string,
  segmentDuration: number
): string {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:4",
    `#EXT-X-TARGETDURATION:${Math.ceil(segmentDuration)}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
  ];

  for (let i = 0; i < segments.length; i++) {
    const iv = ivs[i];
    const ivHex = iv.toString("hex");
    const keyUri = `${keyServerBaseUrl}/api/videos/${videoId}/key/${i}`;

    lines.push("");
    lines.push(`#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}",IV=0x${ivHex}`);
    lines.push(`#EXTINF:${segmentDuration.toFixed(3)},`);
    lines.push(`segment_${i.toString().padStart(3, "0")}.ts`);
  }

  lines.push("");
  lines.push("#EXT-X-ENDLIST");

  return lines.join("\n");
}

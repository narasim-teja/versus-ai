/**
 * Format a USDC balance string (6 decimals) to display value.
 * e.g. "1234560000" → "$1,234.56"
 */
export function formatUsdc(value: string): string {
  if (!value || value === "0") return "$0.00";
  const num = Number(value) / 1e6;
  return `$${num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a token price string (6 decimals) to display.
 * e.g. "54200" → "$0.0542"
 */
export function formatTokenPrice(value: string): string {
  if (!value || value === "0") return "$0.00";
  const num = Number(value) / 1e6;
  if (num < 0.01) {
    return `$${num.toFixed(6)}`;
  }
  return `$${num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

/**
 * Format a token supply (18 decimals) to compact display.
 * e.g. "1500000000000000000000000" → "1.5M"
 */
export function formatTokenSupply(value: string): string {
  if (!value || value === "0") return "0";
  const num = Number(value) / 1e18;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(2);
}

/**
 * Format health factor: 1.85 → "1.85"
 */
export function formatHealthFactor(value: number): string {
  return value.toFixed(2);
}

/**
 * Format LTV: 48 → "48%"
 */
export function formatLTV(value: number): string {
  return `${Math.round(value)}%`;
}

/**
 * Format confidence: 0.85 → "85%"
 */
export function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Format a timestamp to relative time ago string.
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 0) return "just now";

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Format a token balance (18 decimals) to readable display.
 * e.g. "1500000000000000000" → "1.50"
 */
export function formatTokenBalance(value: string): string {
  if (!value || value === "0") return "0.00";
  const num = Number(value) / 1e18;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

/**
 * Truncate an address: "0x1234...5678"
 */
export function truncateAddress(address: string, chars = 4): string {
  if (!address) return "";
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Format seconds to mm:ss or hh:mm:ss display.
 * e.g. 125 -> "2:05", 3661 -> "1:01:01"
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

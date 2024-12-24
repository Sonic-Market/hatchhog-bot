export type HatchhogTokenInfo = {
  name: string;
  symbol: string;
  description: string;
  metaUri: string;
  tokenReceiver: `0x${string}` | null;
}

export type RateLimit = {
  success: boolean;
  remainingRequests: number;
  resetTimeInMs: number;
}
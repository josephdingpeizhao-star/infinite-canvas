const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;

export function nextRetryDelayMs(attempt: number) {
    const index = Number.isFinite(attempt) ? Math.min(Math.max(0, Math.trunc(attempt)), RETRY_DELAYS_MS.length - 1) : 0;
    return RETRY_DELAYS_MS[index];
}

export function shouldKeepRetrying({ everConnected, attempt }: { everConnected: boolean; attempt: number }) {
    return everConnected || attempt < 3;
}

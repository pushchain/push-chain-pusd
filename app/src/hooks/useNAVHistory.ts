/**
 * useNAVHistory — vault NAV time-series + pre-aggregated APY windows.
 *
 * Source: `Rebalanced(timestamp, navE18)` events emitted on every keeper
 * tick. NAV is monotonic non-decreasing (I2), so the event sequence is the
 * full picture — no need for a backend store.
 *
 * Returns: ordered samples (oldest → newest) plus annualized APY over the
 * 1d / 7d / 30d trailing windows. APY uses simple compounding:
 *
 *   apy = (nav_now / nav_then) ^ (yearMs / windowMs) − 1
 *
 * If only one sample exists (or none with `windowMs` of head-room), the
 * APY for that window is `null`.
 */

import { useEffect, useState } from 'react';
import { fetchVaultLogs } from '../lib/blockscout';

const POLL_MS = 60_000;
const NAV_PRECISION = 10n ** 18n;
const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

export type NAVSample = {
  /** Epoch milliseconds (block timestamp × 1000). */
  ts: number;
  /** 1e18 fixed-point. */
  navE18: bigint;
  /** Friendly number (e.g. 1.000312). */
  pusdPerPlus: number;
};

export type NAVHistoryState = {
  loading: boolean;
  error: Error | null;
  unconfigured: boolean;
  samples: NAVSample[];
  apy1d: number | null;
  apy7d: number | null;
  apy30d: number | null;
  updatedAt: number;
};

function compute(samples: NAVSample[], windowMs: number): number | null {
  if (samples.length < 2) return null;
  const head = samples[samples.length - 1];
  const target = head.ts - windowMs;
  // Find the oldest sample at or after `target` (smallest >= target).
  // If none, the window doesn't fit — return null.
  const fits = samples.filter((s) => s.ts >= target);
  if (fits.length < 2) return null;
  const tail = fits[0];
  if (tail.navE18 === 0n || tail.ts === head.ts) return null;
  const elapsed = head.ts - tail.ts;
  if (elapsed <= 0) return null;
  const ratio =
    Number((head.navE18 * 1_000_000n) / tail.navE18) / 1_000_000;
  if (ratio <= 0) return null;
  return Math.pow(ratio, MS_PER_YEAR / elapsed) - 1;
}

export function useNAVHistory(): NAVHistoryState {
  const [state, setState] = useState<NAVHistoryState>({
    loading: true,
    error: null,
    unconfigured: false,
    samples: [],
    apy1d: null,
    apy7d: null,
    apy30d: null,
    updatedAt: 0,
  });

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const logs = await fetchVaultLogs({ maxPages: 5 });
        if (cancelled) return;
        const rebalances = logs
          .filter((l) => l.event.type === 'REBALANCED')
          .map((l) => ({
            // Prefer the on-chain emitted timestamp (1st arg) which equals
            // block.timestamp at emission. Falls back to log.timestamp.
            ts: Number((l.event as { timestamp: bigint }).timestamp) * 1000 || l.timestamp * 1000,
            navE18: (l.event as { navE18: bigint }).navE18,
          }))
          .filter((s) => s.ts > 0)
          .sort((a, b) => a.ts - b.ts);

        const samples: NAVSample[] = rebalances.map((r) => ({
          ts: r.ts,
          navE18: r.navE18,
          pusdPerPlus: Number(r.navE18 / 10n ** 12n) / 1e6,
        }));

        setState({
          loading: false,
          error: null,
          unconfigured: false,
          samples,
          apy1d: compute(samples, 24 * 60 * 60 * 1000),
          apy7d: compute(samples, 7 * 24 * 60 * 60 * 1000),
          apy30d: compute(samples, 30 * 24 * 60 * 60 * 1000),
          updatedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        // unconfigured (no PUSD_PLUS address) returns [] silently from
        // fetchVaultLogs — only reach here on real failures.
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to read NAV history'),
        }));
      }
    };
    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return state;
}

// Re-export for tests/components that want raw NAV math.
export const NAV_PRECISION_E18 = NAV_PRECISION;

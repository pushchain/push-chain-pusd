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

// Synthetic NAV=1.0 baseline at v2 cut-over (2026-05-05 12:00 UTC). Prepended
// to the first real rebalance sample so the chart shows the upward line from
// genesis instead of starting mid-flight. Skipped if any real sample is older
// than this timestamp (defensive against future re-deploys).
const GENESIS_TS = Date.UTC(2026, 4, 5, 12, 0, 0);
const GENESIS_NAV_E18 = NAV_PRECISION;

export type NAVSample = {
  /** Epoch milliseconds (block timestamp × 1000). */
  ts: number;
  /** 1e18 fixed-point. */
  navE18: bigint;
  /** Friendly number (e.g. 1.000312). */
  pusdPerPlus: number;
  /** True for the synthetic genesis baseline; excluded from APY math. */
  synthetic?: boolean;
};

/**
 * APY measurement. When the dataset has at least two real samples that fit
 * the window, returns the standard annualized rate. When only one real
 * sample exists (typical right after the v2 cut-over), falls back to the
 * realized return against the synthetic genesis — labelled `bootstrap` so
 * the UI can disclose that this is not yet an annualized headline number.
 */
export type ApyResult = {
  rate: number | null;
  bootstrap: boolean;
};

export type NAVHistoryState = {
  loading: boolean;
  error: Error | null;
  unconfigured: boolean;
  samples: NAVSample[];
  apy1d: ApyResult;
  apy7d: ApyResult;
  apy30d: ApyResult;
  updatedAt: number;
};

const NULL_APY: ApyResult = { rate: null, bootstrap: false };

function ratio(head: NAVSample, tail: NAVSample): number | null {
  if (tail.navE18 === 0n || tail.ts === head.ts) return null;
  const r = Number((head.navE18 * 1_000_000n) / tail.navE18) / 1_000_000;
  return r > 0 ? r : null;
}

function compute(samples: NAVSample[], windowMs: number): ApyResult {
  const real = samples.filter((s) => !s.synthetic);

  // Standard path — annualize between two real samples in the window.
  if (real.length >= 2) {
    const head = real[real.length - 1];
    const target = head.ts - windowMs;
    const fits = real.filter((s) => s.ts >= target);
    if (fits.length >= 2) {
      const tail = fits[0];
      const r = ratio(head, tail);
      if (!r) return NULL_APY;
      const elapsed = head.ts - tail.ts;
      if (elapsed <= 0) return NULL_APY;
      return { rate: Math.pow(r, MS_PER_YEAR / elapsed) - 1, bootstrap: false };
    }
  }

  // Bootstrap path — only one real sample so far. Show realized return from
  // the genesis baseline rather than annualizing (a single rebalance shouldn't
  // extrapolate to an absurd headline rate).
  if (real.length >= 1 && samples[0]?.synthetic) {
    const head = real[real.length - 1];
    const tail = samples[0];
    const r = ratio(head, tail);
    if (!r) return NULL_APY;
    return { rate: r - 1, bootstrap: true };
  }

  return NULL_APY;
}

export function useNAVHistory(): NAVHistoryState {
  const [state, setState] = useState<NAVHistoryState>({
    loading: true,
    error: null,
    unconfigured: false,
    samples: [],
    apy1d: NULL_APY,
    apy7d: NULL_APY,
    apy30d: NULL_APY,
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

        // Prepend genesis NAV=1.0 baseline so the chart always anchors at the
        // v2 cut-over even if no rebalance has been emitted yet. Skipped only
        // if a real sample is older than the baseline (defensive against re-
        // deploys that pre-date this constant).
        if (samples.length === 0 || samples[0].ts > GENESIS_TS) {
          samples.unshift({
            ts: GENESIS_TS,
            navE18: GENESIS_NAV_E18,
            pusdPerPlus: 1,
            synthetic: true,
          });
        }

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

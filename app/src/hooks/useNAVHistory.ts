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

import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { PUSD_PLUS_ADDRESS } from '../contracts/config';
import { fetchVaultLogs } from '../lib/blockscout';
import { REBALANCED_TOPIC } from '../lib/events';
import { getReadProvider } from '../lib/provider';

const POLL_MS = 60_000;
const NAV_PRECISION = 10n ** 18n;
const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;
const NAV_ABI = ['function nav() view returns (uint256)'];

/**
 * Live on-chain NAV read straight from the vault over RPC — deliberately
 * independent of the Blockscout event index. Returns null when unconfigured
 * or on RPC error (callers fall back to the event-derived samples).
 */
async function readLiveNav(): Promise<bigint | null> {
  if (!PUSD_PLUS_ADDRESS) return null;
  try {
    const vault = new ethers.Contract(PUSD_PLUS_ADDRESS, NAV_ABI, getReadProvider());
    return (await vault.nav()) as bigint;
  } catch {
    return null;
  }
}

// Donut RPC caps eth_getLogs at 10k blocks/call ("maximum [from, to] blocks
// distance: 10000"), so the backfill walks the gap in 10k chunks and is
// hard-capped so even a multi-thousand-block gap can't fan out into unbounded
// requests.
const RPC_LOG_RANGE = 10_000;
const MAX_BACKFILL_CHUNKS = 6; // ≤6 RPC calls ≈ 60k most-recent blocks

type RebalanceEntry = { ts: number; navE18: bigint; blockNumber: number; key: string };

/**
 * RPC fallback: read Rebalanced(uint256,uint256) events for the vault directly
 * from the chain over `(afterBlock, head]`, newest → oldest in 10k-block
 * chunks. Invoked only when Blockscout's index is behind (see the staleness
 * check in the hook). The newest rebalances — the ones a user just made — come
 * back first; any tail beyond the chunk cap fills in once Blockscout catches
 * up. Errors degrade gracefully: we keep whatever earlier chunks returned.
 */
async function backfillRebalancesViaRpc(afterBlock: number): Promise<RebalanceEntry[]> {
  if (!PUSD_PLUS_ADDRESS) return [];
  const provider = getReadProvider();
  let head: number;
  try {
    head = await provider.getBlockNumber();
  } catch {
    return [];
  }
  const lowerBound = Math.max(0, afterBlock + 1, head - RPC_LOG_RANGE * MAX_BACKFILL_CHUNKS + 1);

  // Pre-compute the ≤MAX_BACKFILL_CHUNKS 10k-block windows covering
  // (lowerBound..head], then fetch them in parallel — bounded count, read-only,
  // so total latency is ~one round-trip instead of N. A failed chunk yields []
  // rather than failing the whole backfill or truncating later chunks.
  const ranges: Array<{ from: number; to: number }> = [];
  for (let to = head; to >= lowerBound && ranges.length < MAX_BACKFILL_CHUNKS; ) {
    const from = Math.max(lowerBound, to - RPC_LOG_RANGE + 1);
    ranges.push({ from, to });
    to = from - 1;
  }

  const chunks = await Promise.all(
    ranges.map(({ from, to }) =>
      provider
        .getLogs({ address: PUSD_PLUS_ADDRESS!, topics: [REBALANCED_TOPIC], fromBlock: from, toBlock: to })
        .catch(() => [] as ethers.Log[]),
    ),
  );

  const out: RebalanceEntry[] = [];
  for (const logs of chunks) {
    for (const l of logs) {
      // data = abi.encode(uint256 timestamp, uint256 navE18) — two 32B words.
      const timestamp = BigInt('0x' + l.data.slice(2, 66));
      const navE18 = BigInt('0x' + l.data.slice(66, 130));
      out.push({
        ts: Number(timestamp) * 1000,
        navE18,
        blockNumber: l.blockNumber,
        key: `${l.transactionHash.toLowerCase()}:${l.index}`,
      });
    }
  }
  return out;
}

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
  /** True for the live RPC-read head point appended when the event feed lags. */
  live?: boolean;
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

// Module-level cache for the (slow) RPC backfill so the eth_getLogs scan doesn't
// repeat on every 60s poll while Blockscout's index stays behind. Survives
// component remounts (e.g. navigating away and back).
const BACKFILL_TTL_MS = 5 * 60 * 1000;
let backfillCache: { rebalances: RebalanceEntry[]; at: number } | null = null;

/** Merge two rebalance sets, de-duped by their txHash:logIndex key. */
function mergeRebalances(base: RebalanceEntry[], extra: RebalanceEntry[]): RebalanceEntry[] {
  if (extra.length === 0) return base;
  const seen = new Set(base.map((r) => r.key));
  return [...base, ...extra.filter((r) => !seen.has(r.key))];
}

/**
 * Pure: turn a set of rebalance entries + the live NAV into the full hook
 * state — sorted samples, the genesis baseline, the live-NAV head anchor, and
 * the three APY windows. Shared by the fast first paint and the post-backfill
 * repaint so both produce identical shape.
 */
function buildHistoryState(rebalances: RebalanceEntry[], liveNavE18: bigint | null): NAVHistoryState {
  const samples: NAVSample[] = [...rebalances]
    .sort((a, b) => a.ts - b.ts)
    .map((r) => ({ ts: r.ts, navE18: r.navE18, pusdPerPlus: Number(r.navE18 / 10n ** 12n) / 1e6 }));

  // Prepend the genesis NAV=1.0 baseline so the chart always anchors at the v2
  // cut-over even if no rebalance has surfaced yet.
  if (samples.length === 0 || samples[0].ts > GENESIS_TS) {
    samples.unshift({ ts: GENESIS_TS, navE18: GENESIS_NAV_E18, pusdPerPlus: 1, synthetic: true });
  }

  // Anchor the head to the LIVE on-chain NAV so the chart reflects rebalances
  // even when the event feed is missing the most recent ones. NAV is monotonic,
  // so append a "now" point only when live exceeds the newest sample; when the
  // feed is current the values match and nothing is added.
  if (liveNavE18 != null) {
    const last = samples[samples.length - 1];
    if (!last || liveNavE18 > last.navE18) {
      samples.push({
        ts: Math.max(Date.now(), last ? last.ts + 1 : GENESIS_TS + 1),
        navE18: liveNavE18,
        pusdPerPlus: Number(liveNavE18 / 10n ** 12n) / 1e6,
        live: true,
      });
    }
  }

  return {
    loading: false,
    error: null,
    unconfigured: false,
    samples,
    apy1d: compute(samples, 24 * 60 * 60 * 1000),
    apy7d: compute(samples, 7 * 24 * 60 * 60 * 1000),
    apy30d: compute(samples, 30 * 24 * 60 * 60 * 1000),
    updatedAt: Date.now(),
  };
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
        const [logs, liveNavE18] = await Promise.all([
          fetchVaultLogs({ maxPages: 5 }),
          readLiveNav(),
        ]);
        if (cancelled) return;
        // Rebalanced events from Blockscout, each carrying a stable dedup key
        // (txHash:logIndex) + block so we can merge an RPC backfill without
        // double-counting.
        const bsRebalances: RebalanceEntry[] = logs
          .filter((l) => l.event.type === 'REBALANCED')
          .map((l) => ({
            // Prefer the on-chain emitted timestamp (1st arg) which equals
            // block.timestamp at emission. Falls back to log.timestamp.
            ts: Number((l.event as { timestamp: bigint }).timestamp) * 1000 || l.timestamp * 1000,
            navE18: (l.event as { navE18: bigint }).navE18,
            blockNumber: l.log.block_number,
            key: `${l.log.transaction_hash.toLowerCase()}:${l.log.index}`,
          }))
          .filter((s) => s.ts > 0);

        // First paint — Blockscout events + any previously cached RPC backfill,
        // anchored by the live-NAV head. Fast (Blockscout pages ~1-2s); the live
        // head alone already makes the chart reflect rebalances the feed missed.
        const firstPaint = mergeRebalances(bsRebalances, backfillCache?.rebalances ?? []);
        setState(buildHistoryState(firstPaint, liveNavE18));

        // Staleness oracle. NAV is monotonic non-decreasing, so if the live
        // on-chain NAV sits above the newest NAV Blockscout reports (or above
        // genesis when it reports none), Blockscout is missing recent Rebalanced
        // events. When the index is current the live value matches → skip RPC.
        const bsMaxNav = bsRebalances.reduce((m, r) => (r.navE18 > m ? r.navE18 : m), 0n);
        const bsMaxBlock = bsRebalances.reduce((m, r) => (r.blockNumber > m ? r.blockNumber : m), 0);
        const blockscoutStale =
          liveNavE18 != null &&
          liveNavE18 > (bsMaxNav > GENESIS_NAV_E18 ? bsMaxNav : GENESIS_NAV_E18);

        // Background RPC gap-fill. eth_getLogs is slow on Donut (~8s per 10k
        // blocks), so we never block the first paint on it, and cache the result
        // (TTL) so the scan doesn't repeat every poll while the index stays
        // behind. Recovers the discrete rebalance points (with their real
        // on-chain timestamps) and repaints once they arrive.
        const cacheExpired = !backfillCache || Date.now() - backfillCache.at > BACKFILL_TTL_MS;
        if (blockscoutStale && cacheExpired) {
          const rpc = await backfillRebalancesViaRpc(bsMaxBlock);
          if (cancelled) return;
          backfillCache = { rebalances: rpc, at: Date.now() };
          setState(buildHistoryState(mergeRebalances(bsRebalances, rpc), liveNavE18));
        }
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

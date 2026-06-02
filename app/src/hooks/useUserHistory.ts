/**
 * useUserHistory — connected account's Deposited / Redeemed / PUSD+ events.
 *
 * Reads from Blockscout (no block-range cap) and filters to logs where the
 * account is `user` (topic1) or `recipient` (topic3). When Blockscout's
 * address-logs index lags the chain head (it has gapped tens of thousands of
 * blocks on Donut), it falls back to a bounded, cached RPC scan of the gap so
 * recent activity still shows. Mirrors useNAVHistory's resilience pattern:
 *
 *   1. Fast first paint from Blockscout (+ any cached RPC backfill).
 *   2. If the index is stale, a background RPC gap-fill repaints with the
 *      missing events. eth_getLogs is slow on Donut (~9s/10k blocks), so the
 *      scan is capped and cached (TTL) instead of run every poll.
 *
 * Re-polls on a 30s cadence.
 */

import { usePushChainClient } from '@pushchain/ui-kit';
import { useEffect, useState } from 'react';
import { TOKENS, tokenByAddress, type ReserveToken } from '../contracts/tokens';
import { PUSD_ADDRESS } from '../contracts/config';
import {
  fetchManagerIndexHead,
  fetchManagerLogs,
  fetchManagerLogsViaRpc,
  getChainHead,
  type FetchedLog,
} from '../lib/blockscout';

const POLL_MS = 30_000;
// If Blockscout's manager-log index trails the chain head by more than this,
// treat it as stale and backfill the gap from RPC. The manager is busy, so a
// healthy index sits within a handful of blocks of head; the gaps observed are
// tens of thousands of blocks.
const STALE_THRESHOLD_BLOCKS = 1_000;
// Don't repeat the slow RPC scan more often than this while the index stays behind.
const BACKFILL_TTL_MS = 5 * 60 * 1000;

export type HistoryRow = {
  type: 'MINT' | 'REDEEM' | 'MINT_PLUS' | 'REDEEM_PLUS';
  timestamp: number;              // epoch seconds
  pusdAmount: bigint;             // PUSD/PUSD+ amount minted or burned
  tokenAmount: bigint;            // reserve-token amount (0 for PUSD+ wrap path)
  asset: Pick<ReserveToken, 'symbol' | 'chain' | 'chainLabel' | 'chainShort' | 'address' | 'decimals'> | {
    symbol: string;
    chain: string;
    chainLabel: string;
    chainShort: string;
    address: `0x${string}`;
    decimals: number;
  };
  counterparty: `0x${string}`;   // recipient on MINT-side, user on REDEEM-side
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
};

export type UserHistoryState = {
  rows: HistoryRow[];
  loading: boolean;
  error: Error | null;
  updatedAt: number;
};

// Module-level backfill cache (per account) — survives remounts so navigating
// away and back doesn't re-run the slow scan.
let backfillCache: { account: string; logs: FetchedLog[]; at: number } | null = null;

function unknownAssetFromAddress(address: `0x${string}`): HistoryRow['asset'] {
  // The wrap path of depositToPlus uses PUSD itself as tokenIn — it's not a
  // reserve token but it's not "unknown" either. Surface it as PUSD so the
  // UI doesn't render `UNK · UNK`.
  if (address.toLowerCase() === PUSD_ADDRESS.toLowerCase()) {
    return {
      symbol: 'PUSD',
      chain: 'PUSH_DONUT',
      chainLabel: 'Push Chain Donut Testnet',
      chainShort: 'PUSH DONUT',
      address,
      decimals: 6,
    };
  }
  return {
    symbol: 'UNK',
    chain: 'UNKNOWN',
    chainLabel: 'UNKNOWN',
    chainShort: 'UNK',
    address,
    decimals: 6,
  };
}

/** Stable de-dupe key for a fetched log. */
const logKey = (l: FetchedLog) => `${l.log.transaction_hash.toLowerCase()}:${l.log.index}`;

/** Merge two fetched-log sets, de-duped by txHash:logIndex. */
function dedupeMerge(base: FetchedLog[], extra: FetchedLog[]): FetchedLog[] {
  if (extra.length === 0) return base;
  const seen = new Set(base.map(logKey));
  return [...base, ...extra.filter((l) => !seen.has(logKey(l)))];
}

/** Map fetched manager logs into display rows, newest first. */
function toRows(items: FetchedLog[]): HistoryRow[] {
  const resolveAsset = (addr: `0x${string}`) =>
    (TOKENS.find((t) => t.address.toLowerCase() === addr.toLowerCase()) ?? tokenByAddress(addr)) ??
    unknownAssetFromAddress(addr);

  const rows: HistoryRow[] = items.map(({ event, timestamp }) => {
    if (event.type === 'MINT') {
      return {
        type: 'MINT' as const,
        timestamp,
        pusdAmount: event.pusdMinted,
        tokenAmount: event.tokenAmount,
        asset: resolveAsset(event.token),
        counterparty: event.recipient,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        logIndex: event.logIndex,
      };
    }
    if (event.type === 'REDEEM') {
      return {
        type: 'REDEEM' as const,
        timestamp,
        pusdAmount: event.pusdBurned,
        tokenAmount: event.tokenAmount,
        asset: resolveAsset(event.token),
        counterparty: event.user,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        logIndex: event.logIndex,
      };
    }
    if (event.type === 'MINT_PLUS') {
      return {
        type: 'MINT_PLUS' as const,
        timestamp,
        pusdAmount: event.plusOut,
        tokenAmount: event.amountIn,
        asset: resolveAsset(event.tokenIn),
        counterparty: event.recipient,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        logIndex: event.logIndex,
      };
    }
    // REDEEM_PLUS
    return {
      type: 'REDEEM_PLUS' as const,
      timestamp,
      pusdAmount: event.plusIn,
      tokenAmount: 0n,
      asset: resolveAsset(event.preferredAsset),
      counterparty: event.user,
      txHash: event.txHash,
      blockNumber: event.blockNumber,
      logIndex: event.logIndex,
    };
  });

  rows.sort((a, b) => {
    if (a.blockNumber === b.blockNumber) return b.logIndex - a.logIndex;
    return b.blockNumber > a.blockNumber ? 1 : -1;
  });
  return rows;
}

export function useUserHistory(): UserHistoryState {
  const { pushChainClient } = usePushChainClient();
  const account = (pushChainClient?.universal?.account ?? null) as `0x${string}` | null;

  const [state, setState] = useState<UserHistoryState>({
    rows: [],
    loading: false,
    error: null,
    updatedAt: 0,
  });

  useEffect(() => {
    if (!account) {
      setState({ rows: [], loading: false, error: null, updatedAt: 0 });
      return;
    }

    let cancelled = false;

    const read = async () => {
      setState((prev) => ({ ...prev, loading: prev.rows.length === 0 }));
      try {
        const [items, bsHead, chainHead] = await Promise.all([
          fetchManagerLogs({ account, maxPages: 5 }),
          fetchManagerIndexHead(),
          getChainHead(),
        ]);
        if (cancelled) return;

        // First paint — Blockscout events + any cached RPC backfill for this
        // account. Fast, and covers the common (healthy-index) case fully.
        const cached = backfillCache?.account === account ? backfillCache.logs : [];
        const firstMerged = dedupeMerge(items, cached);
        setState({ rows: toRows(firstMerged), loading: false, error: null, updatedAt: Date.now() });

        // Staleness: Blockscout's manager-log index trailing the chain head.
        const stale =
          bsHead != null && chainHead != null && chainHead - bsHead > STALE_THRESHOLD_BLOCKS;
        const cacheFresh =
          backfillCache?.account === account && Date.now() - backfillCache.at <= BACKFILL_TTL_MS;

        // Background RPC gap-fill — only the range after Blockscout's index head
        // needs scanning (dedupe handles overlap). Cached so the slow scan
        // doesn't repeat every poll while the index stays behind.
        if (stale && !cacheFresh) {
          const afterBlock = bsHead ?? 0;
          const rpc = await fetchManagerLogsViaRpc({ account, afterBlock });
          if (cancelled) return;
          backfillCache = { account, logs: rpc, at: Date.now() };
          const merged = dedupeMerge(items, rpc);
          if (merged.length > firstMerged.length) {
            setState({ rows: toRows(merged), loading: false, error: null, updatedAt: Date.now() });
          }
        }
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to load history'),
        }));
      }
    };

    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [account]);

  return state;
}

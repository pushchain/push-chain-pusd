/**
 * useUserHistory — connected account's Deposited / Redeemed / PUSD+ events.
 *
 * Sourced from Blockscout's PER-ADDRESS token-transfers index, not the global
 * PUSDManager log stream. The manager emits hundreds of events per 1k blocks,
 * so a newest-first scan of its logs only reaches back a few hundred blocks
 * within any sane page budget — any user whose last mint/redeem is older than
 * that fell off the feed entirely (the bug this replaces). Every mint/redeem
 * moves PUSD or PUSD+ to or from the user, so paging the user's PUSD + PUSD+
 * transfers surfaces every relevant tx at any age; each tx's manager events are
 * then read from its receipt. See lib/blockscout.ts → fetchUserManagerEvents.
 *
 * Re-polls on a 30s cadence. Resolved per-tx receipts are cached (mined logs are
 * immutable), so steady-state polls only fetch receipts for newly-appeared txs.
 */

import { usePushChainClient } from '@pushchain/ui-kit';
import { useEffect, useState } from 'react';
import { TOKENS, tokenByAddress, type ReserveToken } from '../contracts/tokens';
import { PUSD_ADDRESS } from '../contracts/config';
import { fetchUserManagerEvents, type FetchedLog } from '../lib/blockscout';

const POLL_MS = 30_000;

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
        const items = await fetchUserManagerEvents({ account });
        if (cancelled) return;
        setState({ rows: toRows(items), loading: false, error: null, updatedAt: Date.now() });
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

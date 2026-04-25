/**
 * useUserHistory — connected account's Deposited + Redeemed events.
 *
 * Fetches from Blockscout API (no block-range cap) and filters logs where
 * the connected account appears as either `user` (topic1) or `recipient`
 * (topic3). Deduplication is implicit since Blockscout returns each log once.
 *
 * Re-polls on a 30s cadence; full history available from block 0.
 */

import { usePushChainClient } from '@pushchain/ui-kit';
import { useEffect, useState } from 'react';
import { TOKENS, tokenByAddress, type ReserveToken } from '../contracts/tokens';
import { fetchManagerLogs } from '../lib/blockscout';

const POLL_MS = 30_000;

export type HistoryRow = {
  type: 'MINT' | 'REDEEM';
  timestamp: number;              // epoch seconds
  pusdAmount: bigint;             // positive on MINT, negative on REDEEM (for display)
  tokenAmount: bigint;            // native token amount (positive on both)
  asset: Pick<ReserveToken, 'symbol' | 'chain' | 'chainLabel' | 'chainShort' | 'address' | 'decimals'> | {
    symbol: string;
    chain: string;
    chainLabel: string;
    chainShort: string;
    address: `0x${string}`;
    decimals: number;
  };
  counterparty: `0x${string}`;   // recipient on MINT, user on REDEEM
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
  return {
    symbol: 'UNK',
    chain: 'UNKNOWN',
    chainLabel: 'UNKNOWN',
    chainShort: 'UNK',
    address,
    decimals: 6,
  };
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
        const items = await fetchManagerLogs({ account, maxPages: 5 });
        if (cancelled) return;

        const rows: HistoryRow[] = items.map(({ event, timestamp }) => {
          const asset =
            (TOKENS.find((t) => t.address.toLowerCase() === event.token.toLowerCase())
              ?? tokenByAddress(event.token))
              ?? unknownAssetFromAddress(event.token);

          if (event.type === 'MINT') {
            return {
              type: 'MINT' as const,
              timestamp,
              pusdAmount: event.pusdMinted,
              tokenAmount: event.tokenAmount,
              asset,
              counterparty: event.recipient,
              txHash: event.txHash,
              blockNumber: event.blockNumber,
              logIndex: event.logIndex,
            };
          }
          return {
            type: 'REDEEM' as const,
            timestamp,
            pusdAmount: event.pusdBurned,
            tokenAmount: event.tokenAmount,
            asset,
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

        setState({ rows, loading: false, error: null, updatedAt: Date.now() });
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

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
import { PUSD_ADDRESS } from '../contracts/config';
import { fetchManagerLogs } from '../lib/blockscout';

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

        const resolveAsset = (addr: `0x${string}`) =>
          (TOKENS.find((t) => t.address.toLowerCase() === addr.toLowerCase())
            ?? tokenByAddress(addr))
            ?? unknownAssetFromAddress(addr);

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

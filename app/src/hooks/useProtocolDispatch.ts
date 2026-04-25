/**
 * useProtocolDispatch — global recent Mint/Redeem activity (not user-scoped).
 *
 * Powers the "Dispatch · the day so far" section on the home page.
 * Fetches events from the Blockscout API — no block-range cap, full history.
 *
 * Cap the visible list at `limit` (default 8 — mockup shows 2×4 grid) so
 * we don't flood the DOM on active days.
 */

import { useEffect, useState } from 'react';
import { TOKENS, tokenByAddress, type ReserveToken } from '../contracts/tokens';
import { fetchManagerLogs } from '../lib/blockscout';

const POLL_MS = 30_000;

export type DispatchRow = {
  type: 'MINT' | 'REDEEM';
  timestamp: number;
  pusdAmount: bigint;
  tokenAmount: bigint;
  asset: Pick<ReserveToken, 'symbol' | 'chain' | 'chainLabel' | 'chainShort' | 'address' | 'decimals'> | {
    symbol: string;
    chain: string;
    chainLabel: string;
    chainShort: string;
    address: `0x${string}`;
    decimals: number;
  };
  user: `0x${string}`;
  recipient: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
};

export type DispatchState = {
  rows: DispatchRow[];
  loading: boolean;
  error: Error | null;
  updatedAt: number;
};

function unknownAsset(address: `0x${string}`): DispatchRow['asset'] {
  return {
    symbol: 'UNK',
    chain: 'UNKNOWN',
    chainLabel: 'UNKNOWN',
    chainShort: 'UNK',
    address,
    decimals: 6,
  };
}

export function useProtocolDispatch(limit = 8): DispatchState {
  const [state, setState] = useState<DispatchState>({
    rows: [],
    loading: true,
    error: null,
    updatedAt: 0,
  });

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      try {
        const items = await fetchManagerLogs({ limit });
        if (cancelled) return;

        const rows: DispatchRow[] = items.map(({ event, timestamp }) => {
          const asset =
            (TOKENS.find((t) => t.address.toLowerCase() === event.token.toLowerCase())
              ?? tokenByAddress(event.token))
              ?? unknownAsset(event.token);
          if (event.type === 'MINT') {
            return {
              type: 'MINT' as const,
              timestamp,
              pusdAmount: event.pusdMinted,
              tokenAmount: event.tokenAmount,
              asset,
              user: event.user,
              recipient: event.recipient,
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
            user: event.user,
            recipient: event.recipient,
            txHash: event.txHash,
            blockNumber: event.blockNumber,
            logIndex: event.logIndex,
          };
        });

        setState({ rows, loading: false, error: null, updatedAt: Date.now() });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to load dispatch'),
        }));
      }
    };

    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [limit]);

  return state;
}

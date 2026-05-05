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

        const rows: DispatchRow[] = items
          // The public dispatch feed only surfaces plain PUSD mint/redeem.
          // PUSD+ events render in the user's own dashboard.
          .filter(({ event }) => event.type === 'MINT' || event.type === 'REDEEM')
          .map(({ event, timestamp }) => {
            // Type guard above narrows event to DepositedEvent | RedeemedEvent.
            const e = event as Extract<typeof event, { type: 'MINT' | 'REDEEM' }>;
            const asset =
              (TOKENS.find((t) => t.address.toLowerCase() === e.token.toLowerCase())
                ?? tokenByAddress(e.token))
                ?? unknownAsset(e.token);
            if (e.type === 'MINT') {
              return {
                type: 'MINT' as const,
                timestamp,
                pusdAmount: e.pusdMinted,
                tokenAmount: e.tokenAmount,
                asset,
                user: e.user,
                recipient: e.recipient,
                txHash: e.txHash,
                blockNumber: e.blockNumber,
                logIndex: e.logIndex,
              };
            }
            return {
              type: 'REDEEM' as const,
              timestamp,
              pusdAmount: e.pusdBurned,
              tokenAmount: e.tokenAmount,
              asset,
              user: e.user,
              recipient: e.recipient,
              txHash: e.txHash,
              blockNumber: e.blockNumber,
              logIndex: e.logIndex,
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

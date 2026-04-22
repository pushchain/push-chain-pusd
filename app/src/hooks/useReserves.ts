/**
 * useReserves — per-token balances sitting inside PUSDManager.
 *
 * Reads every token in the consolidated `TOKENS` list (single source of
 * truth in `contracts/tokens.ts`):
 *   - `balanceOf(PUSDManager)` on the ERC-20
 *   - `getTokenStatus(address)` on PUSDManager
 * Normalizes balances to PUSD decimals (6), computes percentages, sorts by
 * descending balance. Entries with `status === 'REMOVED'` are filtered out.
 *
 * No ethers event subscription — we poll on a 12s cadence to keep the
 * ribbon and the reserves table in sync.
 */

import { ethers } from 'ethers';
import { useEffect, useMemo, useState } from 'react';
import { PUSD_MANAGER_ADDRESS } from '../contracts/config';
import {
  TOKENS,
  statusFromEnum,
  type ReserveToken,
  type ReserveTokenStatus,
} from '../contracts/tokens';
import { normalizeToPUSD } from '../lib/invariants';
import { getReadProvider } from '../lib/provider';

const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];
const MANAGER_STATUS_ABI = ['function getTokenStatus(address) view returns (uint8)'];

const POLL_MS = 12_000;

export type ReserveRow = {
  symbol: ReserveToken['symbol'];
  chain: string;
  chainLabel: string;
  chainShort: string;
  address: `0x${string}`;
  decimals: number;
  balance: bigint;              // native token amount
  balanceNormalized: bigint;    // normalized to 6dp
  pctOfReserves: number;        // 0..100 (float, %)
  status: ReserveTokenStatus;
  moveableKey: [string, string];
};

export type ReservesState = {
  rows: ReserveRow[];
  totalReserves: bigint;        // sum of normalized balances (6dp)
  loading: boolean;
  error: Error | null;
  updatedAt: number;            // epoch ms
};

export function useReserves(): ReservesState {
  const [state, setState] = useState<ReservesState>({
    rows: [],
    totalReserves: 0n,
    loading: true,
    error: null,
    updatedAt: 0,
  });

  // Stable token list reference — TOKENS is `as const` but we memo anyway.
  const tokens = useMemo(() => TOKENS, []);

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      const provider = getReadProvider();
      const manager = new ethers.Contract(PUSD_MANAGER_ADDRESS, MANAGER_STATUS_ABI, provider);

      try {
        const rowPromises = tokens.map(async (t): Promise<ReserveRow | null> => {
          const erc20 = new ethers.Contract(t.address, ERC20_BALANCE_ABI, provider);
          const [balance, statusCode] = await Promise.all([
            erc20.balanceOf(PUSD_MANAGER_ADDRESS) as Promise<bigint>,
            manager.getTokenStatus(t.address) as Promise<bigint>,
          ]);
          const status = statusFromEnum(statusCode);
          if (status === 'REMOVED') return null;
          return {
            symbol: t.symbol,
            chain: t.chain,
            chainLabel: t.chainLabel,
            chainShort: t.chainShort,
            address: t.address,
            decimals: t.decimals,
            balance: BigInt(balance),
            balanceNormalized: normalizeToPUSD(BigInt(balance), t.decimals),
            pctOfReserves: 0,
            status,
            moveableKey: t.moveableKey,
          };
        });

        const settled = await Promise.all(rowPromises);
        if (cancelled) return;

        const rows = settled.filter((r): r is ReserveRow => r !== null);
        const totalReserves = rows.reduce((acc, r) => acc + r.balanceNormalized, 0n);

        const withPct = rows
          .map((r) => ({
            ...r,
            pctOfReserves:
              totalReserves === 0n
                ? 0
                : Number((r.balanceNormalized * 10_000n) / totalReserves) / 100,
          }))
          .sort((a, b) => (b.balanceNormalized > a.balanceNormalized ? 1 : -1));

        setState({
          rows: withPct,
          totalReserves,
          loading: false,
          error: null,
          updatedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to read reserves'),
          updatedAt: Date.now(),
        }));
      }
    };

    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tokens]);

  return state;
}

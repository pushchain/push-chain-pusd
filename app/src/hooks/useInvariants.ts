/**
 * useInvariants — live I-01 solvency pulse.
 *
 * I-01 (v1 simple form): Σ normalize(reserve[tᵢ]) ≥ pusd.totalSupply()
 *
 * Composes `useReserves()` and `usePUSDBalance()` — both already poll
 * every 12s, so the ribbon pulse comes for free via their updates.
 * No direct contract calls here.
 */

import { useMemo } from 'react';
import { deriveInvariantState, type InvariantPulse } from '../lib/invariants';
import { usePUSDBalance } from './usePUSDBalance';
import { useReserves } from './useReserves';

export function useInvariants(): InvariantPulse {
  const reserves = useReserves();
  const { totalSupply, loading: supplyLoading, error: supplyError } = usePUSDBalance();

  return useMemo<InvariantPulse>(() => {
    const loading = reserves.loading || supplyLoading;
    const error = reserves.error ?? supplyError;

    if (loading && reserves.updatedAt === 0) {
      return {
        state: 'loading',
        reserves: 0n,
        supply: 0n,
        delta: 0n,
        perToken: [],
        updatedAt: 0,
        error,
      };
    }

    const state = error
      ? 'loading'
      : deriveInvariantState(reserves.totalReserves, totalSupply);

    return {
      state,
      reserves: reserves.totalReserves,
      supply: totalSupply,
      delta: reserves.totalReserves - totalSupply,
      perToken: reserves.rows.map((r) => ({
        symbol: r.symbol,
        chain: r.chainShort,
        address: r.address,
        balance: r.balance,
        decimals: r.decimals,
      })),
      updatedAt: reserves.updatedAt,
      error,
    };
  }, [reserves, totalSupply, supplyLoading, supplyError]);
}

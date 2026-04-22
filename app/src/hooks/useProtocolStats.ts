/**
 * useProtocolStats — protocol-level scalars used by the Reserves page.
 *
 * - baseFee (bps) — redemption fee rate, set by admin
 * - accruedFeesTotal (6dp) — Σ accruedFees(tᵢ) for supported tokens
 *
 * Poll cadence 12s to match the ribbon pulse.
 */

import { ethers } from 'ethers';
import { useEffect, useMemo, useState } from 'react';
import { PUSD_MANAGER_ADDRESS } from '../contracts/config';
import { TOKENS } from '../contracts/tokens';
import { normalizeToPUSD } from '../lib/invariants';
import { getReadProvider } from '../lib/provider';

const MANAGER_ABI = [
  'function baseFee() view returns (uint256)',
  'function accruedFees(address) view returns (uint256)',
];

const POLL_MS = 12_000;

export type ProtocolStatsState = {
  baseFeeBps: number;           // base fee in basis points (e.g. 5 == 0.05%)
  accruedFeesTotal: bigint;     // normalized to 6dp
  loading: boolean;
  error: Error | null;
  updatedAt: number;
};

export function useProtocolStats(): ProtocolStatsState {
  const tokens = useMemo(() => TOKENS, []);
  const [state, setState] = useState<ProtocolStatsState>({
    baseFeeBps: 0,
    accruedFeesTotal: 0n,
    loading: true,
    error: null,
    updatedAt: 0,
  });

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      try {
        const manager = new ethers.Contract(PUSD_MANAGER_ADDRESS, MANAGER_ABI, getReadProvider());

        const baseFeePromise = manager.baseFee() as Promise<bigint>;
        const feePromises = tokens.map((t) =>
          (manager.accruedFees(t.address) as Promise<bigint>)
            .then((raw) => normalizeToPUSD(BigInt(raw), t.decimals))
            .catch(() => 0n),
        );

        const [baseFee, ...fees] = await Promise.all([baseFeePromise, ...feePromises]);
        if (cancelled) return;

        const total = fees.reduce((acc, f) => acc + f, 0n);
        setState({
          baseFeeBps: Number(baseFee),
          accruedFeesTotal: total,
          loading: false,
          error: null,
          updatedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to read stats'),
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

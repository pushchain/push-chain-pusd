/**
 * usePUSDPlusStats — global PUSD+ vault stats (totalAssets, supply, pps, fee).
 *
 * - Reads through the shared read-only RPC provider so it works pre- and post-
 *   wallet-connect.
 * - Polls on a 12s cadence (matches the editorial ribbon pulse).
 * - Returns 6-decimal bigints for assets, 12-decimal for supply (PUSD+ shares
 *   carry an offset of 6), and `pps` as a 1e18-scaled bigint suitable for
 *   formatting at display-time.
 * - Returns `null` for `pps` until the vault has at least one share — by
 *   convention the editorial UI shows "1.000" (par) in that case.
 */

import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { PUSD_MANAGER_ADDRESS, PUSD_PLUS_ADDRESS } from '../contracts/config';
import { getReadProvider } from '../lib/provider';

const PLUS_ABI = [
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function pricePerShare() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function performanceFeeBps() view returns (uint16)',
];

// Manager owns the vault haircut — it's charged inside `mintForVault` against the
// pre-mint stable, before PUSDPlus ever sees the resulting PUSD.
const MANAGER_ABI = [
  'function vaultHaircutBps() view returns (uint16)',
];

const POLL_MS = 12_000;

export type PUSDPlusStatsState = {
  totalAssets: bigint;        // 6dp PUSD-equivalent
  totalSupply: bigint;        // 12dp shares
  pricePerShare: bigint | null; // 1e18-scaled, null when supply == 0
  shareDecimals: number;      // 12 in v2
  vaultHaircutBps: number;    // basis points charged on depositStable
  performanceFeeBps: number;  // basis points crystallised on yield growth
  loading: boolean;
  error: Error | null;
  configured: boolean;        // false when VITE_PUSD_PLUS_ADDRESS is unset
};

const EMPTY: PUSDPlusStatsState = {
  totalAssets: 0n,
  totalSupply: 0n,
  pricePerShare: null,
  shareDecimals: 12,
  vaultHaircutBps: 0,
  performanceFeeBps: 0,
  loading: false,
  error: null,
  configured: false,
};

export function usePUSDPlusStats(): PUSDPlusStatsState {
  const [state, setState] = useState<PUSDPlusStatsState>(() =>
    PUSD_PLUS_ADDRESS ? { ...EMPTY, loading: true, configured: true } : EMPTY,
  );

  useEffect(() => {
    if (!PUSD_PLUS_ADDRESS) return;

    let cancelled = false;
    const provider = getReadProvider();
    const plus = new ethers.Contract(PUSD_PLUS_ADDRESS, PLUS_ABI, provider);
    const manager = new ethers.Contract(PUSD_MANAGER_ADDRESS, MANAGER_ABI, provider);

    const read = async () => {
      try {
        const [assets, supply, pps, dec, perf, haircut] = await Promise.all([
          plus.totalAssets() as Promise<bigint>,
          plus.totalSupply() as Promise<bigint>,
          plus.pricePerShare() as Promise<bigint>,
          plus.decimals() as Promise<bigint>,
          plus.performanceFeeBps() as Promise<bigint>,
          (manager.vaultHaircutBps() as Promise<bigint>).catch(() => 0n), // tolerate v1
        ]);
        if (cancelled) return;
        setState({
          totalAssets: BigInt(assets),
          totalSupply: BigInt(supply),
          pricePerShare: BigInt(supply) === 0n ? null : BigInt(pps),
          shareDecimals: Number(dec),
          vaultHaircutBps: Number(haircut),
          performanceFeeBps: Number(perf),
          loading: false,
          error: null,
          configured: true,
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to read PUSDPlus'),
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

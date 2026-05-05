/**
 * useNAV — read PUSDPlusVault.nav() (1e18 fixed point).
 *
 * NAV starts at 1.0 (1e18) at bootstrap and grows as the vault harvests
 * LP fees. Polls every 30s.
 */

import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { PUSD_PLUS_ADDRESS } from '../contracts/config';
import { getReadProvider } from '../lib/provider';

const ABI = ['function nav() view returns (uint256)'];

const POLL_MS = 30_000;
const NAV_PRECISION = 10n ** 18n;

export type NAVState = {
  navE18: bigint;
  /** PUSD per PUSD+, expressed as a regular number (≈ 1.0–1.05). */
  pusdPerPlus: number;
  loading: boolean;
  error: Error | null;
  unconfigured: boolean;
};

export function useNAV(): NAVState {
  const unconfigured = !PUSD_PLUS_ADDRESS;
  const [state, setState] = useState<NAVState>({
    navE18: NAV_PRECISION,
    pusdPerPlus: 1,
    loading: !unconfigured,
    error: null,
    unconfigured,
  });

  useEffect(() => {
    if (unconfigured) return;
    let cancelled = false;

    const read = async () => {
      try {
        const vault = new ethers.Contract(PUSD_PLUS_ADDRESS!, ABI, getReadProvider());
        const navE18 = (await vault.nav()) as bigint;
        if (cancelled) return;
        // Render 6dp of precision; 1e12 trims 18 → 6dp.
        const pusdPerPlus = Number(navE18 / 10n ** 12n) / 1e6;
        setState({
          navE18: BigInt(navE18),
          pusdPerPlus,
          loading: false,
          error: null,
          unconfigured: false,
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to read NAV'),
        }));
      }
    };

    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [unconfigured]);

  return state;
}

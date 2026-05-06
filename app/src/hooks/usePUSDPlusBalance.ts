/**
 * usePUSDPlusBalance — connected account PUSD+ balance + global supply.
 * Mirrors usePUSDBalance for the yield-bearing token.
 */

import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { usePushChainClient } from '@pushchain/ui-kit';
import { PUSD_PLUS_ADDRESS } from '../contracts/config';
import { getReadProvider } from '../lib/provider';

const ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
];

const POLL_MS = 12_000;

export type PUSDPlusBalanceState = {
  balance: bigint;
  totalSupply: bigint;
  loading: boolean;
  error: Error | null;
  /** True when VITE_PUSD_PLUS_ADDRESS is unset; UI should hide PUSD+ surface. */
  unconfigured: boolean;
};

export function usePUSDPlusBalance(): PUSDPlusBalanceState {
  const { pushChainClient } = usePushChainClient();
  const account = pushChainClient?.universal?.account ?? null;
  const unconfigured = !PUSD_PLUS_ADDRESS;

  const [state, setState] = useState<PUSDPlusBalanceState>({
    balance: 0n,
    totalSupply: 0n,
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
        const supplyPromise = vault.totalSupply() as Promise<bigint>;
        const balancePromise = account
          ? (vault.balanceOf(account) as Promise<bigint>)
          : Promise.resolve(0n);
        const [supply, balance] = await Promise.all([supplyPromise, balancePromise]);
        if (cancelled) return;
        setState({
          balance: BigInt(balance),
          totalSupply: BigInt(supply),
          loading: false,
          error: null,
          unconfigured: false,
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to read PUSD+'),
        }));
      }
    };

    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [account, unconfigured]);

  return state;
}

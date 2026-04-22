/**
 * usePUSDBalance — connected account PUSD balance + global total supply.
 *
 * - Reads through a bare JSON-RPC provider so both pre- and post-connect
 *   renders work identically.
 * - totalSupply refreshes on a 12s cadence (matches ribbon pulse).
 * - balance refreshes with the same pulse but only when we have an account.
 * - Returns 6-decimal bigints (PUSD native precision).
 */

import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { usePushChainClient } from '@pushchain/ui-kit';
import { PUSD_ADDRESS } from '../contracts/config';
import { getReadProvider } from '../lib/provider';

const ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
];

const POLL_MS = 12_000;

export type PUSDBalanceState = {
  balance: bigint;       // 6dp — connected account
  totalSupply: bigint;   // 6dp — global
  loading: boolean;
  error: Error | null;
};

export function usePUSDBalance(): PUSDBalanceState {
  const { pushChainClient } = usePushChainClient();
  const account = pushChainClient?.universal?.account ?? null;

  const [state, setState] = useState<PUSDBalanceState>({
    balance: 0n,
    totalSupply: 0n,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      try {
        const pusd = new ethers.Contract(PUSD_ADDRESS, ABI, getReadProvider());
        const supplyPromise = pusd.totalSupply() as Promise<bigint>;
        const balancePromise = account
          ? (pusd.balanceOf(account) as Promise<bigint>)
          : Promise.resolve(0n);
        const [supply, balance] = await Promise.all([supplyPromise, balancePromise]);
        if (cancelled) return;
        setState({
          balance: BigInt(balance),
          totalSupply: BigInt(supply),
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to read PUSD'),
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

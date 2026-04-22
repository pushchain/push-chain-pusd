/**
 * useTokenBalance — ERC-20 balance for an arbitrary token.
 *
 * Used by the Mint card to show the "max" the user can deposit of the
 * currently-selected reserve token.
 *
 * The token lives on Donut (PUSDManager accepts the bridged representation).
 * Cross-chain origin funds are routed via `funds: MOVEABLE.TOKEN.*` but the
 * balance shown here is the Donut-side balance — this is what actually gets
 * pulled by the ERC-20 transferFrom during `deposit`.
 */

import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { usePushChainClient } from '@pushchain/ui-kit';
import { getReadProvider } from '../lib/provider';

const ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
];

const POLL_MS = 12_000;

export type TokenBalanceState = {
  balance: bigint;
  allowance: bigint;     // 0 when `spender` is null
  loading: boolean;
  error: Error | null;
};

export function useTokenBalance(
  tokenAddress: `0x${string}` | null,
  spender: `0x${string}` | null = null,
): TokenBalanceState {
  const { pushChainClient } = usePushChainClient();
  const account = pushChainClient?.universal?.account ?? null;

  const [state, setState] = useState<TokenBalanceState>({
    balance: 0n,
    allowance: 0n,
    loading: !!tokenAddress && !!account,
    error: null,
  });

  useEffect(() => {
    if (!tokenAddress || !account) {
      setState({ balance: 0n, allowance: 0n, loading: false, error: null });
      return;
    }

    let cancelled = false;

    const read = async () => {
      try {
        const token = new ethers.Contract(tokenAddress, ABI, getReadProvider());
        const balancePromise = token.balanceOf(account) as Promise<bigint>;
        const allowancePromise = spender
          ? (token.allowance(account, spender) as Promise<bigint>)
          : Promise.resolve(0n);
        const [balance, allowance] = await Promise.all([balancePromise, allowancePromise]);
        if (cancelled) return;
        setState({
          balance: BigInt(balance),
          allowance: BigInt(allowance),
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to read token'),
        }));
      }
    };

    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tokenAddress, account, spender]);

  return state;
}

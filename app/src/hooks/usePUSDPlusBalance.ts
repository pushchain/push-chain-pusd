/**
 * usePUSDPlusBalance — connected wallet's PUSD+ share balance + PUSD-equivalent
 *                      claim (via convertToAssets).
 *
 * Read-only, polls every 12s. Mirrors the structure of `usePUSDBalance` so the
 * SavePanel can swap one for the other without restructuring its render tree.
 */

import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { usePushChainClient } from '@pushchain/ui-kit';
import { PUSD_PLUS_ADDRESS } from '../contracts/config';
import { getReadProvider } from '../lib/provider';

const ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256) view returns (uint256)',
];

const POLL_MS = 12_000;

export type PUSDPlusBalanceState = {
  shares: bigint;        // 12dp shares
  assetsClaim: bigint;   // 6dp PUSD-equivalent (shares * pps)
  loading: boolean;
  error: Error | null;
  configured: boolean;
};

const EMPTY: PUSDPlusBalanceState = {
  shares: 0n,
  assetsClaim: 0n,
  loading: false,
  error: null,
  configured: false,
};

export function usePUSDPlusBalance(): PUSDPlusBalanceState {
  const { pushChainClient } = usePushChainClient();
  const account = pushChainClient?.universal?.account ?? null;

  const [state, setState] = useState<PUSDPlusBalanceState>(() =>
    PUSD_PLUS_ADDRESS ? { ...EMPTY, loading: !!account, configured: true } : EMPTY,
  );

  useEffect(() => {
    if (!PUSD_PLUS_ADDRESS) return;
    if (!account) {
      setState({ ...EMPTY, configured: true });
      return;
    }
    let cancelled = false;
    const c = new ethers.Contract(PUSD_PLUS_ADDRESS, ABI, getReadProvider());

    const read = async () => {
      try {
        const shares = (await c.balanceOf(account)) as bigint;
        const claim = shares > 0n
          ? ((await c.convertToAssets(shares)) as bigint)
          : 0n;
        if (cancelled) return;
        setState({
          shares: BigInt(shares),
          assetsClaim: BigInt(claim),
          loading: false,
          error: null,
          configured: true,
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to read PUSDPlus balance'),
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

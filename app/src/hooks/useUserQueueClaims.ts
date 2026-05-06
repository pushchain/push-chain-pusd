/**
 * useUserQueueClaims — open PUSD+ redeem queue entries for the connected
 * account.
 *
 * Walks `vault.queue[1..nextQueueId)` and surfaces entries where
 * `recipient == account && pusdOwed > 0`. Polled at 30s.
 *
 * Caveat: this is O(N) on the queue length. Fine while N is small; once the
 * queue is large we move this read into the indexer (`backend.md` §F2).
 */

import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { usePushChainClient } from '@pushchain/ui-kit';
import { PUSD_PLUS_ADDRESS } from '../contracts/config';
import { getReadProvider } from '../lib/provider';

const ABI = [
  'function nextQueueId() view returns (uint256)',
  'function queue(uint256) view returns (address recipient, address preferredAsset, bool allowBasket, uint128 pusdOwed, uint64 queuedAt)',
];

const POLL_MS = 30_000;
const MAX_WALK = 256;

export type QueueClaim = {
  queueId: bigint;
  preferredAsset: `0x${string}`;
  allowBasket: boolean;
  pusdOwed: bigint;
  queuedAt: number;
};

export type QueueClaimsState = {
  claims: QueueClaim[];
  loading: boolean;
  error: Error | null;
};

export function useUserQueueClaims(): QueueClaimsState {
  const { pushChainClient } = usePushChainClient();
  const account = pushChainClient?.universal?.account ?? null;
  const [state, setState] = useState<QueueClaimsState>({
    claims: [],
    loading: !!account && !!PUSD_PLUS_ADDRESS,
    error: null,
  });

  useEffect(() => {
    if (!PUSD_PLUS_ADDRESS || !account) {
      setState({ claims: [], loading: false, error: null });
      return;
    }
    let cancelled = false;

    const vaultAddress = PUSD_PLUS_ADDRESS as `0x${string}`;
    const read = async () => {
      try {
        const vault = new ethers.Contract(vaultAddress, ABI, getReadProvider());
        const next = (await vault.nextQueueId()) as bigint;
        const start = next > BigInt(MAX_WALK) ? next - BigInt(MAX_WALK) : 1n;
        const out: QueueClaim[] = [];
        const acct = account.toLowerCase();
        for (let id = start; id < next; id++) {
          const entry = await vault.queue(id);
          const [recipient, preferredAsset, allowBasket, pusdOwed, queuedAt] = entry;
          if ((recipient as string).toLowerCase() !== acct) continue;
          if ((pusdOwed as bigint) === 0n) continue;
          out.push({
            queueId: id,
            preferredAsset: preferredAsset as `0x${string}`,
            allowBasket: Boolean(allowBasket),
            pusdOwed: BigInt(pusdOwed),
            queuedAt: Number(queuedAt),
          });
        }
        if (cancelled) return;
        setState({ claims: out, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to read queue'),
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

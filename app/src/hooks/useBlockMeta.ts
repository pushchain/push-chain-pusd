/**
 * useBlockMeta — live block number + round-trip latency to the Donut RPC.
 *
 * Feeds the editorial band ( `BLOCK 4,248,116 · DONUT TESTNET · LATENCY 1.95` )
 * at the top of every page. Polls every 6s to avoid spamming the public RPC
 * while still feeling live. Latency is the wallclock ms for the most recent
 * `eth_blockNumber` round-trip, exposed in seconds for the editorial style.
 */

import { useEffect, useState } from 'react';
import { getReadProvider } from '../lib/provider';

export type BlockMeta = {
  block: number | null;
  /** Milliseconds for the most recent round-trip; null while loading. */
  latencyMs: number | null;
  /** Error message from the most recent poll, if any. */
  error: string | null;
};

const POLL_MS = 6_000;

export function useBlockMeta(): BlockMeta {
  const [meta, setMeta] = useState<BlockMeta>({ block: null, latencyMs: null, error: null });

  useEffect(() => {
    let cancelled = false;
    const provider = getReadProvider();

    const poll = async () => {
      const start = performance.now();
      try {
        const block = await provider.getBlockNumber();
        const latencyMs = performance.now() - start;
        if (!cancelled) setMeta({ block, latencyMs, error: null });
      } catch (err) {
        if (!cancelled) {
          setMeta((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : 'rpc error',
          }));
        }
      }
    };

    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return meta;
}

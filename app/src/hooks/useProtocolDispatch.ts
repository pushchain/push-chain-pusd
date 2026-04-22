/**
 * useProtocolDispatch — global recent Mint/Redeem activity (not user-scoped).
 *
 * Powers the "Dispatch · the day so far" section on the home page.
 * Re-uses the exact same event pipeline as useUserHistory but without the
 * user-address filter, so every mint and redeem across all users shows up.
 *
 * Cap the visible list at `limit` (default 8 — mockup shows 2×4 grid) so
 * we don't flood the DOM on active days.
 */

import { ethers } from 'ethers';
import { useEffect, useMemo, useState } from 'react';
import PUSDManagerArtifact from '../contracts/PUSDManager.json';
import { PUSD_MANAGER_ADDRESS } from '../contracts/config';
import { TOKENS, tokenByAddress, type ReserveToken } from '../contracts/tokens';
import { parseManagerLog, type ManagerEvent } from '../lib/events';
import { getReadProvider } from '../lib/provider';

const WINDOW_BLOCKS = 20_000n;
const POLL_MS = 30_000;

export type DispatchRow = {
  type: 'MINT' | 'REDEEM';
  timestamp: number;
  pusdAmount: bigint;
  tokenAmount: bigint;
  asset: Pick<ReserveToken, 'symbol' | 'chain' | 'chainLabel' | 'chainShort' | 'address' | 'decimals'> | {
    symbol: string;
    chain: string;
    chainLabel: string;
    chainShort: string;
    address: `0x${string}`;
    decimals: number;
  };
  user: `0x${string}`;
  recipient: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
};

export type DispatchState = {
  rows: DispatchRow[];
  loading: boolean;
  error: Error | null;
  updatedAt: number;
};

function unknownAsset(address: `0x${string}`): DispatchRow['asset'] {
  return {
    symbol: 'UNK',
    chain: 'UNKNOWN',
    chainLabel: 'UNKNOWN',
    chainShort: 'UNK',
    address,
    decimals: 6,
  };
}

export function useProtocolDispatch(limit = 8): DispatchState {
  const [state, setState] = useState<DispatchState>({
    rows: [],
    loading: true,
    error: null,
    updatedAt: 0,
  });

  const iface = useMemo(
    () => new ethers.Interface(PUSDManagerArtifact as ethers.InterfaceAbi),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      try {
        const provider = getReadProvider();
        const manager = new ethers.Contract(PUSD_MANAGER_ADDRESS, PUSDManagerArtifact, provider);

        const latest = BigInt(await provider.getBlockNumber());
        const fromBlock = latest > WINDOW_BLOCKS ? latest - WINDOW_BLOCKS : 0n;

        const [deposits, redemptions] = await Promise.all([
          manager.queryFilter(manager.filters.Deposited(), Number(fromBlock), Number(latest)),
          manager.queryFilter(manager.filters.Redeemed(), Number(fromBlock), Number(latest)),
        ]);

        const parsed = [...deposits, ...redemptions]
          .map((log) => ({ log, event: parseManagerLog(log, iface) }))
          .filter((p): p is { log: ethers.Log; event: ManagerEvent } => p.event !== null);

        // Resolve timestamps — unique blocks only.
        const uniqueBlocks = Array.from(new Set(parsed.map((p) => p.log.blockNumber)));
        const blockMap = new Map<number, number>();
        await Promise.all(
          uniqueBlocks.map(async (bn) => {
            const block = await provider.getBlock(bn);
            if (block) blockMap.set(bn, Number(block.timestamp));
          }),
        );

        const rows: DispatchRow[] = parsed.map(({ log, event }) => {
          const asset =
            (TOKENS.find((t) => t.address.toLowerCase() === event.token.toLowerCase())
              ?? tokenByAddress(event.token))
              ?? unknownAsset(event.token);
          if (event.type === 'MINT') {
            return {
              type: 'MINT',
              timestamp: blockMap.get(log.blockNumber) ?? 0,
              pusdAmount: event.pusdMinted,
              tokenAmount: event.tokenAmount,
              asset,
              user: event.user,
              recipient: event.recipient,
              txHash: event.txHash,
              blockNumber: event.blockNumber,
              logIndex: event.logIndex,
            };
          }
          return {
            type: 'REDEEM',
            timestamp: blockMap.get(log.blockNumber) ?? 0,
            pusdAmount: event.pusdBurned,
            tokenAmount: event.tokenAmount,
            asset,
            user: event.user,
            recipient: event.recipient,
            txHash: event.txHash,
            blockNumber: event.blockNumber,
            logIndex: event.logIndex,
          };
        });

        rows.sort((a, b) => {
          if (a.blockNumber === b.blockNumber) return b.logIndex - a.logIndex;
          return b.blockNumber > a.blockNumber ? 1 : -1;
        });

        if (cancelled) return;
        setState({
          rows: rows.slice(0, limit),
          loading: false,
          error: null,
          updatedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to load dispatch'),
        }));
      }
    };

    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [iface, limit]);

  return state;
}

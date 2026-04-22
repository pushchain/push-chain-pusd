/**
 * useUserHistory — connected account's Deposited + Redeemed events.
 *
 * Strategy:
 *   - Scan a bounded window of `WINDOW_BLOCKS` ending at `latest`.
 *   - Query Deposited filtered by `user = account` and Deposited filtered by
 *     `recipient = account`, plus the same two for Redeemed.
 *   - Coalesce by (txHash, logIndex) to dedupe self-directed mints/redeems.
 *   - Resolve block timestamps in a single `getBlock` per unique block.
 *
 * We do NOT subscribe to events — we re-scan on a 30s cadence (cheaper than
 * maintaining an in-browser eventsource against a rate-limited RPC).
 */

import { ethers } from 'ethers';
import { useEffect, useMemo, useState } from 'react';
import { usePushChainClient } from '@pushchain/ui-kit';
import PUSDManagerArtifact from '../contracts/PUSDManager.json';
import { PUSD_MANAGER_ADDRESS } from '../contracts/config';
import { TOKENS, tokenByAddress, type ReserveToken } from '../contracts/tokens';
import { parseManagerLog, type ManagerEvent } from '../lib/events';
import { getReadProvider } from '../lib/provider';

// Donut Testnet RPC caps eth_getLogs range at ~2k blocks per call.
const WINDOW_BLOCKS = 2_000n;
const POLL_MS = 30_000;

export type HistoryRow = {
  type: 'MINT' | 'REDEEM';
  timestamp: number;              // epoch seconds
  pusdAmount: bigint;             // positive on MINT, negative on REDEEM (for display)
  tokenAmount: bigint;            // native token amount (positive on both)
  asset: Pick<ReserveToken, 'symbol' | 'chain' | 'chainLabel' | 'chainShort' | 'address' | 'decimals'> | {
    symbol: string;
    chain: string;
    chainLabel: string;
    chainShort: string;
    address: `0x${string}`;
    decimals: number;
  };
  counterparty: `0x${string}`;   // recipient on MINT, user on REDEEM
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
};

export type UserHistoryState = {
  rows: HistoryRow[];
  loading: boolean;
  error: Error | null;
  updatedAt: number;
};

function unknownAssetFromAddress(address: `0x${string}`): HistoryRow['asset'] {
  return {
    symbol: 'UNK',
    chain: 'UNKNOWN',
    chainLabel: 'UNKNOWN',
    chainShort: 'UNK',
    address,
    decimals: 6,
  };
}

export function useUserHistory(): UserHistoryState {
  const { pushChainClient } = usePushChainClient();
  const account = pushChainClient?.universal?.account ?? null;

  const [state, setState] = useState<UserHistoryState>({
    rows: [],
    loading: false,
    error: null,
    updatedAt: 0,
  });

  // Prebuild the interface for log parsing. Stable across renders.
  const iface = useMemo(
    () => new ethers.Interface(PUSDManagerArtifact as ethers.InterfaceAbi),
    [],
  );

  useEffect(() => {
    if (!account) {
      setState({ rows: [], loading: false, error: null, updatedAt: 0 });
      return;
    }

    let cancelled = false;

    const read = async () => {
      setState((prev) => ({ ...prev, loading: prev.rows.length === 0 }));
      try {
        const provider = getReadProvider();
        const manager = new ethers.Contract(PUSD_MANAGER_ADDRESS, PUSDManagerArtifact, provider);

        const latest = BigInt(await provider.getBlockNumber());
        const fromBlock = latest > WINDOW_BLOCKS ? latest - WINDOW_BLOCKS : 0n;
        const from = Number(fromBlock);
        const to = Number(latest);

        // Four filters: Deposited(user), Deposited(recipient), Redeemed(user), Redeemed(recipient).
        const depositedUserFilter = manager.filters.Deposited(account, null, null);
        const depositedRecipientFilter = manager.filters.Deposited(null, null, null, account);
        const redeemedUserFilter = manager.filters.Redeemed(account, null, null);
        const redeemedRecipientFilter = manager.filters.Redeemed(null, null, null, account);

        const [depUser, depRecip, redUser, redRecip] = await Promise.all([
          manager.queryFilter(depositedUserFilter, from, to),
          manager.queryFilter(depositedRecipientFilter, from, to),
          manager.queryFilter(redeemedUserFilter, from, to),
          manager.queryFilter(redeemedRecipientFilter, from, to),
        ]);

        // Coalesce by (txHash, logIndex).
        const dedup = new Map<string, ethers.Log>();
        [...depUser, ...depRecip, ...redUser, ...redRecip].forEach((log) => {
          const key = `${log.transactionHash}:${log.index}`;
          if (!dedup.has(key)) dedup.set(key, log);
        });

        // Parse. Filter any that don't match our known events.
        const parsed = Array.from(dedup.values())
          .map((log) => ({ log, event: parseManagerLog(log, iface) }))
          .filter((p): p is { log: ethers.Log; event: ManagerEvent } => p.event !== null);

        // Fetch block timestamps — batch unique blocks.
        const uniqueBlocks = Array.from(new Set(parsed.map((p) => p.log.blockNumber)));
        const blockMap = new Map<number, number>();
        await Promise.all(
          uniqueBlocks.map(async (bn) => {
            const block = await provider.getBlock(bn);
            if (block) blockMap.set(bn, Number(block.timestamp));
          }),
        );

        const rows: HistoryRow[] = parsed.map(({ log, event }) => {
          const asset =
            (TOKENS.find((t) => t.address.toLowerCase() === event.token.toLowerCase())
              ?? tokenByAddress(event.token))
              ?? unknownAssetFromAddress(event.token);

          if (event.type === 'MINT') {
            return {
              type: 'MINT',
              timestamp: blockMap.get(log.blockNumber) ?? 0,
              pusdAmount: event.pusdMinted,
              tokenAmount: event.tokenAmount,
              asset,
              counterparty: event.recipient,
              txHash: event.txHash,
              blockNumber: event.blockNumber,
              logIndex: event.logIndex,
            };
          }
          // REDEEM
          return {
            type: 'REDEEM',
            timestamp: blockMap.get(log.blockNumber) ?? 0,
            pusdAmount: event.pusdBurned,
            tokenAmount: event.tokenAmount,
            asset,
            counterparty: event.user,
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
          rows,
          loading: false,
          error: null,
          updatedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to load history'),
        }));
      }
    };

    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [account, iface]);

  return state;
}

/**
 * useQueueStats — cross-event correlation: PUSD+ redeem queue lifecycle.
 *
 * Joins:
 *   BurnedPlus(queueId > 0)           ← redeem hit tier-3, queued
 *   QueueClaimFilled(queueId, ...)    ← keeper / user fulfilled later
 *
 * Reports:
 *   - opened   total queue entries opened (queueId > 0)
 *   - filled   total filled (matched by queueId)
 *   - openNow  opened − filled
 *   - timeToFillMedian  ms between BurnedPlus and QueueClaimFilled (across
 *     filled pairs; null if < 2 pairs available)
 *   - timeToFillMax     same but max
 *
 * Source of truth: chain. Same plumbing as `useNAVHistory` — pulls vault
 * events from Blockscout, parses, joins client-side.
 */

import { useEffect, useState } from 'react';
import { fetchVaultLogs } from '../lib/blockscout';
import type { BurnedPlusEvent, QueueClaimFilledEvent } from '../lib/events';

const POLL_MS = 60_000;

export type QueueStatsState = {
  loading: boolean;
  error: Error | null;
  opened: number;
  filled: number;
  openNow: number;
  timeToFillMedianMs: number | null;
  timeToFillMaxMs: number | null;
  updatedAt: number;
};

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function useQueueStats(): QueueStatsState {
  const [state, setState] = useState<QueueStatsState>({
    loading: true,
    error: null,
    opened: 0,
    filled: 0,
    openNow: 0,
    timeToFillMedianMs: null,
    timeToFillMaxMs: null,
    updatedAt: 0,
  });

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      try {
        const logs = await fetchVaultLogs({ maxPages: 5 });
        if (cancelled) return;

        // Open events (BurnedPlus with queueId > 0). Map queueId → ts.
        const openTs = new Map<string, number>();
        let opened = 0;
        for (const l of logs) {
          if (l.event.type !== 'BURNED_PLUS') continue;
          const e = l.event as BurnedPlusEvent;
          if (e.queueId === 0n) continue;
          opened++;
          openTs.set(e.queueId.toString(), l.timestamp * 1000);
        }

        // Fill events. Match against openTs.
        const fills: { queueId: string; openMs: number; fillMs: number }[] = [];
        for (const l of logs) {
          if (l.event.type !== 'QUEUE_CLAIM_FILLED') continue;
          const e = l.event as QueueClaimFilledEvent;
          const key = e.queueId.toString();
          const opened = openTs.get(key);
          if (opened === undefined || opened === 0) continue;
          fills.push({ queueId: key, openMs: opened, fillMs: l.timestamp * 1000 });
        }

        const latencies = fills
          .map((f) => f.fillMs - f.openMs)
          .filter((d) => d >= 0);

        setState({
          loading: false,
          error: null,
          opened,
          filled: fills.length,
          openNow: Math.max(0, opened - fills.length),
          timeToFillMedianMs: median(latencies),
          timeToFillMaxMs: latencies.length ? Math.max(...latencies) : null,
          updatedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to read queue stats'),
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

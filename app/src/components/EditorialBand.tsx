/**
 * EditorialBand — the thin newspaper-style strip at the very top of the page.
 *
 * Left: volume / issue / formatted date.
 * Right: live block number, network label, round-trip latency (seconds).
 *
 * Treats PUSD like a running publication — every session is an "issue".
 * Issue number is pegged to ISO-year × week so repeat visitors see it tick.
 */

import { useMemo } from 'react';
import { useBlockMeta } from '../hooks/useBlockMeta';
import { formatBlockNumber } from '../lib/format';

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function formatDate(d: Date): string {
  return d
    .toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    .toUpperCase();
}

export function EditorialBand() {
  const { block, latencyMs } = useBlockMeta();

  const { vol, no, date } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    // Year 2026 = Vol. 1, 2027 = Vol. 2, and so on.
    const volume = year - 2025;
    return {
      vol: `VOL. ${volume}`,
      no: `NO. ${String(isoWeek(now)).padStart(2, '0')}`,
      date: formatDate(now),
    };
  }, []);

  const blockLabel = block === null ? '—' : formatBlockNumber(block);
  const latencyLabel = latencyMs === null
    ? '—'
    : (latencyMs / 1000).toFixed(2);

  return (
    <div className="editorial-band">
      <div className="container editorial-band__inner">
        <div className="editorial-band__left">
          <span>PUSH USD</span>
          <span>·</span>
          <span>{vol}, {no}</span>
          <span>·</span>
          <span>{date}</span>
        </div>
        <div className="editorial-band__right">
          <span>BLOCK <strong>{blockLabel}</strong></span>
          <span>DONUT TESTNET</span>
          <span>LATENCY <strong>{latencyLabel}</strong></span>
        </div>
      </div>
    </div>
  );
}

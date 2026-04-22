/**
 * EditorialBand — the thin newspaper-style strip at the very top of the page.
 *
 * Left:  VOL · NO · DATE
 * Right: PUSD peg · circulation · collateral ratio · network chip
 *
 * We used to show BLOCK / LATENCY here — accurate but not meaningful to a
 * user skimming the masthead. The "conditions" on a newspaper front page
 * are the things a reader wants to glance and trust: supply, peg, ratio.
 */

import { useMemo } from 'react';
import { useReserves } from '../hooks/useReserves';
import { usePUSDBalance } from '../hooks/usePUSDBalance';
import { deriveInvariantState } from '../lib/invariants';
import { formatAmount, formatPct } from '../lib/format';

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

function shortNumber(n: bigint): string {
  // Whole units (already divided out of 6dp).
  if (n >= 1_000_000_000n) return `${(Number(n) / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000n) return `${(Number(n) / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000n) return `${(Number(n) / 1_000).toFixed(1)}k`;
  return n.toString();
}

export function EditorialBand() {
  const reserves = useReserves();
  const { totalSupply, loading: supplyLoading } = usePUSDBalance();

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

  const invariantState = useMemo(
    () => deriveInvariantState(reserves.totalReserves, totalSupply),
    [reserves.totalReserves, totalSupply],
  );

  const supplyWhole = totalSupply / 1_000_000n;
  const ratioLabel = totalSupply === 0n
    ? '—'
    : formatPct(reserves.totalReserves, totalSupply, 1);

  const pegGlyph = invariantState === 'violation' ? '✕' : invariantState === 'warning' ? '△' : '▲';
  const pegClass = invariantState === 'violation'
    ? 'editorial-band__peg editorial-band__peg--down'
    : invariantState === 'warning'
      ? 'editorial-band__peg editorial-band__peg--warn'
      : 'editorial-band__peg';

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
          <span className={pegClass}>
            PEG <strong>$1.0000</strong> {pegGlyph}
          </span>
          <span>
            SUPPLY <strong>{supplyLoading ? '—' : `${shortNumber(supplyWhole)} PUSD`}</strong>
          </span>
          <span>
            RATIO <strong>{reserves.loading || supplyLoading ? '—' : ratioLabel}</strong>
          </span>
          <span>
            RESERVES <strong>{reserves.loading ? '—' : formatAmount(reserves.totalReserves, 6, { maxFractionDigits: 0 })}</strong>
          </span>
          <span>DONUT TESTNET</span>
        </div>
      </div>
    </div>
  );
}

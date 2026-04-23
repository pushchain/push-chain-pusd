/**
 * Ticker — one-line mono strip below the hero.
 *
 *   PUSD  1.0000 ▲ peg    SUPPLY 12,483,221 · 2.14%    RATIO 100.0%
 *   USDC·BASE 31.0%       USDT·ETH 22.0%       USDC·SOL 11.0%       REBAL 24H 1
 *
 * Populated from useReserves() + usePUSDBalance(). Shows the top reserve
 * rows as chain/token share chips so the ticker doubles as a live allocation
 * key for the book of reserves below.
 *
 * Horizontally scrollable on narrow screens — intentionally overflows with
 * a thin scrollbar so the reader can always see every number.
 */

import { useMemo } from 'react';
import { useReserves } from '../hooks/useReserves';
import { usePUSDBalance } from '../hooks/usePUSDBalance';
import { useProtocolStats } from '../hooks/useProtocolStats';
import { useBlockMeta } from '../hooks/useBlockMeta';
import { formatAmount, formatBlockNumber, formatPct } from '../lib/format';
import { deriveInvariantState, normalizeToPUSD } from '../lib/invariants';

export function Ticker() {
  const reserves = useReserves();
  const { totalSupply } = usePUSDBalance();
  const { baseFeeBps, accruedFeesTotal } = useProtocolStats();
  const { block, latencyMs } = useBlockMeta();

  const invariantState = useMemo(
    () => deriveInvariantState(reserves.totalReserves, totalSupply),
    [reserves.totalReserves, totalSupply],
  );

  const ratioPct = (() => {
    if (totalSupply === 0n) return '—';
    return formatPct(reserves.totalReserves, totalSupply, 1);
  })();

  const topShares = useMemo(
    () => reserves.rows.slice(0, 4),
    [reserves.rows],
  );

  const supplyFormatted = formatAmount(normalizeToPUSD(totalSupply, 6), 6, {
    maxFractionDigits: 0,
  });

  const blockLabel = block === null ? '—' : formatBlockNumber(block);
  const latencyLabel = latencyMs === null ? '—' : (latencyMs / 1000).toFixed(2);

  return (
    <div className="ticker" aria-label="Live protocol ticker">
      <div className="container ticker__inner">
        <span className="ticker__item">
          <span>PUSD</span>
          <strong>1.0000</strong>
          <em className={invariantState === 'ok' ? '' : 'down'}>
            {invariantState === 'ok' ? '▲ peg' : invariantState === 'warning' ? '△ watch' : '✕ halt'}
          </em>
        </span>

        <span className="ticker__item">
          <span>SUPPLY</span>
          <strong>{supplyFormatted}</strong>
        </span>

        <span className="ticker__item">
          <span>RATIO</span>
          <strong>{ratioPct}</strong>
        </span>

        <span className="ticker__item">
          <span>FEE</span>
          <strong>{(baseFeeBps / 100).toFixed(2)}%</strong>
        </span>

        <span className="ticker__item">
          <span>ACCRUED</span>
          <strong>{formatAmount(accruedFeesTotal, 6, { maxFractionDigits: 0 })}</strong>
        </span>

        {topShares.map((r) => (
          <span className="ticker__item" key={r.address}>
            <span>{r.symbol}·{r.chainShort}</span>
            <strong>{r.pctOfReserves.toFixed(1)}%</strong>
          </span>
        ))}

        <span className="ticker__item">
          <span>ASSETS</span>
          <strong>{reserves.rows.length}</strong>
        </span>

        <span className="ticker__item">
          <span>BLOCK</span>
          <strong>{blockLabel}</strong>
          <em style={{ color: 'var(--c-ink-mute)' }}>{latencyLabel}s</em>
        </span>
      </div>
    </div>
  );
}

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
import { useVaultBook } from '../hooks/useVaultBook';
import { useBlockMeta } from '../hooks/useBlockMeta';
import { formatBlockNumber, formatPct, formatShortAmount } from '../lib/format';
import { deriveInvariantState } from '../lib/invariants';

export function Ticker() {
  const reserves = useReserves();
  const { totalSupply } = usePUSDBalance();
  const { baseFeeBps } = useProtocolStats();
  const vault = useVaultBook();
  const { block, latencyMs } = useBlockMeta();

  const invariantState = useMemo(
    () => deriveInvariantState(reserves.totalReserves, totalSupply),
    [reserves.totalReserves, totalSupply],
  );

  const ratioPct = (() => {
    if (totalSupply === 0n) return '—';
    return formatPct(reserves.totalReserves, totalSupply, 1);
  })();

  const supplyFormatted = formatShortAmount(totalSupply, 6);
  const plusSupplyFormatted = formatShortAmount(vault.plusTotalSupply, 6);

  const NAV_E18 = 10n ** 18n;
  const yieldPusd =
    vault.navE18 > NAV_E18
      ? ((vault.navE18 - NAV_E18) * vault.plusTotalSupply) / NAV_E18
      : 0n;
  const yieldFormatted = formatShortAmount(yieldPusd, 6);

  const blockLabel = block === null ? '—' : formatBlockNumber(block);
  const latencyLabel = latencyMs === null ? '—' : (latencyMs / 1000).toFixed(2);

  return (
    <div className="ticker" aria-label="Live protocol ticker">
      <div className="container ticker__inner">
        {/* — PUSD — */}
        <span className="ticker__item">
          <span>PUSD</span>
          <strong>1.0000</strong>
          <em className={invariantState === 'ok' ? '' : 'down'}>
            {invariantState === 'ok' ? '▲ peg' : invariantState === 'warning' ? '△ watch' : '✕ halt'}
          </em>
        </span>

        <span className="ticker__item">
          <span>PUSD SUPPLY</span>
          <strong>{supplyFormatted}</strong>
        </span>

        <span className="ticker__item">
          <span>PUSD RATIO</span>
          <strong>{ratioPct}</strong>
        </span>

        <span className="ticker__item">
          <span>PUSD FEE</span>
          <strong>{(baseFeeBps / 100).toFixed(2)}%</strong>
        </span>

        {/* — PUSD+ — */}
        <span className="ticker__item">
          <span>PUSD+</span>
          <strong>{vault.pusdPerPlus.toFixed(4)}</strong>
          <em>nav</em>
        </span>

        <span className="ticker__item">
          <span>PUSD+ SUPPLY</span>
          <strong>{plusSupplyFormatted}</strong>
        </span>

        <span className="ticker__item">
          <span>PUSD+ YIELD</span>
          <strong>{yieldFormatted}</strong>
          <em>pusd</em>
        </span>

        {/* — Chain meta — */}
        <span className="ticker__item">
          <span>BLOCK</span>
          <strong>{blockLabel}</strong>
          <em style={{ color: 'var(--c-ink-mute)' }}>{latencyLabel}s</em>
        </span>
      </div>
    </div>
  );
}

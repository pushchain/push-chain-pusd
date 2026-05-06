/**
 * YieldSection — the §02 alternate view for the home page. Replaces the
 * Proof-of-Reserves "Book" treatment with a focused PUSD+ vault peek:
 * stat strip, NAV-over-time sparkline, composition bar.
 *
 * Composed from the same hooks VaultBook uses on /reserves so the numbers
 * stay synchronized. We deliberately DO NOT render the full vault dashboard
 * here — homepage is a teaser, /reserves still has the complete picture
 * with queue lifecycle, yield cadence, insurance fund, etc.
 *
 * Children: a ChestTrigger lives on the rule between the totals header and
 * the chart block, mirroring the piggy bank that lived in the same slot
 * on the Book view.
 */

import type { ReactNode } from 'react';

import { useCountUp } from '../hooks/useCountUp';
import { useNAVHistory } from '../hooks/useNAVHistory';
import { useVaultBook } from '../hooks/useVaultBook';
import { formatAmount } from '../lib/format';
import { Sparkline } from './Sparkline';

const IDLE_RESERVE_COLOR = 'var(--c-magenta)';
const DEPLOYED_COLOR = 'var(--c-jade)';
const NAV_PRECISION = 1_000_000_000_000_000_000n;

function pct(numer: bigint, denom: bigint): number {
  if (denom === 0n) return 0;
  return Number((numer * 10_000n) / denom) / 100;
}

type Props = {
  /** Trigger sitting on the divider rule (the chest, mirror of piggy). */
  trigger: ReactNode;
};

export function YieldSection({ trigger }: Props) {
  const book = useVaultBook();
  const nav = useNAVHistory();

  const idleSum = book.basketIdle.reduce((a, s) => a + s.amountPusd, 0n) + book.pusdIdle;
  const totalAssetsCounted = useCountUp(book.totalAssets);
  const supplyCounted = useCountUp(book.plusTotalSupply);
  const idleReservesCounted = useCountUp(idleSum);
  const deployedCounted = useCountUp(book.deployedPusd);

  const rewardsPusd =
    book.navE18 > NAV_PRECISION
      ? ((book.navE18 - NAV_PRECISION) * book.plusTotalSupply) / NAV_PRECISION
      : 0n;
  const rewardsCounted = useCountUp(rewardsPusd);

  const total = book.totalAssets;
  const reservesPct = pct(idleSum, total);
  const deployedPct = pct(book.deployedPusd, total);
  const sparkPoints = nav.samples.map((s) => ({ ts: s.ts, value: s.pusdPerPlus }));

  return (
    <section className="section">
      <div className="section__header">
        <span style={{ color: 'var(--c-magenta)' }}>§ 02 · THE YIELD</span>
        <span>NAV-PER-SHARE · MONOTONIC NON-DECREASING</span>
      </div>

      <div className="book">
        <div>
          <h2 className="book__title">
            The <em>yield.</em>
          </h2>
          <div className="book__sub">
            PUSD+ holds reserves directly and deploys a slice into Uniswap V3
            stable pairs. NAV per share increases at each rebalance. The holders
            keep the same number of tokens, their PUSD claim grows.
          </div>
        </div>
        <div className="book__totals">
          <span className="book__totals-value" style={{ color: 'var(--c-magenta)' }}>
            {book.pusdPerPlus.toFixed(6)}
          </span>
          <div className="book__totals-label">NAV · PUSD PER PUSD+</div>
        </div>
        {/* Trigger spans both columns in its own grid row — mirror of the
         * piggy's slot on the Book view. */}
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          {trigger}
        </div>
      </div>

      <div className="stat-strip" style={{ marginTop: 4 }}>
        <div className="stat">
          <div className="stat__label">TOTAL ASSETS</div>
          <div className="stat__value">
            {book.loading ? '…' : formatAmount(totalAssetsCounted, 6, { maxFractionDigits: 0 })}
            <em> PUSD</em>
          </div>
          <div className="stat__sub">IDLE + DEPLOYED</div>
        </div>
        <div className="stat">
          <div className="stat__label">SUPPLY</div>
          <div className="stat__value">
            {formatAmount(supplyCounted, 6, { maxFractionDigits: 0 })}
            <em> PUSD+</em>
          </div>
          <div className="stat__sub">CIRCULATING</div>
        </div>
        <div className="stat">
          <div className="stat__label">YIELD GENERATED</div>
          <div className="stat__value" style={{ color: 'var(--c-jade)' }}>
            {formatAmount(rewardsCounted, 6, { maxFractionDigits: 2 })}
            <em> PUSD</em>
          </div>
          <div className="stat__sub">(NAV − 1.00) × SUPPLY</div>
        </div>
        <div className="stat">
          <div className="stat__label">DEPLOYED</div>
          <div className="stat__value">
            {formatAmount(deployedCounted, 6, { maxFractionDigits: 0 })}
            <em> PUSD</em>
          </div>
          <div className="stat__sub">{deployedPct.toFixed(2)}% OF ASSETS</div>
        </div>
      </div>

      <div className="section__header" style={{ marginTop: 32 }}>
        <span>§ NAV OVER TIME</span>
        <span>SAMPLED AT EACH REBALANCE</span>
      </div>

      <div
        style={{
          marginTop: 12,
          background: 'var(--c-paper)',
          border: 'var(--rule-thin)',
          padding: '16px 20px',
        }}
      >
        <Sparkline
          points={sparkPoints}
          width={1200}
          height={160}
          fixedDisplayHeight={160}
          ariaLabel={`NAV over ${sparkPoints.length} samples`}
        />
        <div className="meta-sm" style={{ marginTop: 10 }}>
          {nav.loading
            ? 'reading rebalance events…'
            : sparkPoints.length <= 1
              ? 'Genesis 1.000000 · awaiting first keeper rebalance.'
              : `${sparkPoints.length} sample${sparkPoints.length === 1 ? '' : 's'} · genesis 1.000000 · current ${book.pusdPerPlus.toFixed(6)}`}
        </div>
      </div>

      <div className="section__header" style={{ marginTop: 32 }}>
        <span>§ COMPOSITION</span>
        <span>WHERE THE TOTAL ASSETS LIVE</span>
      </div>

      <div className="dist-bar" role="img" aria-label="Vault composition">
        <div
          className="dist-bar__seg"
          style={{ width: `${Math.max(0.5, reservesPct)}%`, background: IDLE_RESERVE_COLOR }}
          title={`Idle reserves · ${reservesPct.toFixed(2)}%`}
        />
        <div
          className="dist-bar__seg"
          style={{ width: `${Math.max(0.5, deployedPct)}%`, background: DEPLOYED_COLOR }}
          title={`Deployed in LP · ${deployedPct.toFixed(2)}%`}
        />
      </div>
      <div className="dist-legend">
        <LegendItem
          color={IDLE_RESERVE_COLOR}
          label="IDLE RESERVES"
          pct={reservesPct}
          note={formatAmount(idleReservesCounted, 6, { maxFractionDigits: 0 }) + ' PUSD'}
        />
        <LegendItem
          color={DEPLOYED_COLOR}
          label="DEPLOYED"
          pct={deployedPct}
          note={formatAmount(deployedCounted, 6, { maxFractionDigits: 0 }) + ' PUSD'}
        />
      </div>
    </section>
  );
}

function LegendItem({
  color,
  label,
  pct,
  note,
}: {
  color: string;
  label: string;
  pct: number;
  note: string;
}) {
  return (
    <div className="dist-legend__item">
      <span className="dist-legend__swatch" style={{ background: color }} aria-hidden="true" />
      <span className="dist-legend__name">
        <strong>{label}</strong>
        <span className="mono"> · {note}</span>
      </span>
      <span className="dist-legend__pct mono">{pct.toFixed(2)}%</span>
    </div>
  );
}

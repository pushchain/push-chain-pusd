/**
 * ReservesDetailPage — /reserves route. Focused view of the reserve book.
 *
 * Unlike the editorial home at `/` (which mixes hero, manifesto, dispatch,
 * promise), this page is *just* the book of reserves plus an
 * allocation histogram. It's the page you bookmark if you care about
 * solvency and collateral composition, nothing else.
 *
 *   [ header strip: ratio · surplus · assets · chains · fees ]
 *   [ distribution: full-width allocation bars keyed to the table ]
 *   [ the book: table of every tracked asset — balance, share, status ]
 *
 * The allocation distribution doubles as a visual key: row-colour → bar
 * segment → chip in the table, so your eye hops between them naturally.
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TokenPill } from '../components/TokenPill';
import { VaultBook } from '../components/VaultBook';
import { PUSD_PLUS_ADDRESS } from '../contracts/config';
import { useCountUp } from '../hooks/useCountUp';
import { usePUSDBalance } from '../hooks/usePUSDBalance';
import { useProtocolStats } from '../hooks/useProtocolStats';
import { useReserves, type ReserveRow } from '../hooks/useReserves';
import {
  explorerAddress,
  formatAmount,
  formatPct,
  formatRelative,
  truncAddr,
} from '../lib/format';

type View = 'pusd' | 'plus';

const STATUS_LABEL: Record<string, string> = {
  ENABLED: 'ENABLED',
  REDEEM_ONLY: 'REDEEM ONLY',
  EMERGENCY_REDEEM: 'EMERGENCY',
  REMOVED: 'REMOVED',
};

const STATUS_CLASS: Record<string, string> = {
  ENABLED: 'status--enabled',
  REDEEM_ONLY: 'status--redeemonly',
  EMERGENCY_REDEEM: 'status--emergency',
  REMOVED: 'status--removed',
};

// Fixed palette shared between the distribution bar and the table rows.
// Indexed — first entry is the leading position (most reserves).
const SLICE_PALETTE = [
  'var(--c-ink)',
  'var(--c-magenta)',
  'var(--c-jade)',
  'var(--c-gold)',
  'var(--c-oxblood)',
  'var(--c-ink-dim)',
  'var(--c-ink-mute)',
  'var(--c-paper-warm)',
];

function sliceColor(i: number): string {
  return SLICE_PALETTE[i % SLICE_PALETTE.length];
}

export default function ReservesDetailPage() {
  const reserves = useReserves();
  const { totalSupply, loading: supplyLoading } = usePUSDBalance();
  const stats = useProtocolStats();

  // Toggle between the PUSD+ vault balance sheet (default) and the par-
  // backed PUSD reserves view. Persists to ?view= so the URL captures intent
  // and bookmark-friendly deep-links work. Defaults to 'plus' when V2 is
  // configured; falls back to 'pusd' when it isn't (vault section can't
  // render without an address).
  const plusEnabled = !!PUSD_PLUS_ADDRESS;
  const [searchParams, setSearchParams] = useSearchParams();
  const initialView: View = plusEnabled
    ? (searchParams.get('view') === 'pusd' ? 'pusd' : 'plus')
    : 'pusd';
  const [view, setViewState] = useState<View>(initialView);
  const setView = (next: View) => {
    setViewState(next);
    const sp = new URLSearchParams(searchParams);
    if (next === 'pusd') sp.set('view', 'pusd');
    else sp.delete('view');
    setSearchParams(sp, { replace: true });
  };

  const chainsCount = useMemo(() => {
    const set = new Set<string>();
    for (const r of reserves.rows) set.add(r.chain);
    return set.size;
  }, [reserves.rows]);

  const surplus =
    reserves.totalReserves > totalSupply ? reserves.totalReserves - totalSupply : 0n;

  // Count-up wake-ups — same idiom as the home page hero stats. Fires once
  // per stat on first reveal, then snaps to the live value on subsequent
  // polls. Reduced-motion users see the final number immediately.
  const reservesCounted = useCountUp(reserves.totalReserves);
  const surplusCounted  = useCountUp(surplus);
  const accruedCounted  = useCountUp(stats.accruedFeesTotal);

  const collateralRatio = formatPct(reserves.totalReserves, totalSupply, 2);
  const ratioClass = (() => {
    if (totalSupply === 0n) return 'stat__sub--delta-up';
    if (reserves.totalReserves < totalSupply) return 'stat__sub--delta-down';
    const threshold = totalSupply / 10_000n;
    return surplus >= threshold ? 'stat__sub--delta-up' : '';
  })();

  // Group by chain for the secondary "by chain" row.
  const byChain = useMemo(() => {
    const map = new Map<string, { label: string; short: string; total: bigint }>();
    for (const r of reserves.rows) {
      const entry = map.get(r.chain);
      if (entry) entry.total += r.balanceNormalized;
      else map.set(r.chain, { label: r.chainLabel, short: r.chainShort, total: r.balanceNormalized });
    }
    return Array.from(map.entries())
      .map(([chain, v]) => ({ chain, ...v }))
      .sort((a, b) => (b.total > a.total ? 1 : a.total > b.total ? -1 : 0));
  }, [reserves.rows]);

  return (
    <>
      <section className="hero hero--compact">
        <div className="container">
          <div className="hero__kicker">
            <span>§ RESERVES · THE BOOK</span>
            <span>
              LIVE ·{' '}
              {reserves.updatedAt ? `UPDATED ${formatRelative(reserves.updatedAt)}` : '—'}
            </span>
          </div>
          <h1 className="hero__title" style={{ fontSize: 'clamp(44px, 5.5vw, 72px)' }}>
            {view === 'pusd' ? (
              <>Every dollar <em>on-chain</em>, every second.</>
            ) : (
              <>Asset that <em>grows</em> with every <em>rebalance</em>.</>
            )}
          </h1>
          <p className="hero__lead" style={{ maxWidth: '72ch' }}>
            {view === 'pusd'
              ? 'This page lists every token PUSDManager currently holds. Balances and statuses are contract reads, not a snapshot. Refresh the page and the numbers refresh with it.'
              : 'The PUSD+ balance sheet including total assets, idle vs deployed, NAV history, queue lifecycle, and the insurance fund. All numbers are live contract reads + on-chain events.'}
          </p>
        </div>
      </section>

      {plusEnabled && (
        <div className="container" style={{ marginTop: 24 }}>
          <div className="reserves-toggle" role="tablist" aria-label="Reserves view">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'plus'}
              className={`reserves-toggle__btn reserves-toggle__btn--plus ${view === 'plus' ? 'reserves-toggle__btn--active' : ''}`}
              onClick={() => setView('plus')}
            >
              PUSD+ VAULT
              <span className="reserves-toggle__tag">YIELD · NAV</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'pusd'}
              className={`reserves-toggle__btn ${view === 'pusd' ? 'reserves-toggle__btn--active' : ''}`}
              onClick={() => setView('pusd')}
            >
              PUSD RESERVES
              <span className="reserves-toggle__tag">PAR · 1:1</span>
            </button>
          </div>
        </div>
      )}

      {view === 'plus' ? (
        <div className="container">
          <VaultBook />
        </div>
      ) : (
      <>
      <div className="container">
        <section className="section">
          <div className="section__header">
            <span>§ PUSD RESERVES</span>
            <span>PAR-BACKED · 1:1 · MULTI-CHAIN</span>
          </div>
          <div className="stat-strip">
            <div className="stat">
              <div className="stat__label">COLLATERAL RATIO</div>
              <div className="stat__value">
                {reserves.loading || supplyLoading ? '…' : collateralRatio}
              </div>
              <div className={`stat__sub ${ratioClass}`}>
                Σ RESERVES ≥ Σ PUSD
              </div>
            </div>
            <div className="stat">
              <div className="stat__label">GROSS RESERVES</div>
              <div className="stat__value">
                {reserves.loading
                  ? '…'
                  : formatAmount(reservesCounted, 6, { maxFractionDigits: 0 })}
                <em> USD</em>
              </div>
              <div className="stat__sub">NORMALIZED TO 6DP</div>
            </div>
            <div className="stat">
              <div className="stat__label">SURPLUS</div>
              <div className="stat__value">
                {formatAmount(surplusCounted, 6, { maxFractionDigits: 2 })}
                <em> USD</em>
              </div>
              <div className="stat__sub">OVER TOTAL SUPPLY</div>
            </div>
            <div className="stat">
              <div className="stat__label">ASSETS · CHAINS</div>
              <div className="stat__value">
                {reserves.rows.length} · <em>{chainsCount}</em>
              </div>
              <div className="stat__sub">
                ACCRUED FEES{' '}
                {stats.loading
                  ? '…'
                  : formatAmount(accruedCounted, 6, { maxFractionDigits: 0 })}{' '}
                USD
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section__header">
            <span>§ DISTRIBUTION</span>
            <span>SHARE OF RESERVES · NORMALIZED USD</span>
          </div>

          {reserves.loading && reserves.rows.length === 0 ? (
            <p style={{ color: 'var(--c-ink-mute)', padding: '24px 0' }}>
              Reading token balances from PUSDManager…
            </p>
          ) : reserves.rows.length === 0 ? (
            <p style={{ color: 'var(--c-ink-mute)', padding: '24px 0' }}>
              No tokens currently registered.
            </p>
          ) : (
            <>
              <div className="dist-bar" role="img" aria-label="Allocation distribution">
                {reserves.rows.map((r, i) => (
                  <div
                    key={r.address}
                    className="dist-bar__seg"
                    style={{
                      width: `${Math.max(0.5, r.pctOfReserves)}%`,
                      background: sliceColor(i),
                    }}
                    title={`${r.symbol} · ${r.chainShort} · ${r.pctOfReserves.toFixed(2)}%`}
                  />
                ))}
              </div>
              <div className="dist-legend">
                {reserves.rows.map((r, i) => (
                  <DistLegendItem key={r.address} row={r} color={sliceColor(i)} />
                ))}
              </div>

              <div className="section__header" style={{ marginTop: 32 }}>
                <span>§ BY CHAIN</span>
                <span>AGGREGATE PER ORIGIN</span>
              </div>
              <div className="chain-bars">
                {byChain.map((c) => {
                  const pct =
                    reserves.totalReserves > 0n
                      ? Number((c.total * 10_000n) / reserves.totalReserves) / 100
                      : 0;
                  return (
                    <div className="chain-bar" key={c.chain}>
                      <div className="chain-bar__label">
                        <span className="mono">{c.short}</span>
                        <span className="chain-bar__pct">{pct.toFixed(1)}%</span>
                      </div>
                      <div className="chain-bar__track">
                        <div
                          className="chain-bar__fill"
                          style={{ width: `${Math.max(1, pct)}%` }}
                        />
                      </div>
                      <div className="chain-bar__sub">
                        {formatAmount(c.total, 6, { maxFractionDigits: 0 })} USD
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <section className="section">
          <div className="section__header">
            <span>§ THE BOOK</span>
            <span>EVERY TRACKED ASSET · {reserves.rows.length} ROWS</span>
          </div>

          <div className="table-wrap">
            <table className="table table--responsive">
              <thead>
                <tr>
                  <th>ASSET</th>
                  <th className="cell-md-up">CHAIN</th>
                  <th className="cell-md-up">ADDRESS</th>
                  <th className="num">BALANCE</th>
                  <th className="num">SHARE</th>
                  <th className="cell-sm-up">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {reserves.loading && reserves.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--c-ink-mute)' }}>
                      Reading token balances from PUSDManager…
                    </td>
                  </tr>
                ) : reserves.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--c-ink-mute)' }}>
                      No tokens currently registered.
                    </td>
                  </tr>
                ) : (
                  reserves.rows.map((r, i) => (
                    <tr key={r.address}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span
                            aria-hidden="true"
                            style={{
                              display: 'inline-block',
                              width: 10,
                              height: 10,
                              background: sliceColor(i),
                              border: '1px solid var(--c-ink)',
                              flexShrink: 0,
                            }}
                          />
                          <TokenPill symbol={r.symbol} chainShort={r.chainShort} size="sm" />
                        </span>
                      </td>
                      <td className="mono cell-md-up">{r.chainLabel}</td>
                      <td className="addr cell-md-up">
                        <a
                          className="link-mono"
                          href={explorerAddress(r.address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {truncAddr(r.address)}
                        </a>
                      </td>
                      <td className="num">{formatAmount(r.balance, r.decimals)}</td>
                      <td className="num">{r.pctOfReserves.toFixed(2)}%</td>
                      <td className={`status cell-sm-up ${STATUS_CLASS[r.status] ?? ''}`}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {reserves.error && (
            <div className="feedback feedback--error" style={{ marginTop: 16 }}>
              <div className="feedback__title">RPC ERROR</div>
              <div className="mono">{reserves.error.message}</div>
            </div>
          )}
        </section>
      </div>
      </>
      )}
    </>
  );
}

function DistLegendItem({ row, color }: { row: ReserveRow; color: string }) {
  return (
    <div className="dist-legend__item">
      <span className="dist-legend__swatch" style={{ background: color }} aria-hidden="true" />
      <span className="dist-legend__name">
        <strong>{row.symbol}</strong>
        <span className="mono"> · {row.chainShort}</span>
      </span>
      <span className="dist-legend__pct mono">{row.pctOfReserves.toFixed(2)}%</span>
    </div>
  );
}

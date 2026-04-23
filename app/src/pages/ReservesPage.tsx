/**
 * ReservesPage — editorial home (/).
 *
 * Composition, top to bottom, matches the Issue 01 mockup:
 *
 *   HERO         — "A dollar that works on every chain." + inline ConvertPanel
 *   STAT STRIP   — CIRCULATION / COLLATERAL RATIO / ASSETS · CHAINS / BASE FEE
 *   TICKER       — live one-line tape (peg · supply · ratio · top shares)
 *   SLOGAN BAND  — italic editorial voice
 *
 *   §01 THE PROMISE        — big quote + numbered list of commitments
 *   §02 PROOF OF RESERVES  — "The book." + full-width reserve table with
 *                            distribution bars + book-footer invariants strip
 *   §03 MANIFESTO (I/II/III) — three brutalist roman-numeral columns
 *   §04 DISPATCH             — live activity cards (2×4 grid)
 *
 * Full-bleed bands (ticker, slogan, hero, stat-strip) live outside the
 * container; editorial prose sections sit inside `.container`.
 */

import { useMemo } from 'react';
import { ConvertPanel } from '../components/ConvertPanel';
import { DispatchFeed } from '../components/DispatchFeed';
import { SloganBand } from '../components/SloganBand';
import { Ticker } from '../components/Ticker';
import { TokenPill } from '../components/TokenPill';
import { useCountUp } from '../hooks/useCountUp';
import { usePUSDBalance } from '../hooks/usePUSDBalance';
import { useProtocolStats } from '../hooks/useProtocolStats';
import { useReserves } from '../hooks/useReserves';
import {
  explorerAddress,
  formatAmount,
  formatPct,
  formatRelative,
  truncAddr,
} from '../lib/format';

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

export default function ReservesPage() {
  const reserves = useReserves();
  const { totalSupply, loading: supplyLoading } = usePUSDBalance();
  const stats = useProtocolStats();

  // Top distribution share — used to scale the per-row bar width so it reads
  // as a proportion of the leading position, not of the whole.
  const topPct = useMemo(
    () => reserves.rows.reduce((m, r) => Math.max(m, r.pctOfReserves), 0) || 100,
    [reserves.rows],
  );

  const chainsCount = useMemo(() => {
    const set = new Set<string>();
    for (const r of reserves.rows) set.add(r.chain);
    return set.size;
  }, [reserves.rows]);

  const surplus =
    reserves.totalReserves > totalSupply ? reserves.totalReserves - totalSupply : 0n;
  const collateralRatio = formatPct(reserves.totalReserves, totalSupply, 2);

  // Count-up on mount for the two top-of-page big numbers. Only the raw
  // bigint is animated; the "RESERVES {…} ≥ SUPPLY {…}" subline stays static
  // because we want the comparison to be instantly legible.
  const supplyCounted = useCountUp(totalSupply);
  const reservesCounted = useCountUp(reserves.totalReserves);

  const ratioClass = (() => {
    if (totalSupply === 0n) return 'stat__sub--delta-up';
    if (reserves.totalReserves < totalSupply) return 'stat__sub--delta-down';
    // >= 0.01% surplus → up; tight → default mute.
    const threshold = totalSupply / 10_000n;
    return surplus >= threshold ? 'stat__sub--delta-up' : '';
  })();

  return (
    <>
      {/* ========================================================== HERO ===== */}
      <section className="hero">
        <div className="container">
          <div className="hero__inner">
            <div className="hero__left">
              <div className="hero__kicker">
                <span>§ HOME · ISSUE 01</span>
                <span>PAR-BACKED · UPGRADE-GATED · AUDIT-FIRST</span>
              </div>
              <h1 className="hero__title">
                A dollar that works on <em>every</em> chain.
              </h1>
              <p className="hero__lead">
                PUSD is a <em>par-backed</em> universal stablecoin on Push Chain.
                Deposit USDC or USDT from Ethereum, Solana, Base, Arbitrum, or BNB —
                in <em>one signature</em> — and mint PUSD 1:1. Redeem into your preferred
                asset, or into a <em>basket</em> when preferred liquidity is thin.
              </p>
              <p className="hero__lead" style={{ margin: 0 }}>
                No rebases. No yield games. A unit of <em>settlement</em>, not of speculation.
              </p>
            </div>
            <div className="hero__right">
              <ConvertPanel />
            </div>
          </div>
        </div>
      </section>

      {/* ===================================================== STAT STRIP ===== */}
      <section>
        <div className="container">
          <div className="stat-strip">
            <div className="stat">
              <div className="stat__label">CIRCULATION</div>
              <div className="stat__value">
                {supplyLoading ? '…' : formatAmount(supplyCounted, 6, { maxFractionDigits: 0 })}{' '}
                <em>PUSD</em>
              </div>
              <div className="stat__sub">TOTAL SUPPLY · 6 DECIMALS</div>
            </div>
            <div className="stat">
              <div className="stat__label">COLLATERAL RATIO</div>
              <div className="stat__value">{reserves.loading || supplyLoading ? '…' : collateralRatio}</div>
              <div className={`stat__sub ${ratioClass}`}>
                RESERVES {formatAmount(reservesCounted, 6, { maxFractionDigits: 0 })}{' '}
                ≥ SUPPLY {formatAmount(totalSupply, 6, { maxFractionDigits: 0 })}
              </div>
            </div>
            <div className="stat">
              <div className="stat__label">ASSETS · CHAINS</div>
              <div className="stat__value">
                {reserves.rows.length} · <em>{chainsCount}</em>
              </div>
              <div className="stat__sub">USDC + USDT · {chainsCount} ORIGINS</div>
            </div>
            <div className="stat">
              <div className="stat__label">BASE REDEMPTION FEE</div>
              <div className="stat__value">
                {stats.loading ? '… ' : (stats.baseFeeBps / 100).toFixed(2)}
                <em>%</em>
              </div>
              <div className="stat__sub">MINT FREE · REDEEM {stats.baseFeeBps} BPS</div>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================== TICKER ===== */}
      <Ticker />

      {/* ===================================================== SLOGAN BAND ===== */}
      <SloganBand />

      {/* ============================================ §01 · THE PROMISE ===== */}
      <div className="container">
        <section className="section">
          <div className="section__header">
            <span>§ 01 · THE PROMISE</span>
            <span>REDEEMABLE · RULES-BASED · REVERSIBLE</span>
          </div>
          <div className="promise-grid">
            <p className="promise-grid__quote">
              Every PUSD is a dollar.
              <em>Not a bet.</em>
            </p>
            <div className="numbered-list">
              <div className="numbered-list__item">
                <div className="numbered-list__num">01</div>
                <div className="numbered-list__body">
                  <strong>Mint is 1:1.</strong> Deposit USDC or USDT from any supported chain
                  and receive an equivalent amount of PUSD on Push Chain — no haircut, no
                  slippage, no rebase. Bridging, approval, and deposit collapse into a
                  single universal transaction via the Push Chain SDK.
                </div>
              </div>
              <div className="numbered-list__item">
                <div className="numbered-list__num">02</div>
                <div className="numbered-list__body">
                  <strong>Redemption is redemption.</strong> Burn PUSD and take a reserve
                  out of the book at par, minus a fixed redemption fee. When preferred
                  liquidity is thin, opt into a <em>basket</em> that draws proportionally
                  from every reserve — the protocol never silently rejects a holder.
                </div>
              </div>
              <div className="numbered-list__item">
                <div className="numbered-list__num">03</div>
                <div className="numbered-list__body">
                  <strong>The book is on-chain.</strong> Every token, every balance,
                  every status change is a contract read — you don't have to trust a
                  dashboard. The collateral ratio above is computed live from the
                  PUSDManager contract and refreshes every twelve seconds.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================ §02 · PROOF OF RESERVES */}
        <section className="section">
          <div className="section__header">
            <span>§ 02 · PROOF OF RESERVES</span>
            <span>
              LIVE ·{' '}
              {reserves.updatedAt ? `UPDATED ${formatRelative(reserves.updatedAt)}` : '—'}
            </span>
          </div>

          <div className="book">
            <div>
              <h2 className="book__title">
                The <em>book.</em>
              </h2>
              <div className="book__sub">
                Every token PUSDManager currently holds. Balances shown in native decimals;
                shares are computed over reserves normalized to PUSD precision. Status
                drives what mint and redeem flows are allowed per-asset.
              </div>
            </div>
            <div className="book__totals">
              <span className="book__totals-value">
                {formatAmount(reserves.totalReserves, 6, { maxFractionDigits: 0 })}
              </span>
              <div className="book__totals-label">GROSS RESERVES · USD · 6DP</div>
            </div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>ASSET</th>
                <th>CHAIN</th>
                <th>ADDRESS</th>
                <th className="num">BALANCE</th>
                <th className="num">SHARE</th>
                <th style={{ width: '22%' }}>DISTRIBUTION</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {reserves.loading && reserves.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--c-ink-mute)' }}>
                    Reading token balances from PUSDManager…
                  </td>
                </tr>
              ) : reserves.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--c-ink-mute)' }}>
                    No tokens currently registered. When an operator adds reserve assets,
                    they will show up here.
                  </td>
                </tr>
              ) : (
                reserves.rows.map((r, i) => {
                  const widthPct = topPct > 0 ? Math.max(3, (r.pctOfReserves / topPct) * 100) : 0;
                  return (
                    <tr key={r.address}>
                      <td>
                        <TokenPill symbol={r.symbol} chainShort={r.chainShort} size="sm" />
                      </td>
                      <td className="mono">{r.chainLabel}</td>
                      <td className="addr">
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
                      <td>
                        <div className="dist" aria-label={`Share ${r.pctOfReserves.toFixed(2)}%`}>
                          <div
                            className={`dist__fill ${i === 0 ? 'dist__fill--accent' : ''}`}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </td>
                      <td className={`status ${STATUS_CLASS[r.status] ?? ''}`}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          <div className="book-footer">
            <div>
              <div className="book-footer__label">INVARIANT I-01</div>
              <div className="book-footer__value">
                Σ RESERVES {reserves.totalReserves >= totalSupply ? '≥' : '<'} TOTAL PUSD
              </div>
            </div>
            <div>
              <div className="book-footer__label">SURPLUS</div>
              <div className="book-footer__value">
                {formatAmount(surplus, 6, { maxFractionDigits: 0 })} USD
              </div>
            </div>
            <div>
              <div className="book-footer__label">ACCRUED FEES</div>
              <div className="book-footer__value">
                {stats.loading
                  ? '…'
                  : `${formatAmount(stats.accruedFeesTotal, 6, { maxFractionDigits: 0 })} USD`}
              </div>
            </div>
            <div>
              <div className="book-footer__label">LAST AUDIT</div>
              <div className="book-footer__value">Pre-audit · Deployment 2</div>
            </div>
          </div>

          {reserves.error && (
            <div className="feedback feedback--error" style={{ marginTop: 16 }}>
              <div className="feedback__title">RPC ERROR</div>
              <div className="mono">{reserves.error.message}</div>
            </div>
          )}
        </section>

        {/* ============================================ §03 · MANIFESTO ====== */}
        <section className="section">
          <div className="section__header">
            <span>§ 03 · DESIGN</span>
            <span>THREE PRINCIPLES · NOT FOUR</span>
          </div>
          <div className="manifesto">
            <div className="manifesto__col">
              <div className="manifesto__numeral">I.</div>
              <h3 className="manifesto__title">Boring is the feature.</h3>
              <p className="manifesto__body">
                PUSD does not rehypothecate, rebase, or yield-farm its reserves.
                Every dollar is held as a plain ERC-20 inside PUSDManager. The
                interesting surface area is at the <em>edges</em> — mint, redeem,
                and movement — not in the middle.
              </p>
            </div>
            <div className="manifesto__col">
              <div className="manifesto__numeral">II.</div>
              <h3 className="manifesto__title">Universal by construction.</h3>
              <p className="manifesto__body">
                A user on Ethereum doesn't bridge, then approve, then deposit.
                They sign once. The Push Chain SDK handles the route — source
                chain → CEA → Push Chain — atomically. The chain of origin is
                a routing detail, not a user concern.
              </p>
            </div>
            <div className="manifesto__col">
              <div className="manifesto__numeral">III.</div>
              <h3 className="manifesto__title">Preferred, basket, emergency.</h3>
              <p className="manifesto__body">
                Redemption modes are a design language. <em>Preferred</em> is
                the normal path. <em>Basket</em> is the graceful degradation
                when preferred liquidity is short. <em>Emergency</em> is the
                lever pulled when an asset status flips — always by policy,
                never by surprise.
              </p>
            </div>
          </div>
        </section>

        {/* ============================================ §04 · DISPATCH ====== */}
        <section className="section">
          <div className="section__header">
            <span>§ 04 · DISPATCH</span>
            <span>LIVE · ~2,000 BLOCK WINDOW</span>
          </div>
          <DispatchFeed />
        </section>
      </div>
    </>
  );
}

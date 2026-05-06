/**
 * HomePage — editorial home (/).
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

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChestTrigger } from "../components/ChestTrigger";
import { ConvertPanel } from "../components/ConvertPanel";
import { DispatchFeed } from "../components/DispatchFeed";
import { PiggyTrigger } from "../components/PiggyTrigger";
import { PromiseCurtain } from "../components/PromiseCurtain";
import { ProofTypewriter } from "../components/ProofTypewriter";
import { SloganBand } from "../components/SloganBand";
import { SplashOverlay } from "../components/SplashOverlay";
import { Ticker } from "../components/Ticker";
import { TokenPill } from "../components/TokenPill";
import { YieldSection } from "../components/YieldSection";
import { useCountUp } from "../hooks/useCountUp";
import { usePUSDBalance } from "../hooks/usePUSDBalance";
import { useProtocolStats } from "../hooks/useProtocolStats";
import { useReserves } from "../hooks/useReserves";
import { useVaultBook } from "../hooks/useVaultBook";
import {
  explorerAddress,
  formatAmount,
  formatPct,
  formatRelative,
  formatShortAmount,
  truncAddr,
} from "../lib/format";

const STATUS_LABEL: Record<string, string> = {
  ENABLED: "ENABLED",
  REDEEM_ONLY: "REDEEM ONLY",
  EMERGENCY_REDEEM: "EMERGENCY",
  REMOVED: "REMOVED",
};

const STATUS_CLASS: Record<string, string> = {
  ENABLED: "status--enabled",
  REDEEM_ONLY: "status--redeemonly",
  EMERGENCY_REDEEM: "status--emergency",
  REMOVED: "status--removed",
};

type HomeView = 'pusd' | 'plus';

export default function HomePage() {
  const reserves = useReserves();
  const { totalSupply, loading: supplyLoading } = usePUSDBalance();
  const stats = useProtocolStats();
  const vaultBook = useVaultBook();

  const [searchParams, setSearchParams] = useSearchParams();
  // PUSD+ is the headline product on the home page — it's what we lead with.
  // PUSD remains a click away.
  const initialView: HomeView = searchParams.get('view') === 'pusd' ? 'pusd' : 'plus';
  const [view, setViewState] = useState<HomeView>(initialView);
  const setView = (next: HomeView) => {
    setViewState(next);
    const sp = new URLSearchParams(searchParams);
    if (next === 'pusd') sp.set('view', 'pusd');
    else sp.delete('view');
    setSearchParams(sp, { replace: true });
  };

  // Promise curtain progress (0 = closed/PUSD, 1 = open/PUSD+). Drives the
  // opacity of the §01 header tagline so it fades in lock-step with the
  // sliding curtain content.
  const [promiseOpen, setPromiseOpen] = useState(0);

  // §02 swap state. The Book (proof of reserves) and The Yield (PUSD+ peek)
  // share the same slot — clicking the piggy bank or the chest fires the
  // splash overlay and toggles which view is mounted.
  const [proofView, setProofView] = useState<'book' | 'yield'>('book');
  const [splash, setSplash] = useState<{
    origin: { x: number; y: number };
    direction: 'out' | 'in';
  } | null>(null);

  // Section visibility while a splash is in flight. Goes 1 → 0 as the
  // coins burst (matched to the splash's first half), the view swaps at
  // peak while the section is invisible, then 0 → 1 as coins fade. The
  // crossfade rides on top of the coin shower so the swap is masked.
  const [proofFaded, setProofFaded] = useState(false);

  // Memoize the splash callbacks so SplashOverlay's useEffect doesn't see
  // them as new every render — otherwise the timers restart and the peak
  // fires repeatedly, ping-ponging the view back to its original state.
  // Piggy → 'out' (coins burst from broken piggy). Chest → 'in' (coins
  // collected back into the open chest).
  const triggerToYield = useCallback((origin: { x: number; y: number }) => {
    setSplash({ origin, direction: 'out' });
    setProofFaded(true);
  }, []);
  const triggerToBook = useCallback((origin: { x: number; y: number }) => {
    setSplash({ origin, direction: 'in' });
    setProofFaded(true);
  }, []);
  const onSplashPeak = useCallback(() => {
    setProofView((v) => (v === 'book' ? 'yield' : 'book'));
    setProofFaded(false);
  }, []);
  const onSplashDone = useCallback(() => {
    setSplash(null);
    setProofFaded(false);
  }, []);

  // Top distribution share — used to scale the per-row bar width so it reads
  // as a proportion of the leading position, not of the whole.
  const topPct = useMemo(
    () =>
      reserves.rows.reduce((m, r) => Math.max(m, r.pctOfReserves), 0) || 100,
    [reserves.rows],
  );

  const chainsCount = useMemo(() => {
    const set = new Set<string>();
    for (const r of reserves.rows) set.add(r.chain);
    return set.size;
  }, [reserves.rows]);

  const surplus =
    reserves.totalReserves > totalSupply
      ? reserves.totalReserves - totalSupply
      : 0n;
  const collateralRatio = formatPct(reserves.totalReserves, totalSupply, 2);

  // Count-up on mount for the supply big number.
  const supplyCounted = useCountUp(totalSupply);

  const ratioClass = (() => {
    if (totalSupply === 0n) return "stat__sub--delta-up";
    if (reserves.totalReserves < totalSupply) return "stat__sub--delta-down";
    // >= 0.01% surplus → up; tight → default mute.
    const threshold = totalSupply / 10_000n;
    return surplus >= threshold ? "stat__sub--delta-up" : "";
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
                <span>{view === 'pusd' ? 'PAR-BACKED · UPGRADE-GATED · AUDIT-FIRST' : 'YIELD-BEARING · NAV-PER-SHARE · PERMISSIONLESS'}</span>
              </div>

              {/* Mono toggle sits between the kicker and the title — black on
               * cream, deliberately uncoloured to keep the magenta budget
               * for the title's italic accent. PUSD+ leads. */}
              <div
                className="home-toggle"
                role="tablist"
                aria-label="Home view"
                style={{ margin: '16px 0 20px' }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'plus'}
                  className={`home-toggle__btn ${view === 'plus' ? 'home-toggle__btn--active' : ''}`}
                  onClick={() => setView('plus')}
                >
                  PUSD+ <span className="home-toggle__tag">YIELD · NAV</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'pusd'}
                  className={`home-toggle__btn ${view === 'pusd' ? 'home-toggle__btn--active' : ''}`}
                  onClick={() => setView('pusd')}
                >
                  PUSD <span className="home-toggle__tag">PAR · 1:1</span>
                </button>
              </div>
              <h1 className="hero__title">
                {view === 'pusd' ? (
                  <>A dollar that works on <em>every</em> chain.</>
                ) : (
                  <>A dollar that <em>grows</em> while it sits.</>
                )}
              </h1>
              <p className="hero__lead">
                <ProofTypewriter
                  key={view}
                  phrases={
                    view === 'pusd'
                      ? [
                          'Ethereum, Solana, BNB, Base and more.',
                          'Backed, not printed.',
                          'Every dollar, every chain, every status is on-chain.',
                          'Mint 1:1. Redeem at par. No rebases.',
                          'The book is the source of truth.',
                        ]
                      : [
                          'NAV per share, monotonic non decreasing.',
                          'Yield from real Uniswap V3 stable pairs.',
                          'Mint with any reserve, or wrap PUSD in one call.',
                          'Redeem cascades: instant, basket, queue.',
                          'Permissionless rebalance after a one hour cooldown.',
                        ]
                  }
                />
              </p>
              <p className="hero__lead">
                {view === 'pusd' ? (
                  <>
                    PUSD is a <em>par-backed</em> universal stablecoin on Push
                    Chain. Deposit <b>USDC</b> or <b>USDT</b> from any chain
                    and mint PUSD 1:1. <br />
                    <br />
                    <em>Always backed</em>. Redeem into USDC or USDT anytime
                    on the chain of your choice.
                  </>
                ) : (
                  <>
                    PUSD<em>+</em> is the <em>yield-bearing</em> sidecar over
                    PUSD reserves. Mint with any reserve token (or wrap PUSD)
                    and the vault deploys a slice into Uniswap V3 stable
                    pairs.<br />
                    <br />
                    <em>NAV-per-share</em>, monotonic non-decreasing. Redeem
                    cascades through instant → basket → queue.
                  </>
                )}
              </p>
            </div>
            <div className="hero__right">
              <ConvertPanel />
            </div>
          </div>
        </div>
      </section>

      {/* ===================================================== STAT STRIP =====
       * Full-bleed band, edge-to-edge. Always shows the same four stats
       * (two for PUSD, two for PUSD+) regardless of which narrative view is
       * selected — both products live next to each other on the page. */}
      <section className="home-stat-band">
        <div className="home-stat-band__inner">
          <div className="stat">
            <div className="stat__label">PUSD CIRCULATION</div>
            <div className="stat__value">
              {supplyLoading ? "…" : formatShortAmount(supplyCounted, 6)}{" "}
              <em>PUSD</em>
            </div>
            <div className="stat__sub">TOTAL SUPPLY · 6 DECIMALS</div>
          </div>
          <div className="stat">
            <div className="stat__label">PUSD COLLATERAL RATIO</div>
            <div className="stat__value">
              {reserves.loading || supplyLoading ? "…" : collateralRatio}
            </div>
            <div className={`stat__sub ${ratioClass}`}>
              RESERVES ≥ SUPPLY
            </div>
          </div>
          <div className="stat">
            <div className="stat__label">PUSD+ SUPPLY</div>
            <div className="stat__value">
              {vaultBook.loading
                ? "…"
                : formatShortAmount(vaultBook.plusTotalSupply, 6)}{" "}
              <em>PUSD+</em>
            </div>
            <div className="stat__sub">CIRCULATING · YIELD-BEARING</div>
          </div>
          <div className="stat">
            <div className="stat__label">PUSD+ NAV</div>
            <div className="stat__value" style={{ color: 'var(--c-magenta)' }}>
              {vaultBook.pusdPerPlus.toFixed(6)}
            </div>
            <div className="stat__sub">PUSD PER PUSD+ · MONOTONIC</div>
          </div>
        </div>
      </section>

      {/* ========================================================== TICKER ===== */}
      <Ticker />

      {/* ===================================================== SLOGAN BAND ===== */}
      <SloganBand />

      {/* ============================================ §01 · THE PROMISE =====
       * Curtain mechanism (variant A from the preview): PUSD covers the
       * section by default; pull the magenta drag-tab to reveal PUSD+ on
       * the same canvas. Both layers reuse the same `.promise-grid` and
       * `.numbered-list` markup — visual design is unchanged. */}
      <div className="container">
        <section className="section">
          <div className="section__header" style={{ overflow: "hidden" }}>
            <span>§ 01 · THE PROMISE</span>
            {/* Two stacked taglines crossfade with the curtain progress.
             * The PUSD line fades out as the curtain pulls aside; the PUSD+
             * line fades in. Position absolute so they share the same slot. */}
            <span style={{ position: 'relative', display: 'inline-block', minWidth: '34ch' }}>
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  textAlign: 'right',
                  opacity: 1 - promiseOpen,
                  transition: 'opacity 240ms ease-out',
                }}
              >
                REDEEMABLE · RULES-BASED · REVERSIBLE
              </span>
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  textAlign: 'right',
                  opacity: promiseOpen,
                  transition: 'opacity 240ms ease-out',
                  color: 'var(--c-magenta)',
                }}
              >
                YIELD-BEARING · MONOTONIC · PERMISSIONLESS
              </span>
              {/* Reserve baseline width with an invisible spacer */}
              <span style={{ visibility: 'hidden' }}>
                YIELD-BEARING · MONOTONIC · PERMISSIONLESS
              </span>
            </span>
          </div>
          <PromiseCurtain
            onProgress={setPromiseOpen}
            front={
              <div className="promise-grid">
                <p className="promise-grid__quote">
                  Every PUSD is a dollar.
                  <em>Not a bet.</em>
                </p>
                <div className="numbered-list">
                  <div className="numbered-list__item">
                    <div className="numbered-list__num">01</div>
                    <div className="numbered-list__body">
                      <strong>Mint is 1:1.</strong> Deposit USDC or USDT from any
                      supported chain and receive an equivalent amount of PUSD on
                      Push Chain. No haircut, no slippage, no rebase. Bridging,
                      approval, and deposit collapse into a single universal
                      transaction via the Push Chain SDK.
                    </div>
                  </div>
                  <div className="numbered-list__item">
                    <div className="numbered-list__num">02</div>
                    <div className="numbered-list__body">
                      <strong>Redemption is redemption.</strong> Burn PUSD and take
                      a reserve out of the book at par, minus a fixed redemption
                      fee. When preferred liquidity is thin, opt into a{" "}
                      <em>basket</em> that draws proportionally from every reserve. The protocol will always redeem.
                    </div>
                  </div>
                  <div className="numbered-list__item">
                    <div className="numbered-list__num">03</div>
                    <div className="numbered-list__body">
                      <strong>The book is on-chain.</strong> Every token, every
                      balance, every status change is a contract read. You don't
                      have to trust a dashboard. The collateral ratio above is
                      computed live from the PUSDManager contract and refreshes
                      every few seconds.
                    </div>
                  </div>
                </div>
              </div>
            }
            back={
              <div className="promise-grid">
                <p className="promise-grid__quote">
                  Every PUSD+ grows.
                  <em>Not a rebase.</em>
                </p>
                <div className="numbered-list">
                  <div className="numbered-list__item">
                    <div className="numbered-list__num">01</div>
                    <div className="numbered-list__body">
                      <strong>NAV per share, monotonic non decreasing.</strong>{' '}
                      Each rebalance harvests Uniswap V3 stable pair fees and
                      re prices PUSD+ upward. Holders keep the same number of
                      tokens; their PUSD claim grows. No rebase, no synthetic
                      share dilution.
                    </div>
                  </div>
                  <div className="numbered-list__item">
                    <div className="numbered-list__num">02</div>
                    <div className="numbered-list__body">
                      <strong>Tier cascaded redeem.</strong> Burn PUSD+ at
                      current NAV and walk three tiers: instant where the vault
                      has idle PUSD, same tx basket conversion next, FIFO queue
                      last. Preferred asset payouts route through the manager
                      so users always get a real reserve token, never a
                      synthetic one.
                    </div>
                  </div>
                  <div className="numbered-list__item">
                    <div className="numbered-list__num">03</div>
                    <div className="numbered-list__body">
                      <strong>Permissionless rebalance.</strong> The keeper
                      drives yield in the steady state, but anyone can call{' '}
                      <em>rebalance()</em> after a 1h cooldown, so a keeper
                      outage does not pause harvest. NAV stays a contract read;
                      the chart on the right is live event data.
                    </div>
                  </div>
                </div>
              </div>
            }
          />
        </section>

        {/* ============================================ §02 · PROOF / YIELD
         * Same slot, two views — clicking the piggy on the book swaps to
         * the yield peek; clicking the chest on the yield swaps back. The
         * splash overlay covers the swap so React can rebuild the subtree
         * without the user seeing a flash of unstyled state. */}
        <div
          style={{
            opacity: proofFaded ? 0 : 1,
            transition: 'opacity 620ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
        {proofView === 'yield' ? (
          <YieldSection trigger={<ChestTrigger onTrigger={triggerToBook} />} />
        ) : (
        <section className="section">
          <div className="section__header">
            <span>§ 02 · PROOF OF RESERVES</span>
            <span>
              LIVE ·{" "}
              {reserves.updatedAt
                ? `UPDATED ${formatRelative(reserves.updatedAt)}`
                : "—"}
            </span>
          </div>

          <div className="book">
            <div>
              <h2 className="book__title">
                The <em>book.</em>
              </h2>
              <div className="book__sub">
                Every token PUSD Manager currently holds. Balances shown in
                native decimals; shares are computed over reserves normalized to
                PUSD precision. Status drives what mint and redeem flows are
                allowed per-asset.
              </div>
            </div>
            <div className="book__totals">
              <span className="book__totals-value">
                {formatAmount(reserves.totalReserves, 6, {
                  maxFractionDigits: 0,
                })}
              </span>
              <div className="book__totals-label">
                GROSS RESERVES · USD · 6DP
              </div>
            </div>
            {/* Trigger spans both columns in its own grid row, right-aligned
             * so it sits below the gross-reserves total without crowding the
             * left column. Stacks naturally on narrow viewports. */}
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <PiggyTrigger onTrigger={triggerToYield} />
            </div>
          </div>

          {/* Responsive book table.
           *
           * Visible columns by viewport:
           *   ≥721px : ASSET · CHAIN · ADDRESS · BALANCE · SHARE · DISTRIBUTION · STATUS
           *   ≤720px : ASSET · BALANCE · SHARE · STATUS         (CHAIN, ADDRESS, DISTRIBUTION dropped — `cell-md-up`)
           *   ≤380px : ASSET · BALANCE · STATUS                 (SHARE also dropped — `cell-sm-up`)
           *
           * Wrapped in `.table-wrap` so the very rare row whose token pill
           * still overflows can scroll horizontally rather than break the
           * page layout. */}
          <div className="table-wrap">
            <table className="table table--responsive">
              <thead>
                <tr>
                  <th>ASSET</th>
                  <th className="cell-md-up">CHAIN</th>
                  <th className="cell-md-up">ADDRESS</th>
                  <th className="num">BALANCE</th>
                  <th className="num cell-sm-up">SHARE</th>
                  <th className="cell-md-up" style={{ width: "22%" }}>DISTRIBUTION</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {reserves.loading && reserves.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{
                        textAlign: "center",
                        padding: 40,
                        color: "var(--c-ink-mute)",
                      }}
                    >
                      Reading token balances from PUSDManager…
                    </td>
                  </tr>
                ) : reserves.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{
                        textAlign: "center",
                        padding: 40,
                        color: "var(--c-ink-mute)",
                      }}
                    >
                      No tokens currently registered. When an operator adds
                      reserve assets, they will show up here.
                    </td>
                  </tr>
                ) : (
                  reserves.rows.map((r, i) => {
                    const widthPct =
                      topPct > 0
                        ? Math.max(3, (r.pctOfReserves / topPct) * 100)
                        : 0;
                    return (
                      <tr key={r.address}>
                        <td>
                          <TokenPill
                            symbol={r.symbol}
                            chainShort={r.chainShort}
                            size="sm"
                          />
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
                        <td className="num">
                          {formatAmount(r.balance, r.decimals)}
                        </td>
                        <td className="num cell-sm-up">{r.pctOfReserves.toFixed(2)}%</td>
                        <td className="cell-md-up">
                          <div
                            className="dist"
                            aria-label={`Share ${r.pctOfReserves.toFixed(2)}%`}
                          >
                            <div
                              className={`dist__fill ${i === 0 ? "dist__fill--accent" : ""}`}
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                        </td>
                        <td className={`status ${STATUS_CLASS[r.status] ?? ""}`}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="book-footer">
            <div>
              <div className="book-footer__label">INVARIANT I-01</div>
              <div className="book-footer__value">
                Σ RESERVES {reserves.totalReserves >= totalSupply ? "≥" : "<"}{" "}
                TOTAL PUSD
              </div>
            </div>
            <div>
              <div className="book-footer__label">SURPLUS</div>
              <div className="book-footer__value">
                {formatAmount(surplus, 6, { maxFractionDigits: 2 })} USD
              </div>
            </div>
            <div>
              <div className="book-footer__label">ACCRUED FEES</div>
              <div className="book-footer__value">
                {stats.loading
                  ? "…"
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
        )}
        </div>

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
                PUSD doesn't rehypothecate, the risk is contained to you getting a stablecoin on a different chain in times of emergency.<br /><br />Your coins are always backed by either USDT or USDC.
                
              </p>
            </div>
            <div className="manifesto__col">
              <div className="manifesto__numeral">II.</div>
              <h3 className="manifesto__title">Universal by construction.</h3>
              <p className="manifesto__body">
                A user on Ethereum doesn't bridge, then approve, then deposit.
                They sign once. The Push Chain SDK handles the route. The chain of origin is a
                routing detail, not a user concern.<br /><br />
                Similarly, choose a destination chain and the SDK will handle the rest in a single transaction.
              </p>
            </div>
            <div className="manifesto__col">
              <div className="manifesto__numeral">III.</div>
              <h3 className="manifesto__title">
                Safest yield generation.
              </h3>
              <p className="manifesto__body">
                <b>PUSD v2</b> introduces PUSD+, an opt-in feature that lends a portion of its reserves to Internal AMMs (Uniswap v3) of Push Chain. Swapping exclusively between stablecoins of different chains.<br /><br /><b>The Risk</b> remains the same, PUSD promise of 1:1 backing is not compromised.<br /><br /><b>The Yield</b> is distributed to PUSD+ holders.
              </p>
            </div>
          </div>
        </section>

        {/* ============================================ §04 · DISPATCH ====== */}
        <section className="section">
          <div className="section__header">
            <span>§ 04 · DISPATCH</span>
            <span>LIVE</span>
          </div>
          <DispatchFeed />
        </section>
      </div>

      {/* Splash overlay rides above everything during a §02 view swap. */}
      {splash && (
        <SplashOverlay
          origin={splash.origin}
          direction={splash.direction}
          onPeak={onSplashPeak}
          onDone={onSplashDone}
        />
      )}
    </>
  );
}

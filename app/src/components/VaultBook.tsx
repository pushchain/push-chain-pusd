/**
 * VaultBook — PUSD+ vault section on /reserves.
 *
 * Layout (top to bottom):
 *   1. Stat strip — total assets / NAV / supply / queued
 *   2. Composition bar — idle PUSD · idle reserves · deployed in LP
 *   3. NAV sparkline + APY trio (1d / 7d / 30d, derived from Rebalanced events)
 *   4. Queue stats — opened / filled / open now / median time-to-fill
 *   5. Insurance fund row — per-token + cumulative, with TVL ratio markers
 *
 * Reads use existing `useVaultBook` (RPC) + `useNAVHistory` and `useQueueStats`
 * (Blockscout events). All polling cadences are independent.
 */

import { useCountUp } from '../hooks/useCountUp';
import { useNAVHistory } from '../hooks/useNAVHistory';
import { useQueueStats } from '../hooks/useQueueStats';
import { useVaultBook } from '../hooks/useVaultBook';
import { explorerAddress, formatAmount, truncAddr } from '../lib/format';
import { Sparkline } from './Sparkline';

const IDLE_PUSD_COLOR     = 'var(--c-ink)';
const IDLE_RESERVE_COLOR  = 'var(--c-magenta)';
const DEPLOYED_COLOR      = 'var(--c-jade)';

function pct(numer: bigint, denom: bigint): number {
  if (denom === 0n) return 0;
  return Number((numer * 10_000n) / denom) / 100;
}

function formatApy(v: number | null): string {
  if (v === null || !isFinite(v)) return '—';
  // Realistic LP yields stay in single-digit %. Anything beyond 100% means
  // the APY window crossed a fresh-deployment bootstrap; render it but cap
  // visually so it doesn't dominate.
  return `${(v * 100).toFixed(2)}%`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

export function VaultBook() {
  const book = useVaultBook();
  const nav = useNAVHistory();
  const queue = useQueueStats();

  // useCountUp hooks must be invoked unconditionally before any early
  // return — keeps hook order stable when V2 isn't configured.
  const idleSum = book.basketIdle.reduce((a, s) => a + s.amountPusd, 0n);
  const totalAssetsCounted = useCountUp(book.totalAssets);
  const supplyCounted = useCountUp(book.plusTotalSupply);
  const queuedCounted = useCountUp(book.totalQueuedPusd);
  const idlePusdCounted = useCountUp(book.pusdIdle);
  const idleReservesCounted = useCountUp(idleSum);
  const deployedCounted = useCountUp(book.deployedPusd);
  const ifTotalCounted = useCountUp(book.insuranceFund.totalPusd);

  if (book.unconfigured) return null;

  const total = book.totalAssets;
  const pusdPct     = pct(book.pusdIdle, total);
  const reservesPct = pct(idleSum, total);
  const deployedPct = pct(book.deployedPusd, total);

  const sparkPoints = nav.samples.map((s) => ({ ts: s.ts, value: s.pusdPerPlus }));
  const queuedRatio = total > 0n ? Number((book.totalQueuedPusd * 10_000n) / total) / 100 : 0;

  // IF review marks from the design doc.
  const ifTvlPct =
    total > 0n ? Number((book.insuranceFund.totalPusd * 10_000n) / total) / 100 : 0;

  return (
    <>
      <section className="section">
        <div className="section__header">
          <span style={{ color: 'var(--c-magenta)' }}>§ PUSD+ VAULT</span>
          <span>YIELD-BEARING SIDECAR · NAV-PER-SHARE</span>
        </div>

        <div className="stat-strip">
          <div className="stat">
            <div className="stat__label">TOTAL ASSETS</div>
            <div className="stat__value">
              {book.loading ? '…' : formatAmount(totalAssetsCounted, 6, { maxFractionDigits: 0 })}
              <em> PUSD</em>
            </div>
            <div className="stat__sub">IDLE + DEPLOYED</div>
          </div>
          <div className="stat">
            <div className="stat__label">NAV</div>
            <div className="stat__value" style={{ color: 'var(--c-magenta)' }}>
              {book.pusdPerPlus.toFixed(6)}
            </div>
            <div className="stat__sub">PUSD PER PUSD+</div>
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
            <div className="stat__label">QUEUED</div>
            <div className="stat__value">
              {formatAmount(queuedCounted, 6, { maxFractionDigits: 0 })}
              <em> PUSD</em>
            </div>
            <div
              className={`stat__sub ${queuedRatio >= 5 ? 'stat__sub--delta-down' : ''}`}
            >
              {queuedRatio.toFixed(2)}% OF TVL
            </div>
          </div>
        </div>

        {/* Composition */}
        <div className="section__header" style={{ marginTop: 24 }}>
          <span>§ COMPOSITION</span>
          <span>WHERE THE TOTAL ASSETS LIVE</span>
        </div>

        <div className="dist-bar" role="img" aria-label="Vault composition">
          <div
            className="dist-bar__seg"
            style={{ width: `${Math.max(0.5, pusdPct)}%`, background: IDLE_PUSD_COLOR }}
            title={`Idle PUSD · ${pusdPct.toFixed(2)}%`}
          />
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
          <LegendItem color={IDLE_PUSD_COLOR} label="IDLE PUSD" pct={pusdPct} note={formatAmount(idlePusdCounted, 6, { maxFractionDigits: 0 }) + ' PUSD'} />
          <LegendItem color={IDLE_RESERVE_COLOR} label="IDLE RESERVES" pct={reservesPct} note={formatAmount(idleReservesCounted, 6, { maxFractionDigits: 0 }) + ' PUSD'} />
          <LegendItem color={DEPLOYED_COLOR} label="DEPLOYED" pct={deployedPct} note={formatAmount(deployedCounted, 6, { maxFractionDigits: 0 }) + ' PUSD'} />
        </div>

        {/* NAV history + APY */}
        <div className="section__header" style={{ marginTop: 32 }}>
          <span>§ NAV HISTORY</span>
          <span>FROM REBALANCED EVENTS · ANNUALIZED APY</span>
        </div>

        <div className="vault-nav-grid">
          <div className="vault-nav-grid__chart">
            <Sparkline
              points={sparkPoints}
              width={520}
              height={84}
              ariaLabel={`NAV over ${sparkPoints.length} rebalances`}
            />
            <div className="meta-sm" style={{ marginTop: 6 }}>
              {nav.loading
                ? 'reading rebalance events…'
                : sparkPoints.length === 0
                  ? 'No rebalances recorded yet — keeper will emit one per loop.'
                  : `${sparkPoints.length} sample${sparkPoints.length === 1 ? '' : 's'}`}
            </div>
          </div>
          <div className="vault-nav-grid__apy">
            <ApyCell label="1D" value={nav.apy1d} />
            <ApyCell label="7D" value={nav.apy7d} />
            <ApyCell label="30D" value={nav.apy30d} />
          </div>
        </div>

        {/* Queue lifecycle */}
        <div className="section__header" style={{ marginTop: 32 }}>
          <span>§ QUEUE LIFECYCLE</span>
          <span>BURNED → FILLED · CROSS-EVENT</span>
        </div>

        <div className="stat-strip">
          <div className="stat">
            <div className="stat__label">OPENED</div>
            <div className="stat__value">{queue.opened}</div>
            <div className="stat__sub">BURNEDPLUS WITH QUEUEID</div>
          </div>
          <div className="stat">
            <div className="stat__label">FILLED</div>
            <div className="stat__value">{queue.filled}</div>
            <div className="stat__sub">QUEUECLAIMFILLED</div>
          </div>
          <div className="stat">
            <div className="stat__label">OPEN NOW</div>
            <div className="stat__value">{queue.openNow}</div>
            <div className="stat__sub">UNRESOLVED</div>
          </div>
          <div className="stat">
            <div className="stat__label">TIME-TO-FILL</div>
            <div className="stat__value">
              {formatDuration(queue.timeToFillMedianMs)}
              <em> median</em>
            </div>
            <div className="stat__sub">MAX {formatDuration(queue.timeToFillMaxMs)}</div>
          </div>
        </div>
      </section>

      {/* Insurance Fund */}
      <section className="section">
        <div className="section__header">
          <span style={{ color: 'var(--c-jade)' }}>§ INSURANCE FUND</span>
          <span>HAIRCUT SKIM · SAFETY NET</span>
        </div>

        {!book.insuranceFund.address ? (
          <p style={{ color: 'var(--c-ink-mute)', padding: '24px 0' }}>
            Insurance Fund address not configured.
          </p>
        ) : (
          <>
            <div className="stat-strip">
              <div className="stat">
                <div className="stat__label">IF TOTAL</div>
                <div className="stat__value">
                  {formatAmount(ifTotalCounted, 6, { maxFractionDigits: 0 })}
                  <em> USD</em>
                </div>
                <div className="stat__sub">{ifTvlPct.toFixed(2)}% OF TVL</div>
              </div>
              <div className="stat">
                <div className="stat__label">PHASE 2 MARK</div>
                <div className="stat__value">{ifTvlPct >= 1 ? '✓' : `${ifTvlPct.toFixed(2)}%`}</div>
                <div className="stat__sub">≥ 1% TVL · 0.01% TIER UNLOCK</div>
              </div>
              <div className="stat">
                <div className="stat__label">HAIRCUT REVIEW</div>
                <div className="stat__value">{ifTvlPct >= 5 ? '✓' : `${ifTvlPct.toFixed(2)}%`}</div>
                <div className="stat__sub">≥ 5% TVL · DROP HAIRCUT</div>
              </div>
              <div className="stat">
                <div className="stat__label">ADDRESS</div>
                <div className="stat__value" style={{ fontSize: 14 }}>
                  <a
                    className="link-mono"
                    href={explorerAddress(book.insuranceFund.address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {truncAddr(book.insuranceFund.address)} ↗
                  </a>
                </div>
                <div className="stat__sub">PASSIVE TOKEN HOLDER</div>
              </div>
            </div>

            {book.insuranceFund.perToken.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table className="table table--responsive">
                  <thead>
                    <tr>
                      <th>ASSET</th>
                      <th className="num">BALANCE</th>
                      <th className="num">USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {book.insuranceFund.perToken.map((s) => (
                      <tr key={s.address}>
                        <td>
                          <strong>{s.symbol}</strong>{' '}
                          <span className="mono" style={{ color: 'var(--c-ink-mute)' }}>
                            · {s.chainShort}
                          </span>
                        </td>
                        <td className="num">{formatAmount(s.amount, s.decimals)}</td>
                        <td className="num">
                          {formatAmount(s.amountPusd, 6, { maxFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

function LegendItem({ color, label, pct, note }: { color: string; label: string; pct: number; note: string }) {
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

function ApyCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="vault-apy-cell">
      <div className="vault-apy-cell__label">APY · {label}</div>
      <div className="vault-apy-cell__value">{formatApy(value)}</div>
    </div>
  );
}

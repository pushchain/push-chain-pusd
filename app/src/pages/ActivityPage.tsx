/**
 * ActivityPage — /activity (alias /history).
 *
 * The home page's DispatchFeed surfaces 8 recent events as a teaser; this
 * page is the deep view. We pull a much longer slice (defaults to 100) of
 * the global mint/redeem stream — every wallet, every product (PUSD and
 * PUSD+) — and render them as a single chronological table.
 *
 * No connect-wallet gate: the activity here is fully public. The footer's
 * "Activity" link points here. /history is kept as an alias for legacy
 * bookmarks.
 */

import { useMemo, useState } from 'react';
import { useProtocolDispatch, type DispatchRow } from '../hooks/useProtocolDispatch';
import { useControllerAddress } from '../hooks/useControllerAddress';
import {
  explorerAddress,
  explorerTx,
  formatAmount,
  formatRelative,
  truncAddr,
} from '../lib/format';

const PAGE_SIZE = 20;

const TYPE_LABEL: Record<DispatchRow['type'], string> = {
  MINT: 'MINT',
  REDEEM: 'REDEEM',
  MINT_PLUS: 'MINT PUSD+',
  REDEEM_PLUS: 'REDEEM PUSD+',
};

const TYPE_COLOR: Record<DispatchRow['type'], string> = {
  MINT: 'var(--c-jade)',
  REDEEM: 'var(--c-oxblood)',
  MINT_PLUS: 'var(--c-magenta)',
  REDEEM_PLUS: 'var(--c-magenta)',
};

export default function ActivityPage() {
  // Pull a deep slice of recent activity. The visible window is paginated
  // client-side at PAGE_SIZE so the table stays fast even on busy days.
  const { rows, loading, error, updatedAt } = useProtocolDispatch(200);
  const [page, setPage] = useState(0);

  // Group counts for the kicker so the user sees the shape of activity at a
  // glance without scanning the table.
  const counts = useMemo(() => {
    const c = { MINT: 0, REDEEM: 0, MINT_PLUS: 0, REDEEM_PLUS: 0 } as Record<
      DispatchRow['type'],
      number
    >;
    for (const r of rows) c[r.type]++;
    return c;
  }, [rows]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);

  return (
    <>
      <section className="hero hero--compact">
        <div className="container">
          <div className="hero__kicker">
            <span>§ ACTIVITY · LIVE FEED</span>
            <span>
              {updatedAt > 0 ? `UPDATED ${formatRelative(updatedAt)}` : 'LIVE · POLLING'}
            </span>
          </div>
          <h1 className="hero__title" style={{ fontSize: 'clamp(44px, 5.5vw, 72px)' }}>
            Every mint, every <em>redeem</em>.
          </h1>
          <p className="hero__lead" style={{ maxWidth: '72ch' }}>
            The full public stream of mint and redeem activity across PUSD and
            PUSD+. The home dispatch teaser shows the first eight; this page
            shows everything the indexer has caught.
          </p>
          <div
            className="meta-sm"
            style={{ marginTop: 16, display: 'flex', gap: 18, flexWrap: 'wrap' }}
          >
            <span>
              MINT <strong>{counts.MINT}</strong>
            </span>
            <span>
              REDEEM <strong>{counts.REDEEM}</strong>
            </span>
            <span>
              MINT PUSD+ <strong>{counts.MINT_PLUS}</strong>
            </span>
            <span>
              REDEEM PUSD+ <strong>{counts.REDEEM_PLUS}</strong>
            </span>
          </div>
        </div>
      </section>

      <div className="container">
        <section className="section">
          <div className="section__header">
            <span>§ DISPATCH</span>
            <span>
              {rows.length === 0
                ? '— ENTRIES'
                : `${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} OF ${rows.length}`}
            </span>
          </div>

          {error ? (
            <div className="feedback feedback--error">
              <div className="feedback__title">RPC ERROR</div>
              <div className="mono">{error.message}</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table table--responsive">
                <thead>
                  <tr>
                    <th>TYPE</th>
                    <th className="cell-md-up">TIME</th>
                    <th className="num">AMOUNT</th>
                    <th>ASSET</th>
                    <th className="cell-sm-up">ACCOUNT</th>
                    <th>TX</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        style={{ textAlign: 'center', padding: 40, color: 'var(--c-ink-mute)' }}
                      >
                        Reading mint/redeem events…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        style={{ textAlign: 'center', padding: 40, color: 'var(--c-ink-mute)' }}
                      >
                        No activity recorded yet.
                      </td>
                    </tr>
                  ) : (
                    visible.map((r) => <Row key={`${r.txHash}:${r.logIndex}`} row={r} />)
                  )}
                </tbody>
              </table>
            </div>
          )}

          {rows.length > PAGE_SIZE && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 24,
                paddingTop: 18,
                borderTop: 'var(--rule-thin)',
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="admin-card__btn"
                style={{ opacity: safePage === 0 ? 0.4 : 1 }}
              >
                ← Newer
              </button>
              <div style={{ color: 'var(--c-ink-mute)' }}>
                Page <strong style={{ color: 'var(--c-ink)' }}>{safePage + 1}</strong> /{' '}
                {pageCount}
              </div>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                className="admin-card__btn"
                style={{ opacity: safePage >= pageCount - 1 ? 0.4 : 1 }}
              >
                Older →
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Row({ row }: { row: DispatchRow }) {
  const isMint = row.type === 'MINT' || row.type === 'MINT_PLUS';
  const isPlus = row.type === 'MINT_PLUS' || row.type === 'REDEEM_PLUS';
  const sign = isMint ? '+' : '−';
  const tokenLabel = isPlus ? 'PUSD+' : 'PUSD';
  const counterparty = isMint ? row.user : row.recipient;
  const { controller, loading } = useControllerAddress(counterparty);
  const displayAddr =
    loading || !controller?.isUEA ? counterparty : controller.address;
  const chainLabel = !loading && controller?.isUEA ? ` (${controller.chainLabel})` : '';

  return (
    <tr>
      <td>
        <span
          className="display"
          style={{
            color: TYPE_COLOR[row.type],
            fontWeight: 500,
            fontSize: 14,
          }}
        >
          {TYPE_LABEL[row.type]}
        </span>
      </td>
      <td className="mono cell-md-up">
        {row.timestamp > 0 ? formatRelative(row.timestamp * 1000) : '—'}
      </td>
      <td className="num">
        <div>
          {sign}
          {formatAmount(row.pusdAmount, 6)} {tokenLabel}
        </div>
        {row.tokenAmount > 0n && (
          <div className="meta-sm" style={{ marginTop: 2 }}>
            {isMint ? 'from' : '→'} {formatAmount(row.tokenAmount, row.asset.decimals)}{' '}
            {row.asset.symbol}
          </div>
        )}
      </td>
      <td>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
          <strong>{row.asset.symbol}</strong>
          <span className="mono" style={{ color: 'var(--c-ink-mute)', fontSize: 11 }}>
            · {row.asset.chainShort}
          </span>
        </span>
      </td>
      <td className="addr cell-sm-up">
        <a
          className="link-mono"
          href={explorerAddress(displayAddr)}
          target="_blank"
          rel="noreferrer"
        >
          {truncAddr(displayAddr)}
        </a>
        {chainLabel}
      </td>
      <td className="addr">
        <a className="link-mono" href={explorerTx(row.txHash)} target="_blank" rel="noreferrer">
          {row.txHash.slice(0, 8)}… ↗
        </a>
      </td>
    </tr>
  );
}

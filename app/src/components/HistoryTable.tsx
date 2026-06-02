/**
 * HistoryTable — connected account's MINT / REDEEM activity.
 *
 * Columns: TYPE · TIME · AMOUNT · ASSET · TX
 * MINT rows are jade, REDEEM rows are oxblood.
 */

import type { HistoryRow } from '../hooks/useUserHistory';
import { analytics } from '../lib/analytics';
import { explorerTx, formatAmount, formatRelative, truncHash } from '../lib/format';
import { TokenPill } from './TokenPill';

// Shared with ActivityPage / DispatchFeed so every activity surface labels
// the four event types identically.
const TYPE_LABEL: Record<HistoryRow['type'], string> = {
  MINT: 'MINT',
  REDEEM: 'REDEEM',
  MINT_PLUS: 'MINT PUSD+',
  REDEEM_PLUS: 'REDEEM PUSD+',
};

export function HistoryTable({ rows, loading }: { rows: HistoryRow[]; loading: boolean }) {
  if (loading && rows.length === 0) {
    return (
      <div className="empty">
        <div className="empty__glyph">…</div>
        <div className="empty__title">SCANNING BLOCKS</div>
        <div className="empty__sub">Reading Deposited / Redeemed events from Blockscout.</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="empty">
        <div className="empty__glyph">∅</div>
        <div className="empty__title">NO ACTIVITY YET</div>
        <div className="empty__sub">
          Head to{' '}
          <a
            className="link-mono"
            href="/convert/mint"
            onClick={() => analytics.event('nav_click', { to: '/convert/mint', label: 'MINT', surface: 'dashboard_empty' })}
          >
            /mint
          </a>{' '}
          or{' '}
          <a
            className="link-mono"
            href="/convert/redeem"
            onClick={() => analytics.event('nav_click', { to: '/convert/redeem', label: 'REDEEM', surface: 'dashboard_empty' })}
          >
            /redeem
          </a>{' '}
          to get started.
        </div>
      </div>
    );
  }

  return (
    <div className="table-wrap">
    <table className="table table--responsive">
      <thead>
        <tr>
          <th>TYPE</th>
          <th className="cell-sm-up">TIME</th>
          <th className="num">AMOUNT</th>
          <th>ASSET</th>
          <th>TX</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isMint = r.type === 'MINT' || r.type === 'MINT_PLUS';
          const isPlus = r.type === 'MINT_PLUS' || r.type === 'REDEEM_PLUS';
          const pusdSign = isMint ? '+' : '−';
          const typeColor = isPlus
            ? 'var(--c-magenta)'
            : isMint
              ? 'var(--c-jade)'
              : 'var(--c-oxblood)';
          const tokenLabel = isPlus ? 'PUSD+' : 'PUSD';
          const typeLabel = TYPE_LABEL[r.type];
          const pusdStr = formatAmount(r.pusdAmount, 6);
          const pusdHasEpsilon = pusdStr.startsWith('<') || pusdStr.startsWith('>');

          return (
            <tr key={`${r.txHash}:${r.logIndex}`}>
              <td>
                <span className="display" style={{ color: typeColor, fontWeight: 500, fontSize: 14 }}>
                  {typeLabel}
                </span>
              </td>
              <td className="mono cell-sm-up">
                {r.timestamp > 0 ? formatRelative(r.timestamp * 1000) : '—'}
              </td>
              <td className="num">
                <div>
                  {pusdHasEpsilon ? pusdStr : `${pusdSign}${pusdStr}`} {tokenLabel}
                </div>
                {r.type === 'REDEEM' && (
                  <div className="meta-sm" style={{ marginTop: 2 }}>
                    → {formatAmount(r.tokenAmount, r.asset.decimals)} {r.asset.symbol}
                  </div>
                )}
                {r.type === 'MINT' && (
                  <div className="meta-sm" style={{ marginTop: 2 }}>
                    from {formatAmount(r.tokenAmount, r.asset.decimals)} {r.asset.symbol}
                  </div>
                )}
                {r.type === 'MINT_PLUS' && (
                  <div className="meta-sm" style={{ marginTop: 2 }}>
                    from {formatAmount(r.tokenAmount, r.asset.decimals)} {r.asset.symbol}
                  </div>
                )}
                {r.type === 'REDEEM_PLUS' && (
                  <div className="meta-sm" style={{ marginTop: 2 }}>
                    → preferred {r.asset.symbol}
                  </div>
                )}
              </td>
              <td>
                <TokenPill symbol={r.asset.symbol} chainShort={r.asset.chainShort} size="sm" />
              </td>
              <td className="addr">
                <a
                  className="link-mono"
                  href={explorerTx(r.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() =>
                    analytics.event('explorer_link_clicked', {
                      contract: 'tx',
                      surface: 'dashboard_history_row',
                      activity_type: r.type,
                    })
                  }
                >
                  {truncHash(r.txHash)} ↗
                </a>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

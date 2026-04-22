/**
 * ReserveTable — per-token Manager balance table.
 *
 * Columns: TOKEN · CHAIN · DONUT ADDRESS · BALANCE · % · STATUS
 * Sorting: click any sortable header to toggle asc/desc. Default sort is
 * descending by normalized balance.
 */

import { useMemo, useState } from 'react';
import type { ReserveRow } from '../hooks/useReserves';
import { explorerAddress, formatAmount, truncAddr } from '../lib/format';
import { TokenPill } from './TokenPill';

type SortKey = 'symbol' | 'chain' | 'balance' | 'pct';
type SortDir = 'asc' | 'desc';

const STATUS_CLASS: Record<ReserveRow['status'], string> = {
  ENABLED: 'status--enabled',
  REDEEM_ONLY: 'status--redeemonly',
  EMERGENCY_REDEEM: 'status--emergency',
  REMOVED: '',
};

const STATUS_LABEL: Record<ReserveRow['status'], string> = {
  ENABLED: 'ENABLED',
  REDEEM_ONLY: 'REDEEM ONLY',
  EMERGENCY_REDEEM: 'EMERGENCY',
  REMOVED: 'REMOVED',
};

export function ReserveTable({ rows, loading }: { rows: ReserveRow[]; loading: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>('balance');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    const list = [...rows];
    const mult = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      switch (sortKey) {
        case 'symbol':
          return mult * a.symbol.localeCompare(b.symbol);
        case 'chain':
          return mult * a.chainLabel.localeCompare(b.chainLabel);
        case 'balance':
          if (a.balanceNormalized === b.balanceNormalized) return 0;
          return mult * (a.balanceNormalized > b.balanceNormalized ? 1 : -1);
        case 'pct':
          return mult * (a.pctOfReserves - b.pctOfReserves);
        default:
          return 0;
      }
    });
    return list;
  }, [rows, sortKey, sortDir]);

  const toggle = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'symbol' || key === 'chain' ? 'asc' : 'desc');
    }
  };

  const arrow = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  if (loading && rows.length === 0) {
    return (
      <div className="empty">
        <div className="empty__glyph">…</div>
        <div className="empty__title">LOADING RESERVES</div>
        <div className="empty__sub">Reading token balances from PUSDManager.</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="empty">
        <div className="empty__glyph">∅</div>
        <div className="empty__title">NO ACTIVE TOKENS</div>
        <div className="empty__sub">No tokens are currently marked ENABLED on this deployment.</div>
      </div>
    );
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th className="sortable" onClick={() => toggle('symbol')}>
            TOKEN{arrow('symbol')}
          </th>
          <th className="sortable" onClick={() => toggle('chain')}>
            CHAIN{arrow('chain')}
          </th>
          <th>DONUT ADDRESS</th>
          <th className="sortable num" onClick={() => toggle('balance')}>
            BALANCE{arrow('balance')}
          </th>
          <th className="sortable num" onClick={() => toggle('pct')}>
            % OF RESERVES{arrow('pct')}
          </th>
          <th>STATUS</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.address}>
            <td>
              <TokenPill symbol={r.symbol} chainShort={r.chainShort} size="sm" />
            </td>
            <td className="mono">{r.chainLabel}</td>
            <td className="addr">
              <a className="link-mono" href={explorerAddress(r.address)} target="_blank" rel="noreferrer">
                {truncAddr(r.address)}
              </a>
            </td>
            <td className="num">{formatAmount(r.balance, r.decimals)}</td>
            <td className="num">{r.pctOfReserves.toFixed(2)}%</td>
            <td className={`status ${STATUS_CLASS[r.status] ?? ''}`}>{STATUS_LABEL[r.status]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

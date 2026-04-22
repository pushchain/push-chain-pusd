/**
 * InvariantRibbon — live I-01 solvency band under the masthead.
 *
 * States: ok / warning / violation / loading (§5 of v1-frontend-plan).
 * Never sticky — scrolls with the rest of the document so the editorial
 * feel survives. Polls every 12s via `useInvariants()`.
 */

import { useEffect, useState } from 'react';
import { formatAmount, formatRelative } from '../lib/format';
import { useInvariants } from '../hooks/useInvariants';

const GLYPH: Record<string, string> = {
  ok: '■',
  warning: '▲',
  violation: '✕',
  loading: '…',
};

const GLYPH_CLASS: Record<string, string> = {
  ok: 'ribbon__glyph--ok',
  warning: 'ribbon__glyph--warn',
  violation: 'ribbon__glyph--error',
  loading: 'ribbon__glyph--loading',
};

const STATUS_LABEL: Record<string, string> = {
  ok: 'SOLVENCY OK',
  warning: 'SOLVENCY TIGHT',
  violation: 'SOLVENCY CHECK FAILED',
  loading: 'LOADING…',
};

export function InvariantRibbon() {
  const pulse = useInvariants();
  const [now, setNow] = useState(Date.now());

  // Re-render the "updated N s ago" counter every 5 seconds.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const state = pulse.state;
  const cls = `ribbon ribbon--${state}`;

  return (
    <div className={cls} role="status" aria-live="polite">
      <div className="ribbon__inner">
        <span className={`ribbon__glyph ${GLYPH_CLASS[state] ?? ''}`}>{GLYPH[state]}</span>

        <strong>{STATUS_LABEL[state]}</strong>

        {state !== 'loading' && (
          <>
            <span>
              RESERVES <strong>{formatAmount(pulse.reserves, 6)}</strong>
            </span>
            <span>
              {state === 'violation' ? '<' : '≥'} SUPPLY <strong>{formatAmount(pulse.supply, 6)}</strong>
            </span>
            <span>
              Δ{' '}
              <strong>
                {pulse.delta >= 0n ? '+' : ''}
                {formatAmount(pulse.delta, 6)}
              </strong>
            </span>
          </>
        )}

        <span style={{ marginLeft: 'auto' }}>
          UPDATED {pulse.updatedAt ? formatRelative(pulse.updatedAt, now) : '—'}
        </span>
      </div>
    </div>
  );
}

/**
 * DispatchFeed — live protocol activity cards, arranged in the 2×4 grid
 * from the Issue 01 mockup.
 *
 *   MINT   · BLOCK 4,248,116
 *   +1,000.00 PUSD issued against 1,000 USDC from Base.
 *   for 0x9e…a2F · 0s ago · haircut 0 · fee 0
 *
 * When no events are present yet (new deployment), we surface a single
 * editorial placeholder card so the grid never looks broken.
 */

import type { ReactNode } from 'react';
import { useProtocolDispatch, type DispatchRow } from '../hooks/useProtocolDispatch';
import { explorerTx, formatAmount, formatRelative, truncAddr } from '../lib/format';

function dotClass(type: DispatchRow['type']): string {
  return type === 'MINT' ? 'dispatch__dot--mint' : 'dispatch__dot--redeem';
}

function describe(row: DispatchRow): { head: string; body: ReactNode; foot: string } {
  const pusd = formatAmount(row.pusdAmount, 6, { maxFractionDigits: 2 });
  const token = formatAmount(row.tokenAmount, row.asset.decimals, { maxFractionDigits: 2 });
  const chain = row.asset.chainShort;
  const sym = row.asset.symbol;
  if (row.type === 'MINT') {
    return {
      head: 'MINT',
      body: (
        <>
          <strong>+{pusd} PUSD</strong> issued against {token} {sym} from {chain}.
        </>
      ),
      foot: `for ${truncAddr(row.recipient)} · ${formatRelative(row.timestamp * 1000)}`,
    };
  }
  return {
    head: 'REDEEM',
    body: (
      <>
        <strong>−{pusd} PUSD</strong> burned; {token} {sym} paid on {chain}.
      </>
    ),
    foot: `for ${truncAddr(row.recipient)} · ${formatRelative(row.timestamp * 1000)}`,
  };
}

export function DispatchFeed() {
  const { rows, loading, error } = useProtocolDispatch(8);

  // Pad to a multiple of 4 so the grid stays clean (at least 4 cards).
  const padded: (DispatchRow | null)[] = [...rows];
  while (padded.length < 4) padded.push(null);

  if (!loading && !error && rows.length === 0) {
    return (
      <div className="dispatch">
        <div className="dispatch__card">
          <div className="dispatch__kicker">
            <span><span className="dispatch__dot" /> NO ACTIVITY</span>
            <span>—</span>
          </div>
          <p className="dispatch__body">
            Awaiting first mint. Be the one who <em>lights the fuse</em>.
          </p>
          <div className="dispatch__foot">window: ~20,000 blocks</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dispatch">
      {padded.map((row, i) => {
        if (!row) {
          return (
            <div key={`ph-${i}`} className="dispatch__card" aria-hidden="true">
              <div className="dispatch__kicker">
                <span><span className="dispatch__dot" /> —</span>
                <span>—</span>
              </div>
              <p className="dispatch__body" style={{ color: 'var(--c-ink-mute)' }}>
                {loading ? 'Loading…' : ' '}
              </p>
              <div className="dispatch__foot">—</div>
            </div>
          );
        }
        const { head, body, foot } = describe(row);
        return (
          <div key={`${row.txHash}:${row.logIndex}`} className="dispatch__card">
            <div className="dispatch__kicker">
              <span>
                <span className={`dispatch__dot ${dotClass(row.type)}`} /> {head}
              </span>
              <span>BLOCK {row.blockNumber.toString()}</span>
            </div>
            <p className="dispatch__body">{body}</p>
            <div className="dispatch__foot">
              <a
                className="link-mono"
                href={explorerTx(row.txHash)}
                target="_blank"
                rel="noreferrer"
                style={{ letterSpacing: 'inherit' }}
              >
                {foot}
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}

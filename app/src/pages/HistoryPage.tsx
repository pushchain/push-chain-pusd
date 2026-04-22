/**
 * HistoryPage — /history route. Connected account's MINT / REDEEM activity.
 *
 * Scans the last 10,000 blocks on every load + every 30s (see
 * `useUserHistory`). Matches both `user == account` and `recipient == account`
 * so self-directed and to-recipient flows both surface.
 */

import { ConnectedGate, useIsConnected } from '../components/ConnectedGate';
import { HistoryTable } from '../components/HistoryTable';
import { useUserHistory } from '../hooks/useUserHistory';
import { usePushChainClient } from '@pushchain/ui-kit';
import { explorerAddress, formatRelative, truncAddr } from '../lib/format';
import { useEffect, useState } from 'react';

export default function HistoryPage() {
  const isConnected = useIsConnected();
  const { pushChainClient } = usePushChainClient();
  const account = pushChainClient?.universal?.account as `0x${string}` | undefined;
  const history = useUserHistory();

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  if (!isConnected) {
    return (
      <section className="section">
        <div className="section__head">
          <h2>History</h2>
          <p>Your MINT / REDEEM activity across every origin chain.</p>
        </div>
        <ConnectedGate
          title="CONNECT TO VIEW HISTORY"
          subtitle="Your Deposited + Redeemed events will appear here once authorized."
        />
      </section>
    );
  }

  return (
    <section className="section">
      <div className="section__head">
        <h2>History</h2>
        <p>
          Account{' '}
          {account && (
            <a className="link-mono" href={explorerAddress(account)} target="_blank" rel="noreferrer">
              {truncAddr(account)}
            </a>
          )}
          {' '}· last 10,000 blocks · updated {history.updatedAt ? formatRelative(history.updatedAt, now) : '—'}
        </p>
      </div>

      <HistoryTable rows={history.rows} loading={history.loading} />

      {history.error && (
        <div className="feedback feedback--error" style={{ marginTop: 16 }}>
          <div className="feedback__title">RPC ERROR</div>
          <div className="mono">{history.error.message}</div>
        </div>
      )}
    </section>
  );
}

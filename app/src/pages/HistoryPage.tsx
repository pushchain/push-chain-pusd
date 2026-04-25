/**
 * HistoryPage — /history route. Connected account's MINT / REDEEM activity.
 *
 * Scans the last 10,000 blocks on every load + every 30s (see
 * `useUserHistory`). Matches both `user == account` and `recipient == account`
 * so self-directed and to-recipient flows both surface.
 *
 * Now owns its own container since App.tsx no longer wraps routes.
 */

import { usePushChain, usePushChainClient } from '@pushchain/ui-kit';
import { useEffect, useState } from 'react';
import { ConnectedGate } from '../components/ConnectedGate';
import { HistoryTable } from '../components/HistoryTable';
import { useIsConnected } from '../hooks/useIsConnected';
import { useUserHistory } from '../hooks/useUserHistory';
import { explorerAddressForChain } from '../lib/externalRpc';
import { explorerAddress, formatRelative, truncAddr } from '../lib/format';
import { chainLabelFromKey, isPushChainKey, resolveOriginChainKey } from '../lib/wallet';

export default function HistoryPage() {
  const isConnected = useIsConnected();
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();
  const account = pushChainClient?.universal?.account as `0x${string}` | undefined;
  const origin = pushChainClient?.universal?.origin ?? null;
  const originChainKey = PushChain
    ? resolveOriginChainKey(PushChain.CONSTANTS, origin)
    : (origin?.chain ?? '');
  const originIsPush = isPushChainKey(originChainKey);
  const originChainLabel = chainLabelFromKey(originChainKey);
  const history = useUserHistory();

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  if (!isConnected) {
    return (
      <div className="container">
        <section className="section">
          <div className="section__head">
            <h2>History</h2>
            <p>Your MINT / REDEEM activity across every origin chain.</p>
          </div>
          <ConnectedGate
            title="CONNECT TO VIEW HISTORY"
            subtitle="Your Deposited + Redeemed events will appear here once authorized. Nothing is stored off-chain — this page reads PUSDManager events directly."
            links={[
              { to: '/mint', label: 'MINT →' },
              { to: '/redeem', label: 'REDEEM →' },
            ]}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="container">
      <section className="section">
        <div className="section__head">
          <h2>History</h2>
          <p>
            Account{' '}
            {account && origin?.address && !originIsPush ? (
              <>
                <a
                  className="link-mono"
                  href={explorerAddressForChain(origin.address, originChainKey)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {truncAddr(origin.address)}
                </a>
                {' '}on {originChainLabel}
                {' · On Push '}
                <a className="link-mono" href={explorerAddress(account)} target="_blank" rel="noreferrer">
                  {truncAddr(account)}
                </a>
              </>
            ) : account ? (
              <>
                <a className="link-mono" href={explorerAddress(account)} target="_blank" rel="noreferrer">
                  {truncAddr(account)}
                </a>
                {originChainLabel ? ` on ${originChainLabel}` : ''}
              </>
            ) : null}
            {' '}· full history · updated {history.updatedAt ? formatRelative(history.updatedAt, now) : '—'}
          </p>
        </div>

        <HistoryTable rows={history.rows} loading={history.loading} />

        {history.error && (
          <div className="feedback feedback--error" style={{ marginTop: 16 }}>
            <div className="feedback__title">FETCH ERROR</div>
            <div className="mono">{history.error.message}</div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * DashboardPage — /dashboard route. The connected user's home base.
 *
 *   1. Balance strip — PUSD + PUSD+ balances with quick actions, plus
 *      open queue-claim CTAs.
 *   2. History table — combined MINT / REDEEM / MINT_PLUS / REDEEM_PLUS
 *      activity from PUSDManager events.
 *
 * Pre-V2 the URL was /history; the route still resolves there via a
 * redirect in App.tsx.
 */

import { usePushChain, usePushChainClient } from '@pushchain/ui-kit';
import { useEffect, useState } from 'react';
import { BalanceStrip } from '../components/BalanceStrip';
import { ConnectedGate } from '../components/ConnectedGate';
import { HistoryTable } from '../components/HistoryTable';
import { useIsConnected } from '../hooks/useIsConnected';
import { useUserHistory } from '../hooks/useUserHistory';
import { explorerAddressForChain } from '../lib/externalRpc';
import { explorerAddress, formatRelative, truncAddr } from '../lib/format';
import { chainLabelFromKey, isPushChainKey, resolveOriginChainKey } from '../lib/wallet';

export default function DashboardPage() {
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
            <h2>Dashboard</h2>
            <p>Your PUSD + PUSD+ balances and activity, in one place.</p>
          </div>
          <ConnectedGate
            title="CONNECT TO VIEW DASHBOARD"
            subtitle="Your balances, mint/redeem activity, and any open PUSD+ queue claims will appear here once authorized. Nothing is stored off-chain — this page reads contract state directly."
            links={[
              { to: '/convert/mint', label: 'MINT →' },
              { to: '/convert/redeem', label: 'REDEEM →' },
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
          <h2>Dashboard</h2>
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
            {' '}· updated {history.updatedAt ? formatRelative(history.updatedAt, now) : '—'}
          </p>
        </div>

        <BalanceStrip />

        <div className="section__head" style={{ marginTop: 24 }}>
          <h3>Activity</h3>
          <p>Mint, redeem, and PUSD+ events from this account, newest first.</p>
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

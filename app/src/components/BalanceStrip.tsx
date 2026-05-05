/**
 * BalanceStrip — top of the dashboard.
 *
 * Two cards (PUSD, PUSD+) showing the connected user's balance + a quick
 * action. If the user has open queue claims, an inline strip below the
 * cards lets them click [CLAIM] to call `vault.fulfillQueueClaim(id)`.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePushChain, usePushChainClient } from '@pushchain/ui-kit';
import { PUSD_PLUS_ADDRESS } from '../contracts/config';
import { useNAV } from '../hooks/useNAV';
import { usePUSDBalance } from '../hooks/usePUSDBalance';
import { usePUSDPlusBalance } from '../hooks/usePUSDPlusBalance';
import { useUserQueueClaims, type QueueClaim } from '../hooks/useUserQueueClaims';
import { buildFulfillQueueClaimLeg, type HelpersLike } from '../lib/cascade';
import { formatAmount } from '../lib/format';

export function BalanceStrip() {
  const { balance: pusdBalance, loading: pusdLoading } = usePUSDBalance();
  const { balance: pusdPlusBalance, loading: pusdPlusLoading, unconfigured } = usePUSDPlusBalance();
  const nav = useNAV();
  const queue = useUserQueueClaims();
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();
  const [claiming, setClaiming] = useState<bigint | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const onClaim = async (claim: QueueClaim) => {
    if (!pushChainClient || !PushChain || !PUSD_PLUS_ADDRESS) return;
    setClaiming(claim.queueId);
    setClaimError(null);
    try {
      const helpers = PushChain.utils.helpers as unknown as HelpersLike;
      const leg = buildFulfillQueueClaimLeg(helpers, PUSD_PLUS_ADDRESS, claim.queueId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await pushChainClient.universal.sendTransaction({
        to: '0x0000000000000000000000000000000000000000',
        value: 0n,
        data: [leg],
      } as any);
      await tx.wait();
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div className="balance-strip">
      <div className="balance-strip__cards">
        <div className="balance-card">
          <div className="balance-card__head">
            <span className="balance-card__label">PUSD</span>
            <span className="balance-card__tag">PAR · 1:1</span>
          </div>
          <div className="balance-card__amount">
            {pusdLoading ? '…' : formatAmount(pusdBalance, 6, { maxFractionDigits: 6 })}
          </div>
          <div className="balance-card__actions">
            <Link to="/convert/mint" className="balance-card__action">MINT PUSD →</Link>
            <Link to="/convert/redeem" className="balance-card__action">REDEEM →</Link>
            {!unconfigured && (
              <Link to="/convert/mint?wrap=1" className="balance-card__action balance-card__action--accent">
                CONVERT TO PUSD+ →
              </Link>
            )}
          </div>
        </div>

        {!unconfigured && (
          <div className="balance-card balance-card--plus">
            <div className="balance-card__head">
              <span className="balance-card__label">PUSD+</span>
              <span className="balance-card__tag">YIELD · NAV {nav.pusdPerPlus.toFixed(6)}</span>
            </div>
            <div className="balance-card__amount">
              {pusdPlusLoading ? '…' : formatAmount(pusdPlusBalance, 6, { maxFractionDigits: 6 })}
            </div>
            <div className="balance-card__actions">
              <Link to="/convert/mint" className="balance-card__action">MINT PUSD+ →</Link>
              <Link to="/convert/redeem" className="balance-card__action">REDEEM →</Link>
              <Link to="/convert/redeem?wrap=1" className="balance-card__action balance-card__action--accent">
                CONVERT TO PUSD →
              </Link>
            </div>
          </div>
        )}
      </div>

      {queue.claims.length > 0 && (
        <div className="balance-strip__queue">
          <div className="balance-strip__queue-head">OPEN QUEUE CLAIMS</div>
          {queue.claims.map((c) => (
            <div key={c.queueId.toString()} className="claim-row">
              <span className="claim-row__id">#{c.queueId.toString()}</span>
              <span className="claim-row__amount">{formatAmount(c.pusdOwed, 6)} PUSD owed</span>
              <button
                type="button"
                className="claim-row__btn"
                onClick={() => onClaim(c)}
                disabled={claiming === c.queueId}
              >
                {claiming === c.queueId ? 'CLAIMING…' : 'CLAIM →'}
              </button>
            </div>
          ))}
          {claimError && <div className="claim-row__error">{claimError}</div>}
        </div>
      )}
    </div>
  );
}

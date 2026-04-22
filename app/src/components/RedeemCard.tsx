/**
 * RedeemCard — burn PUSD and receive a preferred token (or basket).
 *
 * BUGFIX vs. the old RedeemTab: the contract signature is
 *   redeem(uint256 pusdAmount, address preferredAsset, bool allowBasket, address recipient)
 * The old code passed only three args, so every redemption reverted. The
 * new card uses `buildRedeemLeg(... recipient = account)` from lib/cascade.
 *
 * Cascade:
 *   1. approve(PUSDManager, amount)   — PUSD ERC-20 approval
 *   2. redeem(amount, preferred, allowBasket, recipient)
 * Sent in a single `sendTransaction` call with `data: [approveLeg, redeemLeg]`.
 */

import { useMemo, useState } from 'react';
import { usePushChain, usePushChainClient } from '@pushchain/ui-kit';
import { TOKENS, type ReserveToken } from '../contracts/tokens';
import { PUSD_ADDRESS, PUSD_MANAGER_ADDRESS } from '../contracts/config';
import {
  buildApproveLeg,
  buildRedeemLeg,
  type CascadeLeg,
  type HelpersLike,
} from '../lib/cascade';
import { usePUSDBalance } from '../hooks/usePUSDBalance';
import { useProtocolStats } from '../hooks/useProtocolStats';
import { useInvariants } from '../hooks/useInvariants';
import { explorerTx, formatAmount, truncHash } from '../lib/format';
import { ConnectedGate, useIsConnected } from './ConnectedGate';
import { TokenPill } from './TokenPill';

export function RedeemCard() {
  const isConnected = useIsConnected();
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();

  const { balance: pusdBalance, loading: balLoading } = usePUSDBalance();
  const { baseFeeBps, loading: feeLoading } = useProtocolStats();
  const invariants = useInvariants();

  const [selected, setSelected] = useState<ReserveToken>(TOKENS[0]);
  const [amount, setAmount] = useState('');
  const [showSelector, setShowSelector] = useState(false);
  const [allowBasket, setAllowBasket] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse amount at PUSD decimals (6).
  const parsedAmount = useMemo(() => {
    if (!amount || !PushChain) return 0n;
    const clean = amount.trim();
    if (!/^\d*(\.\d*)?$/.test(clean) || clean === '' || clean === '.') return 0n;
    try {
      return PushChain.utils.helpers.parseUnits(clean, 6);
    } catch {
      return 0n;
    }
  }, [amount, PushChain]);

  // Preview: fee = amount * baseFeeBps / 10000
  const feeAmount = useMemo(() => {
    if (parsedAmount === 0n) return 0n;
    return (parsedAmount * BigInt(baseFeeBps)) / 10_000n;
  }, [parsedAmount, baseFeeBps]);

  const receiveAmount = parsedAmount - feeAmount;

  const amountValid = parsedAmount > 0n;
  const exceedsBalance = parsedAmount > pusdBalance;
  const solventHalt = invariants.state === 'violation';

  const handleRedeem = async () => {
    if (!pushChainClient || !PushChain) return;
    if (!amountValid || exceedsBalance || solventHalt) return;

    const account = pushChainClient.universal.account as `0x${string}` | undefined;
    if (!account) {
      setError('No universal account available on the connected wallet.');
      return;
    }

    const helpers = PushChain.utils.helpers as unknown as HelpersLike;

    setSubmitting(true);
    setError(null);
    setTxHash(null);
    setConfirmed(false);

    try {
      const approveLeg = buildApproveLeg(
        helpers,
        PUSD_ADDRESS as `0x${string}`,
        PUSD_MANAGER_ADDRESS as `0x${string}`,
        parsedAmount,
      );
      const redeemLeg = buildRedeemLeg(
        helpers,
        PUSD_MANAGER_ADDRESS as `0x${string}`,
        parsedAmount,
        selected.address,
        allowBasket,
        account,
      );

      const legs: CascadeLeg[] = [approveLeg, redeemLeg];
      // SDK types don't yet expose cascade `data: CascadeLeg[]` publicly —
      // assert the options object once so the call site stays readable.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txOptions: any = {
        to: '0x0000000000000000000000000000000000000000',
        value: 0n,
        data: legs,
      };
      const tx = await pushChainClient.universal.sendTransaction(txOptions);

      setTxHash(tx.hash as `0x${string}`);
      await tx.wait();
      setConfirmed(true);
      setAmount('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const ctaLabel = (() => {
    if (submitting && !txHash) return 'SIGNING…';
    if (submitting && txHash) return 'BROADCASTING…';
    if (solventHalt) return 'SOLVENCY CHECK FAILED — ACTIONS HALTED';
    if (!amountValid) return 'ENTER AN AMOUNT';
    if (exceedsBalance) return 'INSUFFICIENT PUSD';
    return `REDEEM ${formatAmount(parsedAmount, 6, { maxFractionDigits: 2 })} PUSD →`;
  })();

  const ctaDisabled = submitting || !amountValid || exceedsBalance || solventHalt;

  // Oxblood CTA when opting into a basket drain — visual warning that the
  // user is accepting proportional draws from all reserves.
  const ctaVariant = solventHalt
    ? 'btn--danger'
    : allowBasket
      ? 'btn--danger'
      : 'btn--primary';

  const feeRateLabel = feeLoading ? '…' : `(${(baseFeeBps / 100).toFixed(2)}%)`;

  return (
    <div className="card-shell">
      <div className="card-shell__head">
        <div>
          <h1>Redeem PUSD</h1>
          <p>Burn PUSD and receive your preferred stablecoin from reserves.</p>
        </div>
        <div className="card-shell__aside">
          <div style={{ color: 'var(--c-ink-mute)' }}>PREFERRED OUT</div>
          <strong>{selected.symbol} · {selected.chainShort}</strong>
          <div>FEE {feeRateLabel}</div>
        </div>
      </div>

      {!isConnected ? (
        <ConnectedGate
          title="CONNECT TO REDEEM"
          subtitle="Authorize a universal account to burn PUSD and withdraw reserves."
        />
      ) : (
        <>
          {/* YOU BURN */}
          <div className="input-head" style={{ marginTop: 8 }}>
            <span>YOU BURN</span>
            <button
              type="button"
              disabled={pusdBalance === 0n}
              onClick={() => {
                const whole = pusdBalance / 1_000_000n;
                const frac = pusdBalance % 1_000_000n;
                const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
                setAmount(fracStr ? `${whole}.${fracStr}` : whole.toString());
              }}
            >
              BALANCE {balLoading ? '…' : formatAmount(pusdBalance, 6, { maxFractionDigits: 6 })} PUSD · MAX
            </button>
          </div>
          <div className="input-shell">
            <input
              className="input-shell__amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={submitting}
            />
            <div className="token-pill">
              <span className="token-pill__symbol">PUSD</span>
              <span className="token-pill__chain">· PUSH</span>
            </div>
          </div>

          <div className="arrow-divider">↓</div>

          {/* YOU RECEIVE */}
          <div className="input-head">
            <span>YOU RECEIVE</span>
            <span className="meta-sm">PREFERRED · {selected.chainShort}</span>
          </div>
          <div className="input-shell">
            <div className="input-shell__amount" aria-readonly="true">
              {amountValid ? formatAmount(receiveAmount, 6, { maxFractionDigits: 6 }) : '0.00'}
            </div>
            <button
              type="button"
              className="selector-btn"
              onClick={() => setShowSelector((s) => !s)}
              disabled={submitting}
            >
              <TokenPill symbol={selected.symbol} chainShort={selected.chainShort} size="sm" />
              <span className="selector-btn__caret">▾</span>
            </button>
          </div>

          {showSelector && (
            <div className="selector-panel" role="listbox">
              {TOKENS.map((t) => {
                const active = t.address === selected.address;
                return (
                  <button
                    key={t.address}
                    type="button"
                    className={active ? 'active' : undefined}
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setSelected(t);
                      setShowSelector(false);
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <TokenPill symbol={t.symbol} chainShort={t.chainShort} size="sm" />
                      <span className="meta">{t.chainLabel}</span>
                    </div>
                    <span className="addr">{t.address.slice(0, 6)}…{t.address.slice(-4)}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Basket toggle */}
          <div
            className="toggle-row"
            role="button"
            tabIndex={0}
            onClick={() => setAllowBasket((b) => !b)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setAllowBasket((b) => !b);
              }
            }}
          >
            <div>
              <div className="toggle-row__label">BASKET MODE {allowBasket ? '[ON]' : '[OFF]'}</div>
              <div className="toggle-row__sub">
                Accept proportional draws from all reserves if the preferred token runs short.
              </div>
            </div>
            <span
              className="toggle"
              role="switch"
              aria-checked={allowBasket}
              data-active={allowBasket ? 'true' : 'false'}
            />
          </div>

          {/* Preview block */}
          <div className="summary">
            <div className="summary__row">
              <span>BURN</span>
              <strong>{formatAmount(parsedAmount, 6)} PUSD</strong>
            </div>
            <div className="summary__row">
              <span>REDEMPTION FEE {feeRateLabel}</span>
              <strong>−{formatAmount(feeAmount, 6)} PUSD</strong>
            </div>
            <div
              className="summary__row"
              title="Per-token preferred surcharges activate with v2 fee policy. v1 uses baseFee only."
            >
              <span>PREFERRED SURCHARGE</span>
              <strong className="mono">— pending</strong>
            </div>
            <div className="summary__row summary__row--total">
              <span>YOU RECEIVE</span>
              <strong>
                {formatAmount(receiveAmount, 6)} {allowBasket ? '(basket)' : selected.symbol}
              </strong>
            </div>
          </div>

          <button
            type="button"
            className={`btn btn--block ${ctaVariant}`}
            onClick={handleRedeem}
            disabled={ctaDisabled}
            style={{ marginTop: 20 }}
          >
            {ctaLabel}
          </button>

          {error && (
            <div className="feedback feedback--error" style={{ marginTop: 16 }}>
              <div className="feedback__title">TRANSACTION FAILED</div>
              <div className="mono">{error}</div>
            </div>
          )}

          {txHash && (
            <div
              className={`feedback ${confirmed ? 'feedback--success' : ''}`}
              style={{ marginTop: 16 }}
            >
              <div className="feedback__title">
                {confirmed ? 'REDEMPTION CONFIRMED' : 'BROADCASTING'}
              </div>
              <a className="link-mono" href={explorerTx(txHash)} target="_blank" rel="noreferrer">
                {truncHash(txHash)} ↗
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}

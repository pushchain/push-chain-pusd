/**
 * RedeemCard — advanced redeem flow for /redeem.
 *
 * Deployment 2 redeem signature:
 *   redeem(uint256 pusdAmount, address preferredAsset, bool allowBasket, address recipient)
 *
 * This card supports three things beyond the inline ConvertPanel:
 *   - Custom recipient (defaults to connected account).
 *   - BASKET MODE toggle — accept proportional draws when preferred liquidity is thin.
 *   - CROSS-CHAIN PAYOUT — two-step flow:
 *       step 1: standard redeem on Push Chain, preferred asset delivered to the UEA.
 *       step 2: Route 2 `sendTransaction({ to: { chain }, funds: { token } })`
 *               forwards the just-received asset to an external-chain address.
 *     UX: the user signs the first tx, we wait for confirmation, then
 *     immediately broadcast the second tx in the same visual "operation".
 */

import { useEffect, useMemo, useState } from 'react';
import { usePushChain, usePushChainClient } from '@pushchain/ui-kit';
import { TOKENS, type ReserveToken } from '../contracts/tokens';
import { PUSD_ADDRESS, PUSD_MANAGER_ADDRESS } from '../contracts/config';
import {
  buildApproveLeg,
  buildRedeemLeg,
  type CascadeLeg,
  type HelpersLike,
} from '../lib/cascade';
import { isValidAddress, resolveMoveableToken } from '../lib/wallet';
import { usePUSDBalance } from '../hooks/usePUSDBalance';
import { useProtocolStats } from '../hooks/useProtocolStats';
import { useInvariants } from '../hooks/useInvariants';
import { explorerTx, formatAmount, truncHash } from '../lib/format';
import { ConnectedGate } from './ConnectedGate';
import { useIsConnected } from '../hooks/useIsConnected';
import { TokenPill } from './TokenPill';

type Stage =
  | { kind: 'idle' }
  | { kind: 'signing' }
  | { kind: 'step1-broadcasting'; hash: `0x${string}` }
  | { kind: 'step1-confirmed'; hash: `0x${string}` }
  | { kind: 'step2-signing'; prevHash: `0x${string}` }
  | { kind: 'step2-broadcasting'; prevHash: `0x${string}`; hash: `0x${string}` }
  | { kind: 'step2-confirmed'; prevHash: `0x${string}`; hash: `0x${string}` }
  | { kind: 'error'; message: string };

export function RedeemCard() {
  const isConnected = useIsConnected();
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();
  const invariants = useInvariants();

  const account = (pushChainClient?.universal?.account ?? null) as `0x${string}` | null;

  const { balance: pusdBalance, loading: balLoading } = usePUSDBalance();
  const { baseFeeBps, loading: feeLoading } = useProtocolStats();

  const [selected, setSelected] = useState<ReserveToken>(TOKENS[0]);
  const [amount, setAmount] = useState('');
  const [showSelector, setShowSelector] = useState(false);
  const [allowBasket, setAllowBasket] = useState(false);

  // Cross-chain payout state.
  const [crossChain, setCrossChain] = useState(false);
  const [externalRecipient, setExternalRecipient] = useState('');
  const [pushRecipient, setPushRecipient] = useState<string>('');

  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  useEffect(() => {
    if (account && !pushRecipient) setPushRecipient(account);
  }, [account, pushRecipient]);

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

  // Pre-flight Route 2 check. The SDK's MOVEABLE.TOKEN table doesn't yet
  // cover every chain (notably Ethereum Sepolia on some SDK versions). If
  // it's missing, the Route 2 forward will throw "Chain X is not supported
  // for CEA operations". We detect that here so the UI can warn up front
  // and let the user still redeem on Push Chain (step 1) without forwarding.
  const crossChainSupported = useMemo(() => {
    if (!PushChain) return true; // optimistic until SDK loads
    const [chainKey, symbolKey] = selected.moveableKey;
    return resolveMoveableToken(PushChain.CONSTANTS, chainKey, symbolKey) !== undefined;
  }, [PushChain, selected.moveableKey]);

  const feeAmount = useMemo(() => {
    if (parsedAmount === 0n) return 0n;
    return (parsedAmount * BigInt(baseFeeBps)) / 10_000n;
  }, [parsedAmount, baseFeeBps]);
  const receiveAmount = parsedAmount - feeAmount;

  const amountValid = parsedAmount > 0n;
  const exceedsBalance = parsedAmount > pusdBalance;
  const solventHalt = invariants.state === 'violation';
  const pushRecipientValid = isValidAddress(pushRecipient);
  const externalRecipientValid = !crossChain || isValidAddress(externalRecipient);
  const crossChainBlocked = crossChain && !crossChainSupported;
  const submitting =
    stage.kind === 'signing' ||
    stage.kind === 'step1-broadcasting' ||
    stage.kind === 'step2-signing' ||
    stage.kind === 'step2-broadcasting';

  const handleRedeem = async () => {
    if (!pushChainClient || !PushChain || !account) return;
    if (!amountValid || exceedsBalance || solventHalt || !pushRecipientValid || !externalRecipientValid) return;

    const helpers = PushChain.utils.helpers as unknown as HelpersLike;
    const ueaTarget = pushRecipient as `0x${string}`;

    setStage({ kind: 'signing' });

    try {
      // --- STEP 1: redeem on Push Chain ---
      const legs: CascadeLeg[] = [
        buildApproveLeg(helpers, PUSD_ADDRESS as `0x${string}`, PUSD_MANAGER_ADDRESS as `0x${string}`, parsedAmount),
        buildRedeemLeg(
          helpers,
          PUSD_MANAGER_ADDRESS as `0x${string}`,
          parsedAmount,
          selected.address,
          allowBasket,
          ueaTarget,
        ),
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const step1Options: any = {
        to: '0x0000000000000000000000000000000000000000',
        value: 0n,
        data: legs,
      };

      const tx1 = await pushChainClient.universal.sendTransaction(step1Options);
      const step1Hash = tx1.hash as `0x${string}`;
      setStage({ kind: 'step1-broadcasting', hash: step1Hash });
      await tx1.wait();
      setStage({ kind: 'step1-confirmed', hash: step1Hash });

      // --- STEP 2 (optional): forward redeemed asset to external chain ---
      if (crossChain && externalRecipient) {
        setStage({ kind: 'step2-signing', prevHash: step1Hash });

        const [chainKey, symbolKey] = selected.moveableKey;
        const moveable = resolveMoveableToken(PushChain.CONSTANTS, chainKey, symbolKey);
        if (!moveable) {
          throw new Error(
            `MOVEABLE token for ${symbolKey} on ${chainKey} not found — cross-chain payout unavailable.`,
          );
        }

        // Route 2: send from Push Chain to the external chain. The universal
        // SDK moves the just-redeemed reserve token through the CEA of the
        // destination chain and delivers it to the external address.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const step2Options: any = {
          to: { address: externalRecipient as `0x${string}`, chain: chainKey },
          value: 0n,
          data: '0x',
          funds: { amount: receiveAmount, token: moveable },
        };

        const tx2 = await pushChainClient.universal.sendTransaction(step2Options);
        const step2Hash = tx2.hash as `0x${string}`;
        setStage({ kind: 'step2-broadcasting', prevHash: step1Hash, hash: step2Hash });
        await tx2.wait();
        setStage({ kind: 'step2-confirmed', prevHash: step1Hash, hash: step2Hash });
      }

      setAmount('');
    } catch (err) {
      setStage({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Transaction failed',
      });
    }
  };

  const ctaLabel = (() => {
    if (stage.kind === 'signing') return 'SIGNING STEP 1…';
    if (stage.kind === 'step1-broadcasting') return 'STEP 1 BROADCASTING…';
    if (stage.kind === 'step2-signing') return 'SIGNING STEP 2…';
    if (stage.kind === 'step2-broadcasting') return 'STEP 2 BROADCASTING…';
    if (solventHalt) return 'SOLVENCY CHECK FAILED — ACTIONS HALTED';
    if (!amountValid) return 'ENTER AN AMOUNT';
    if (exceedsBalance) return 'INSUFFICIENT PUSD';
    if (!pushRecipientValid) return 'INVALID PUSH RECIPIENT';
    if (crossChainBlocked) return `${selected.chainShort} FORWARD UNAVAILABLE — TOGGLE OFF`;
    if (crossChain && !externalRecipientValid) return 'INVALID EXTERNAL RECIPIENT';
    if (crossChain) return `REDEEM → FORWARD TO ${selected.chainShort} →`;
    return `REDEEM ${formatAmount(parsedAmount, 6, { maxFractionDigits: 2 })} PUSD →`;
  })();

  const ctaDisabled =
    submitting ||
    !amountValid ||
    exceedsBalance ||
    solventHalt ||
    !pushRecipientValid ||
    crossChainBlocked ||
    (crossChain && !externalRecipientValid);

  const ctaVariant = solventHalt ? 'btn--danger' : allowBasket ? 'btn--danger' : 'btn--primary';
  const feeRateLabel = feeLoading ? '…' : `(${(baseFeeBps / 100).toFixed(2)}%)`;

  return (
    <div className="card-shell">
      <div className="card-shell__head">
        <div>
          <h1>Redeem PUSD</h1>
          <p>Burn PUSD and receive reserves. Optionally forward the payout to any supported chain.</p>
        </div>
        <div className="card-shell__aside">
          <div style={{ color: 'var(--c-ink-mute)' }}>PREFERRED OUT</div>
          <strong>{selected.symbol} · {selected.chainShort}</strong>
          <div style={{ marginTop: 6, color: 'var(--c-ink-mute)' }}>FEE</div>
          <strong>{feeRateLabel}</strong>
        </div>
      </div>

      {!isConnected ? (
        <ConnectedGate
          title="CONNECT TO REDEEM"
          subtitle="Authorize a universal account to burn PUSD and withdraw reserves at par — preferred, basket, or forwarded to any supported chain."
          links={[
            { to: '/mint', label: 'MINT →' },
            { to: '/history', label: 'HISTORY →' },
          ]}
        />
      ) : (
        <>
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
            <TokenPill symbol="PUSD" chainShort="PUSH" size="md" />
          </div>

          <div className="arrow-divider">↓</div>

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
            <div className="selector-panel" role="listbox" style={{ marginTop: 6 }}>
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

          {/* Recipient */}
          <div className="input-head" style={{ marginTop: 16 }}>
            <span>RECIPIENT (PUSH CHAIN)</span>
            <button
              type="button"
              onClick={() => account && setPushRecipient(account)}
              disabled={!account}
            >
              USE MY ADDRESS
            </button>
          </div>
          <div className="input-row">
            <input
              type="text"
              placeholder="0x…"
              value={pushRecipient}
              onChange={(e) => setPushRecipient(e.target.value.trim())}
              disabled={submitting}
              spellCheck={false}
            />
            {pushRecipient && !pushRecipientValid && (
              <span className="input-row__hint input-row__hint--warn">
                ✕ Not a valid EVM address.
              </span>
            )}
          </div>

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
            style={{ marginTop: 14 }}
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

          {/* Cross-chain payout toggle */}
          <div
            className="toggle-row"
            role="button"
            tabIndex={0}
            onClick={() => setCrossChain((c) => !c)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setCrossChain((c) => !c);
              }
            }}
            style={{ marginTop: 12 }}
          >
            <div>
              <div className="toggle-row__label">
                RECEIVE ON {selected.chainLabel} {crossChain ? '[ON]' : '[OFF]'}
                {!crossChainSupported && (
                  <span style={{ color: 'var(--c-gold)', marginLeft: 8 }}>· SDK UNSUPPORTED</span>
                )}
              </div>
              <div className="toggle-row__sub">
                Two-step flow — redeem on Push Chain, then route the payout to an address on{' '}
                {selected.chainLabel} via Route 2.
              </div>
            </div>
            <span
              className="toggle"
              role="switch"
              aria-checked={crossChain}
              data-active={crossChain ? 'true' : 'false'}
            />
          </div>

          {crossChain && !crossChainSupported && (
            <div className="feedback feedback--warn" style={{ marginTop: 12 }}>
              <div className="feedback__title">SDK LIMITATION · {selected.chainLabel}</div>
              <div className="mono" style={{ marginTop: 4 }}>
                The Push Chain SDK on this client does not yet support CEA-routed
                payouts to <strong>{selected.chainLabel}</strong>. Route 2 forwards to
                this chain will fail with "Chain {selected.moveableKey[0]} is not
                supported for CEA operations." You can still redeem to your Push Chain
                address — toggle "RECEIVE ON {selected.chainLabel}" off, or pick a
                different preferred asset. This is not a Route 3 case (origin and
                destination chains differ — Route 2 is correct); it's a coverage gap
                in the SDK's MOVEABLE.TOKEN table for this chain.
              </div>
            </div>
          )}

          {crossChain && crossChainSupported && (
            <div className="input-row" style={{ marginTop: 12 }}>
              <div className="input-head" style={{ margin: 0 }}>
                <span>EXTERNAL RECIPIENT ({selected.chainShort})</span>
                <span>•</span>
              </div>
              <input
                type="text"
                placeholder={`Address on ${selected.chainLabel}`}
                value={externalRecipient}
                onChange={(e) => setExternalRecipient(e.target.value.trim())}
                disabled={submitting}
                spellCheck={false}
              />
              {externalRecipient && !isValidAddress(externalRecipient) && (
                <span className="input-row__hint input-row__hint--warn">
                  ✕ Not a valid EVM address.
                </span>
              )}
            </div>
          )}

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
              <span>{crossChain ? `DELIVERED TO ${selected.chainShort}` : 'YOU RECEIVE'}</span>
              <strong>
                {formatAmount(receiveAmount, 6)} {allowBasket ? '(basket)' : selected.symbol}
              </strong>
            </div>
            {crossChain && (
              <p className="summary__hint">
                Step 1: redeem lands on Push Chain (your UEA). Step 2: SDK routes the received{' '}
                {selected.symbol} via Route 2 to <strong className="mono">
                  {externalRecipient || '0x…'}
                </strong> on {selected.chainLabel}.
              </p>
            )}
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

          {stage.kind === 'error' && (
            <div className="feedback feedback--error">
              <div className="feedback__title">TRANSACTION FAILED</div>
              <div className="mono">{stage.message}</div>
            </div>
          )}
          {(stage.kind === 'step1-broadcasting' || stage.kind === 'step1-confirmed' ||
            stage.kind === 'step2-signing' || stage.kind === 'step2-broadcasting' ||
            stage.kind === 'step2-confirmed') && (
            <div className={`feedback ${stage.kind === 'step2-confirmed' || (stage.kind === 'step1-confirmed' && !crossChain) ? 'feedback--success' : ''}`}>
              <div className="feedback__title">
                STEP 1 · {stage.kind === 'step1-broadcasting' ? 'BROADCASTING' : 'CONFIRMED'}
              </div>
              <a
                className="link-mono"
                href={explorerTx('prevHash' in stage ? stage.prevHash : stage.hash)}
                target="_blank"
                rel="noreferrer"
              >
                {truncHash('prevHash' in stage ? stage.prevHash : stage.hash)} ↗
              </a>
              {(stage.kind === 'step2-signing' || stage.kind === 'step2-broadcasting' || stage.kind === 'step2-confirmed') && (
                <>
                  <div className="feedback__title" style={{ marginTop: 10 }}>
                    STEP 2 · {stage.kind === 'step2-signing' ? 'SIGNING…' : stage.kind === 'step2-broadcasting' ? 'BROADCASTING' : 'CONFIRMED'}
                  </div>
                  {(stage.kind === 'step2-broadcasting' || stage.kind === 'step2-confirmed') && (
                    <a className="link-mono" href={explorerTx(stage.hash)} target="_blank" rel="noreferrer">
                      {truncHash(stage.hash)} ↗
                    </a>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

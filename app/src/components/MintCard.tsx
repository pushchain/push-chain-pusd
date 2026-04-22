/**
 * MintCard — deposit USDC/USDT from any supported origin chain to receive PUSD.
 *
 * Cascade semantics:
 *   1. approve(PUSDManager, amount)
 *   2. deposit(token, amount, recipient)
 * Combined into a single `pushChainClient.universal.sendTransaction` call
 * with `data: [approveLeg, depositLeg]`. When the selected token maps to a
 * `MOVEABLE.TOKEN[chain][symbol]` constant, `funds` is attached so Push
 * routes the origin-chain stablecoin to the Donut-side representation.
 */

import { useMemo, useState } from 'react';
import { usePushChain, usePushChainClient } from '@pushchain/ui-kit';
import { TOKENS, type ReserveToken } from '../contracts/tokens';
import { PUSD_MANAGER_ADDRESS } from '../contracts/config';
import {
  buildApproveLeg,
  buildDepositLeg,
  type CascadeLeg,
  type HelpersLike,
} from '../lib/cascade';
import { useTokenBalance } from '../hooks/useTokenBalance';
import { useInvariants } from '../hooks/useInvariants';
import { explorerTx, formatAmount, truncHash } from '../lib/format';
import { ConnectedGate, useIsConnected } from './ConnectedGate';
import { TokenPill } from './TokenPill';

export function MintCard() {
  const isConnected = useIsConnected();
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();
  const invariants = useInvariants();

  const [selected, setSelected] = useState<ReserveToken>(TOKENS[0]);
  const [amount, setAmount] = useState('');
  const [showSelector, setShowSelector] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { balance, loading: balLoading } = useTokenBalance(
    selected.address,
    PUSD_MANAGER_ADDRESS as `0x${string}`,
  );

  // Parse the entered string to bigint at the token's native decimals.
  const parsedAmount = useMemo(() => {
    if (!amount || !PushChain) return 0n;
    const clean = amount.trim();
    if (!/^\d*(\.\d*)?$/.test(clean) || clean === '' || clean === '.') return 0n;
    try {
      return PushChain.utils.helpers.parseUnits(clean, selected.decimals);
    } catch {
      return 0n;
    }
  }, [amount, selected.decimals, PushChain]);

  const amountValid = parsedAmount > 0n;
  const exceedsBalance = parsedAmount > balance;
  const solventHalt = invariants.state === 'violation';

  const handleMint = async () => {
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
        selected.address,
        PUSD_MANAGER_ADDRESS as `0x${string}`,
        parsedAmount,
      );
      const depositLeg = buildDepositLeg(
        helpers,
        PUSD_MANAGER_ADDRESS as `0x${string}`,
        selected.address,
        parsedAmount,
        account,
      );

      // Optional cross-chain funds routing.
      const [chainKey, symKey] = selected.moveableKey;
      const moveableRoot = (PushChain.CONSTANTS as unknown as { MOVEABLE?: { TOKEN?: Record<string, Record<string, unknown>> } })
        .MOVEABLE?.TOKEN;
      const moveableToken = moveableRoot?.[chainKey]?.[symKey];

      const legs: CascadeLeg[] = [approveLeg, depositLeg];
      // The SDK's public types don't yet expose the cascade `data: CascadeLeg[]`
      // or `funds` shapes cleanly, so we assert the options object once. The
      // runtime shape is what `@pushchain/core`'s sendTransaction actually
      // accepts for multi-leg universal txs (see push-frontend skill).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txOptions: any = {
        to: '0x0000000000000000000000000000000000000000',
        value: 0n,
        data: legs,
      };
      if (moveableToken) {
        txOptions.funds = { amount: parsedAmount, token: moveableToken };
      }
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
    if (exceedsBalance) return 'INSUFFICIENT BALANCE';
    return `MINT ${formatAmount(parsedAmount, selected.decimals, { maxFractionDigits: 2 })} PUSD →`;
  })();

  const ctaDisabled = submitting || !amountValid || exceedsBalance || solventHalt;

  // When the wallet isn't connected, render the gate in place of the action
  // area — we still show the marketing card above so the page isn't empty.
  return (
    <div className="card-shell">
      <div className="card-shell__head">
        <div>
          <h1>Mint PUSD</h1>
          <p>Deposit any supported stablecoin from any supported chain.</p>
        </div>
        <div className="card-shell__aside">
          <div style={{ color: 'var(--c-ink-mute)' }}>CROSS-CHAIN ROUTE</div>
          <strong>{selected.chainLabel}</strong>
          <div>→ PUSH CHAIN</div>
        </div>
      </div>

      {!isConnected ? (
        <ConnectedGate
          title="CONNECT TO MINT"
          subtitle="Authorize a universal account to deposit from any supported origin chain."
        />
      ) : (
        <>
          {/* YOU PAY */}
          <div className="input-head" style={{ marginTop: 8 }}>
            <span>YOU PAY</span>
            <button
              type="button"
              disabled={balance === 0n}
              onClick={() => {
                if (!PushChain) return;
                // Display the full token-native balance in its own decimals.
                const whole = balance / 10n ** BigInt(selected.decimals);
                const frac = balance % 10n ** BigInt(selected.decimals);
                const fracStr = frac.toString().padStart(selected.decimals, '0').replace(/0+$/, '');
                setAmount(fracStr ? `${whole}.${fracStr}` : whole.toString());
              }}
            >
              BALANCE {balLoading ? '…' : formatAmount(balance, selected.decimals, { maxFractionDigits: 6, minFractionDigits: 2 })} · MAX
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

          <div className="arrow-divider">↓</div>

          {/* YOU RECEIVE */}
          <div className="input-head">
            <span>YOU RECEIVE</span>
            <span className="meta-sm">PUSD · 6 DEC</span>
          </div>
          <div className="input-shell">
            <div className="input-shell__amount" aria-readonly="true">
              {amountValid ? formatAmount(parsedAmount, selected.decimals, { maxFractionDigits: 6 }) : '0.00'}
            </div>
            <div className="token-pill">
              <span className="token-pill__symbol">PUSD</span>
              <span className="token-pill__chain">· PUSH</span>
            </div>
          </div>

          {/* Summary */}
          <div className="summary">
            <div className="summary__row">
              <span>DEPOSIT AMOUNT</span>
              <strong>
                {formatAmount(parsedAmount, selected.decimals)} {selected.symbol}
              </strong>
            </div>
            <div className="summary__row">
              <span>PROTOCOL FEE</span>
              <strong>NONE</strong>
            </div>
            <div className="summary__row summary__row--total">
              <span>YOU RECEIVE</span>
              <strong>{formatAmount(parsedAmount, selected.decimals)} PUSD</strong>
            </div>
          </div>

          <button
            type="button"
            className={`btn btn--block ${solventHalt ? 'btn--danger' : 'btn--primary'}`}
            onClick={handleMint}
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
                {confirmed ? 'MINT CONFIRMED' : 'BROADCASTING'}
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

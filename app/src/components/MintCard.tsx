/**
 * MintCard — advanced mint flow for /mint.
 *
 * What's here beyond the inline ConvertPanel:
 *   - Chain-aware source tokens: if the wallet's universal origin is an
 *     external chain (Ethereum Sepolia, Base, Solana, etc.), we default to
 *     MOVEABLE tokens on that chain and mark others as "needs wallet on X".
 *   - Custom recipient field (defaults to the connected UEA on Push Chain).
 *   - Full fee / route preview.
 *   - Halts when I-01 is violated.
 *
 * Cascade (unchanged from Deployment 2):
 *   1. approve(PUSDManager, amount) on the source ERC-20
 *   2. deposit(token, amount, recipient) on PUSDManager
 * Submitted in a single `sendTransaction` with `data: [approveLeg, depositLeg]`.
 * When the selected token resolves to a MOVEABLE.TOKEN constant, `funds` is
 * attached so the SDK handles the bridge leg.
 */

import { useEffect, useMemo, useState } from 'react';
import { usePushChain, usePushChainClient } from '@pushchain/ui-kit';
import { TOKENS, type ReserveToken } from '../contracts/tokens';
import { PUSD_MANAGER_ADDRESS } from '../contracts/config';
import {
  buildApproveLeg,
  buildDepositLeg,
  type CascadeLeg,
  type HelpersLike,
} from '../lib/cascade';
import {
  filterTokensByOrigin,
  isValidAddress,
  originChainLabel,
  resolveMoveableToken,
} from '../lib/wallet';
import { useTokenBalance } from '../hooks/useTokenBalance';
import { useInvariants } from '../hooks/useInvariants';
import { explorerTx, formatAmount, truncHash } from '../lib/format';
import { ConnectedGate } from './ConnectedGate';
import { useIsConnected } from '../hooks/useIsConnected';
import { TokenPill } from './TokenPill';

export function MintCard() {
  const isConnected = useIsConnected();
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();
  const invariants = useInvariants();

  const origin = pushChainClient?.universal?.origin ?? null;
  const account = (pushChainClient?.universal?.account ?? null) as `0x${string}` | null;

  // Order tokens so the wallet's origin-chain tokens float to the top.
  const sortedTokens = useMemo(() => {
    const matching = filterTokensByOrigin(TOKENS, origin);
    if (!matching.length) return [...TOKENS];
    const rest = TOKENS.filter((t) => !matching.find((m) => m.address === t.address));
    return [...matching, ...rest];
  }, [origin]);

  const [selected, setSelected] = useState<ReserveToken>(sortedTokens[0] ?? TOKENS[0]);
  const [amount, setAmount] = useState('');
  const [showSelector, setShowSelector] = useState(false);
  const [recipient, setRecipient] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the list of sorted tokens changes (wallet flipped chain), re-select
  // the first token so we don't leave a stale cross-chain selection.
  useEffect(() => {
    if (!sortedTokens.some((t) => t.address === selected.address) && sortedTokens.length) {
      setSelected(sortedTokens[0]);
    }
  }, [sortedTokens, selected.address]);

  // Default the recipient to the connected UEA once it's known.
  useEffect(() => {
    if (account && !recipient) setRecipient(account);
  }, [account, recipient]);

  const { balance, loading: balLoading } = useTokenBalance(
    selected.address,
    PUSD_MANAGER_ADDRESS as `0x${string}`,
  );

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
  const recipientValid = isValidAddress(recipient);
  const [matchesOrigin] = useMemo(() => {
    if (!origin) return [false];
    return [selected.moveableKey[0] === origin.chain];
  }, [origin, selected.moveableKey]);

  const handleMint = async () => {
    if (!pushChainClient || !PushChain || !account) return;
    if (!amountValid || exceedsBalance || solventHalt || !recipientValid) return;

    const helpers = PushChain.utils.helpers as unknown as HelpersLike;
    const target = recipient as `0x${string}`;

    setSubmitting(true);
    setError(null);
    setTxHash(null);
    setConfirmed(false);

    try {
      const legs: CascadeLeg[] = [
        buildApproveLeg(helpers, selected.address, PUSD_MANAGER_ADDRESS as `0x${string}`, parsedAmount),
        buildDepositLeg(helpers, PUSD_MANAGER_ADDRESS as `0x${string}`, selected.address, parsedAmount, target),
      ];

      const [chainKey, symbolKey] = selected.moveableKey;
      const moveable = resolveMoveableToken(PushChain.CONSTANTS, chainKey, symbolKey);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txOptions: any = {
        to: '0x0000000000000000000000000000000000000000',
        value: 0n,
        data: legs,
      };
      if (moveable) txOptions.funds = { amount: parsedAmount, token: moveable };

      const tx = await pushChainClient.universal.sendTransaction(txOptions);
      setTxHash(tx.hash as `0x${string}`);
      await tx.wait();
      setConfirmed(true);
      setAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
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
    if (!recipientValid) return 'INVALID RECIPIENT';
    return `MINT ${formatAmount(parsedAmount, selected.decimals, { maxFractionDigits: 2 })} PUSD →`;
  })();

  const ctaDisabled = submitting || !amountValid || exceedsBalance || solventHalt || !recipientValid;

  return (
    <div className="card-shell">
      <div className="card-shell__head">
        <div>
          <h1>Mint PUSD</h1>
          <p>Deposit any supported stablecoin from any supported chain. Cross-chain is one signature.</p>
        </div>
        <div className="card-shell__aside">
          <div style={{ color: 'var(--c-ink-mute)' }}>WALLET ORIGIN</div>
          <strong>{originChainLabel(origin)}</strong>
          <div style={{ marginTop: 6, color: 'var(--c-ink-mute)' }}>ROUTE</div>
          <strong>{selected.chainShort} → PUSH CHAIN</strong>
        </div>
      </div>

      {!isConnected ? (
        <ConnectedGate
          title="CONNECT TO MINT"
          subtitle="Authorize a universal account to deposit from any supported origin chain."
        />
      ) : (
        <>
          <div className="input-head" style={{ marginTop: 8 }}>
            <span>YOU PAY</span>
            <button
              type="button"
              disabled={balance === 0n}
              onClick={() => {
                const base = 10n ** BigInt(selected.decimals);
                const whole = balance / base;
                const frac = balance % base;
                const fracStr = frac.toString().padStart(selected.decimals, '0').replace(/0+$/, '');
                setAmount(fracStr ? `${whole}.${fracStr}` : whole.toString());
              }}
            >
              BALANCE {balLoading ? '…' : formatAmount(balance, selected.decimals, { maxFractionDigits: 6 })} · MAX
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
            <div className="selector-panel" role="listbox" style={{ marginTop: 6 }}>
              {sortedTokens.map((t) => {
                const active = t.address === selected.address;
                const onYourChain = origin?.chain === t.moveableKey[0];
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
                      {onYourChain && <span className="chip chip--accent">YOUR WALLET</span>}
                    </div>
                    <span className="addr">{t.address.slice(0, 6)}…{t.address.slice(-4)}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="arrow-divider">↓</div>

          <div className="input-head">
            <span>YOU RECEIVE</span>
            <span className="meta-sm">PUSD · PUSH CHAIN</span>
          </div>
          <div className="input-shell">
            <div className="input-shell__amount" aria-readonly="true">
              {amountValid ? formatAmount(parsedAmount, selected.decimals, { maxFractionDigits: 6 }) : '0.00'}
            </div>
            <TokenPill symbol="PUSD" chainShort="PUSH" size="md" />
          </div>

          {/* Recipient */}
          <div className="input-head" style={{ marginTop: 16 }}>
            <span>RECIPIENT (PUSH CHAIN)</span>
            <button
              type="button"
              onClick={() => account && setRecipient(account)}
              disabled={!account}
            >
              USE MY ADDRESS
            </button>
          </div>
          <div className="input-row">
            <input
              type="text"
              placeholder="0x…"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim())}
              disabled={submitting}
              spellCheck={false}
            />
            {recipient && !recipientValid && (
              <span className="input-row__hint input-row__hint--warn">
                ✕ Not a valid EVM address.
              </span>
            )}
            {recipientValid && recipient.toLowerCase() !== account?.toLowerCase() && (
              <span className="input-row__hint">
                ⓘ Minting to a third-party address on Push Chain.
              </span>
            )}
          </div>

          <div className="summary">
            <div className="summary__row">
              <span>DEPOSIT</span>
              <strong>{formatAmount(parsedAmount, selected.decimals)} {selected.symbol}</strong>
            </div>
            <div className="summary__row">
              <span>BRIDGE ROUTE</span>
              <strong>
                {matchesOrigin ? '1-tx cascade via funds' : 'Push Chain direct'}
              </strong>
            </div>
            <div className="summary__row">
              <span>PROTOCOL FEE</span>
              <strong>NONE</strong>
            </div>
            <div className="summary__row summary__row--total">
              <span>RECIPIENT RECEIVES</span>
              <strong>{formatAmount(parsedAmount, selected.decimals)} PUSD</strong>
            </div>
            {matchesOrigin && (
              <p className="summary__hint">
                Your wallet is on <strong>{selected.chainLabel}</strong>. The SDK will move your tokens,
                approve PUSDManager, and mint PUSD in a single signature.
              </p>
            )}
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
            <div className="feedback feedback--error">
              <div className="feedback__title">TRANSACTION FAILED</div>
              <div className="mono">{error}</div>
            </div>
          )}
          {txHash && (
            <div className={`feedback ${confirmed ? 'feedback--success' : ''}`}>
              <div className="feedback__title">{confirmed ? 'MINT CONFIRMED' : 'BROADCASTING'}</div>
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

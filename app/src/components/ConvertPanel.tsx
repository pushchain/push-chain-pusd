/**
 * ConvertPanel — the inline "Convert." card that lives in the hero.
 *
 * Two modes via tab:
 *   DEPOSIT → MINT   — quick mint from the user's best-available source token
 *   BURN    → REDEEM — quick redeem into a chosen reserve token
 *
 * This panel is intentionally short on chrome. Advanced controls (recipient
 * override, basket mode, cross-chain payout) live on the dedicated /mint
 * and /redeem pages — a "More options →" link on each tab jumps there with
 * state preserved as a query string.
 */

import { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { usePushChain, usePushChainClient } from '@pushchain/ui-kit';
import { TOKENS, type ReserveToken } from '../contracts/tokens';
import { PUSD_ADDRESS, PUSD_MANAGER_ADDRESS } from '../contracts/config';
import {
  buildApproveLeg,
  buildDepositLeg,
  buildRedeemLeg,
  type CascadeLeg,
  type HelpersLike,
} from '../lib/cascade';
import { filterTokensByOrigin, resolveMoveableToken } from '../lib/wallet';
import { usePUSDBalance } from '../hooks/usePUSDBalance';
import { useTokenBalance } from '../hooks/useTokenBalance';
import { useInvariants } from '../hooks/useInvariants';
import { useProtocolStats } from '../hooks/useProtocolStats';
import { explorerTx, formatAmount, formatPct, truncHash } from '../lib/format';
import { TokenPill } from './TokenPill';

type Mode = 'mint' | 'redeem';

export function ConvertPanel() {
  const navigate = useNavigate();
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();
  const invariants = useInvariants();
  const { baseFeeBps } = useProtocolStats();

  const account = (pushChainClient?.universal?.account ?? null) as `0x${string}` | null;
  const origin = pushChainClient?.universal?.origin ?? null;

  const [mode, setMode] = useState<Mode>('mint');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Choose a sensible default source token based on origin chain.
  const eligibleTokens = useMemo<readonly ReserveToken[]>(() => {
    const filtered = filterTokensByOrigin(TOKENS, origin);
    return filtered.length ? filtered : TOKENS;
  }, [origin]);

  const [selected, setSelected] = useState<ReserveToken>(eligibleTokens[0] ?? TOKENS[0]);

  // Re-select when the eligibility list flips (e.g. wallet just connected).
  if (!eligibleTokens.some((t) => t.address === selected.address) && eligibleTokens.length) {
    setSelected(eligibleTokens[0]);
  }

  // For the mint mode, source balance from the chosen reserve token's ERC-20.
  // For the redeem mode, source from PUSD.
  const tokenBal = useTokenBalance(
    selected.address,
    PUSD_MANAGER_ADDRESS as `0x${string}`,
  );
  const { balance: pusdBalance } = usePUSDBalance();

  const decimals = mode === 'mint' ? selected.decimals : 6;

  const parsedAmount = useMemo(() => {
    if (!amount || !PushChain) return 0n;
    const clean = amount.trim();
    if (!/^\d*(\.\d*)?$/.test(clean) || clean === '' || clean === '.') return 0n;
    try {
      return PushChain.utils.helpers.parseUnits(clean, decimals);
    } catch {
      return 0n;
    }
  }, [amount, decimals, PushChain]);

  const amountValid = parsedAmount > 0n;
  const solventHalt = invariants.state === 'violation';

  const balance = mode === 'mint' ? tokenBal.balance : pusdBalance;
  const exceedsBalance = parsedAmount > balance;

  // What the user will receive. Mint: 1:1 in PUSD (minus haircut — v1 none).
  // Redeem: amount - (amount * baseFeeBps / 10_000)
  const receiveAmount = useMemo(() => {
    if (!amountValid) return 0n;
    if (mode === 'mint') return parsedAmount;
    const fee = (parsedAmount * BigInt(baseFeeBps)) / 10_000n;
    return parsedAmount - fee;
  }, [mode, parsedAmount, baseFeeBps, amountValid]);

  const feeBpsLabel = baseFeeBps === 0
    ? '0 bps'
    : `${(baseFeeBps / 100).toFixed(2)}% (${baseFeeBps} bps)`;

  const handleConvert = async () => {
    if (!pushChainClient || !PushChain || !account) return;
    if (!amountValid || exceedsBalance || solventHalt) return;

    setSubmitting(true);
    setError(null);
    setTxHash(null);
    setConfirmed(false);

    const helpers = PushChain.utils.helpers as unknown as HelpersLike;

    try {
      let legs: CascadeLeg[];
      let moveable: unknown;

      if (mode === 'mint') {
        legs = [
          buildApproveLeg(helpers, selected.address, PUSD_MANAGER_ADDRESS as `0x${string}`, parsedAmount),
          buildDepositLeg(helpers, PUSD_MANAGER_ADDRESS as `0x${string}`, selected.address, parsedAmount, account),
        ];
        const [chainKey, symbol] = selected.moveableKey;
        moveable = resolveMoveableToken(PushChain.CONSTANTS, chainKey, symbol);
      } else {
        legs = [
          buildApproveLeg(helpers, PUSD_ADDRESS as `0x${string}`, PUSD_MANAGER_ADDRESS as `0x${string}`, parsedAmount),
          buildRedeemLeg(helpers, PUSD_MANAGER_ADDRESS as `0x${string}`, parsedAmount, selected.address, false, account),
        ];
      }

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
    if (!account) return 'CONNECT TO CONVERT';
    if (submitting && !txHash) return 'SIGNING…';
    if (submitting && txHash) return 'BROADCASTING…';
    if (solventHalt) return 'HALTED · SOLVENCY CHECK FAILED';
    if (!amountValid) return mode === 'mint' ? 'BURN NOTHING. MINT.' : 'BURN. REDEEM.';
    if (exceedsBalance) return 'INSUFFICIENT BALANCE';
    if (mode === 'mint') return `BURN NOTHING. MINT ${formatAmount(parsedAmount, decimals, { maxFractionDigits: 0 })} PUSD.`;
    return `BURN ${formatAmount(parsedAmount, 6, { maxFractionDigits: 0 })} PUSD. REDEEM.`;
  })();

  const ctaDisabled = !account || submitting || !amountValid || exceedsBalance || solventHalt;

  return (
    <div className="convert">
      <div className="convert__head">
        <div className="convert__title">Convert.</div>
        <div className="convert__kicker">NO. 01 · ONE ACTION</div>
      </div>

      <div className="convert__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'mint'}
          className={`convert__tab ${mode === 'mint' ? 'convert__tab--active' : ''}`}
          onClick={() => {
            setMode('mint');
            setAmount('');
          }}
        >
          Deposit → Mint
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'redeem'}
          className={`convert__tab ${mode === 'redeem' ? 'convert__tab--active' : ''}`}
          onClick={() => {
            setMode('redeem');
            setAmount('');
          }}
        >
          Burn → Redeem
        </button>
      </div>

      <div className="convert__body">
        {/* Amount in */}
        <div>
          <div className="input-head">
            <span>{mode === 'mint' ? 'DEPOSIT' : 'BURN'}</span>
            <button
              type="button"
              disabled={balance === 0n}
              onClick={() => {
                const base = 10n ** BigInt(decimals);
                const whole = balance / base;
                const frac = balance % base;
                const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
                setAmount(fracStr ? `${whole}.${fracStr}` : whole.toString());
              }}
            >
              BALANCE {formatAmount(balance, decimals, { maxFractionDigits: 2 })} · MAX
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
            {mode === 'mint' ? (
              <TokenPill symbol={selected.symbol} chainShort={selected.chainShort} size="md" />
            ) : (
              <TokenPill symbol="PUSD" chainShort="PUSH" size="md" />
            )}
          </div>
        </div>

        {/* Amount out */}
        <div>
          <div className="input-head">
            <span>RECEIVE</span>
            <span>1 : 1</span>
          </div>
          <div className="input-shell">
            <div className="input-shell__amount" aria-readonly="true" style={{ color: amountValid ? 'var(--c-magenta)' : 'var(--c-ink-mute)' }}>
              {amountValid ? formatAmount(receiveAmount, mode === 'mint' ? 6 : 6, { maxFractionDigits: 2 }) : '0.00'}
            </div>
            {mode === 'mint' ? (
              <TokenPill symbol="PUSD" chainShort="PUSH CHAIN" size="md" />
            ) : (
              <TokenPill symbol={selected.symbol} chainShort={selected.chainShort} size="md" />
            )}
          </div>
        </div>

        {/* 2x2 meta grid */}
        <div className="convert__grid">
          <div>
            <div className="convert__grid-label">{mode === 'mint' ? 'HAIRCUT' : 'REDEMPTION FEE'}</div>
            <div className="convert__grid-value">
              {mode === 'mint'
                ? '0 bps'
                : amountValid
                  ? `−${formatPct((parsedAmount * BigInt(baseFeeBps)) / 10_000n, parsedAmount)} · ${feeBpsLabel}`
                  : feeBpsLabel}
            </div>
          </div>
          <div>
            <div className="convert__grid-label">PROTOCOL FEE</div>
            <div className="convert__grid-value">{mode === 'mint' ? 'None' : feeBpsLabel}</div>
          </div>
          <div>
            <div className="convert__grid-label">RATE</div>
            <div className="convert__grid-value">1.000000</div>
          </div>
          <div>
            <div className="convert__grid-label">ROUTE</div>
            <div className="convert__grid-value">
              {mode === 'mint' ? `${selected.chainShort} → PC` : `PUSH → ${selected.chainShort}`}
            </div>
          </div>
        </div>

        <button
          type="button"
          className={`btn btn--accent btn--block convert__cta ${solventHalt ? 'btn--danger' : ''}`}
          onClick={account ? handleConvert : () => navigate(mode === 'mint' ? '/mint' : '/redeem')}
          disabled={ctaDisabled && !!account}
        >
          {ctaLabel}
        </button>

        <p className="convert__fineprint">
          {mode === 'mint' ? (
            <>
              By proceeding you authorise PUSDManager to move{' '}
              <strong>{amountValid ? formatAmount(parsedAmount, decimals) : '—'} {selected.symbol}</strong>{' '}
              from your {selected.chainLabel.toLowerCase()} account. PUSD will be minted 1:1 to your universal
              account on Push Chain. You may redeem at any time, into your preferred asset, or into a basket
              when preferred liquidity is thin.
            </>
          ) : (
            <>
              You will burn PUSD on Push Chain and receive <strong>{selected.symbol}</strong> on {selected.chainLabel}.
              For cross-chain payout, custom recipient, or basket mode, open{' '}
              <NavLink to="/redeem" className="link-mono">advanced redeem →</NavLink>
            </>
          )}
        </p>

        {mode === 'mint' && (
          <p className="convert__fineprint" style={{ marginTop: -6 }}>
            Need a custom recipient or chain-specific route?{' '}
            <NavLink to="/mint" className="link-mono">Open advanced mint →</NavLink>
          </p>
        )}

        {error && (
          <div className="feedback feedback--error">
            <div className="feedback__title">TRANSACTION FAILED</div>
            <div className="mono">{error}</div>
          </div>
        )}
        {txHash && (
          <div className={`feedback ${confirmed ? 'feedback--success' : ''}`}>
            <div className="feedback__title">{confirmed ? 'CONFIRMED' : 'BROADCASTING'}</div>
            <a className="link-mono" href={explorerTx(txHash)} target="_blank" rel="noreferrer">
              {truncHash(txHash)} ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

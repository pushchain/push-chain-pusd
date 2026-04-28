/**
 * SavePanel — PUSD+ vault interface (deposit-stable / redeem-to-stable).
 *
 * Two tabs — DEPOSIT and WITHDRAW — that drive the canonical vault path:
 *   - DEPOSIT  → PUSDPlus.depositStable(token, amount, receiver)
 *                Cascade: ERC20.approve(plus) → plus.depositStable(...)
 *   - WITHDRAW → PUSDPlus.redeemToStable(shares, preferredAsset, receiver)
 *                Single tx; PUSDPlus burns shares directly from the caller.
 *
 * Vault flows are Push-Chain-only (no cross-chain bridging is involved). Users
 * either already hold a Donut-side stable, or they need to mint/bridge it via
 * the existing /convert flow first.
 *
 * Fee plumbing the panel surfaces:
 *   - `vaultHaircutBps` (Manager) — charged on the deposit's stable BEFORE PUSD
 *     is minted into the vault. Effective shares = (amount - haircut) * pps⁻¹.
 *   - `baseFee` (Manager) — charged on the redeem's PUSD-equivalent before stable
 *     is delivered.
 *   - `performanceFeeBps` (PUSDPlus) — diluting share-fee crystallised on yield
 *     growth; informational for the user, not part of their tx maths.
 */

import { usePushChain, usePushChainClient, usePushWalletContext } from '@pushchain/ui-kit';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PUSD_PLUS_ADDRESS } from '../contracts/config';
import { TOKENS, type ReserveToken } from '../contracts/tokens';
import { useProtocolStats } from '../hooks/useProtocolStats';
import { usePUSDPlusBalance } from '../hooks/usePUSDPlusBalance';
import { usePUSDPlusStats } from '../hooks/usePUSDPlusStats';
import { useTokenBalance } from '../hooks/useTokenBalance';
import {
    buildApproveLeg,
    buildDepositStableLeg,
    buildRedeemToStableLeg,
    type CascadeLeg,
    type HelpersLike,
} from '../lib/cascade';
import { explorerTx, formatAmount, truncHash } from '../lib/format';
import { TokenPill } from './TokenPill';

type Mode = 'deposit' | 'withdraw';

type Stage =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'signing' }
  | { kind: 'broadcasting'; hash: `0x${string}` }
  | { kind: 'confirmed'; hash: `0x${string}` }
  | { kind: 'error'; message: string };

type Props = {
  initialMode?: Mode;
  advanced?: boolean;
};

export function SavePanel({ initialMode = 'deposit', advanced = false }: Props) {
  const navigate = useNavigate();
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();
  const { handleConnectToPushWallet } = usePushWalletContext();
  const { baseFeeBps } = useProtocolStats();
  const stats = usePUSDPlusStats();
  const userPlus = usePUSDPlusBalance();

  const account = (pushChainClient?.universal?.account ?? null) as `0x${string}` | null;

  // ---------------------------------------------------------------------
  // mode
  // ---------------------------------------------------------------------
  const [mode, setMode] = useState<Mode>(initialMode);
  useEffect(() => setMode(initialMode), [initialMode]);

  // ---------------------------------------------------------------------
  // token select (the stable used for deposit OR withdraw destination)
  // ---------------------------------------------------------------------
  const [selected, setSelected] = useState<ReserveToken>(TOKENS[0]);
  const [showSelector, setShowSelector] = useState(false);

  // ---------------------------------------------------------------------
  // amount + balance
  // ---------------------------------------------------------------------
  const [amount, setAmount] = useState('');
  const stableBal = useTokenBalance(
    selected.address,
    PUSD_PLUS_ADDRESS ? (PUSD_PLUS_ADDRESS as `0x${string}`) : null,
  );

  const decimals = mode === 'deposit' ? selected.decimals : stats.shareDecimals;
  const balance = mode === 'deposit' ? stableBal.balance : userPlus.shares;
  const balanceLoading = mode === 'deposit' ? stableBal.loading : userPlus.loading;

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
  const exceedsBalance = parsedAmount > balance;

  // ---------------------------------------------------------------------
  // estimates
  // ---------------------------------------------------------------------
  // Deposit estimate: amount → effective PUSD after haircut → shares against pre-mint NAV.
  // Mirrors PUSDPlus.depositStable's offset-aware formula.
  const depositPreview = useMemo(() => {
    if (mode !== 'deposit' || !amountValid) return { shares: 0n, pusdMinted: 0n };
    const haircut = BigInt(stats.vaultHaircutBps);
    const pusdMinted = (parsedAmount * (10_000n - haircut)) / 10_000n;
    const offsetMul = 10n ** BigInt(stats.shareDecimals - 6); // shareDecimals=12, asset=6 → 1e6
    if (stats.totalSupply === 0n) {
      // Empty vault → 1 PUSD mints exactly `offsetMul` shares (par).
      return { shares: pusdMinted * offsetMul, pusdMinted };
    }
    const shares = (pusdMinted * (stats.totalSupply + offsetMul)) / (stats.totalAssets + 1n);
    return { shares, pusdMinted };
  }, [mode, amountValid, parsedAmount, stats]);

  // Withdraw estimate: shares → PUSD owed (convertToAssets equivalent) → stable after baseFee.
  const withdrawPreview = useMemo(() => {
    if (mode !== 'withdraw' || !amountValid) return { pusdOwed: 0n, stableOut: 0n };
    const offsetMul = 10n ** BigInt(stats.shareDecimals - 6);
    const pusdOwed = stats.totalSupply === 0n
      ? 0n
      : (parsedAmount * stats.totalAssets) / (stats.totalSupply + offsetMul);
    const fee = (pusdOwed * BigInt(baseFeeBps)) / 10_000n;
    return { pusdOwed, stableOut: pusdOwed - fee };
  }, [mode, amountValid, parsedAmount, stats, baseFeeBps]);

  // ---------------------------------------------------------------------
  // execution
  // ---------------------------------------------------------------------
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const submitting =
    stage.kind === 'preparing' ||
    stage.kind === 'signing' ||
    stage.kind === 'broadcasting';

  const notConfigured = !PUSD_PLUS_ADDRESS;

  const handleSubmit = async () => {
    if (!pushChainClient || !PushChain || !account || notConfigured) return;
    if (!amountValid || exceedsBalance) return;

    const helpers = PushChain.utils.helpers as unknown as HelpersLike;
    const plusAddr = PUSD_PLUS_ADDRESS as `0x${string}`;
    setStage({ kind: 'preparing' });

    try {
      const legs: CascadeLeg[] = mode === 'deposit'
        ? [
            buildApproveLeg(helpers, selected.address, plusAddr, parsedAmount),
            buildDepositStableLeg(helpers, plusAddr, selected.address, parsedAmount, account),
          ]
        : [
            buildRedeemToStableLeg(helpers, plusAddr, parsedAmount, selected.address, account),
          ];

      setStage({ kind: 'signing' });
      const tx = await pushChainClient.universal.sendTransaction({
        to: '0x0000000000000000000000000000000000000000',
        value: 0n,
        data: legs,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const hash = tx.hash as `0x${string}`;
      setStage({ kind: 'broadcasting', hash });
      await tx.wait();
      setStage({ kind: 'confirmed', hash });
      setAmount('');
    } catch (err) {
      setStage({ kind: 'error', message: err instanceof Error ? err.message : 'Transaction failed' });
    }
  };

  // ---------------------------------------------------------------------
  // copy
  // ---------------------------------------------------------------------
  const title = advanced ? (mode === 'deposit' ? 'Save into PUSD+' : 'Withdraw PUSD+') : 'Save.';
  const kicker = advanced
    ? mode === 'deposit'
      ? `${(stats.vaultHaircutBps / 100).toFixed(2)}% HAIRCUT · ${(stats.performanceFeeBps / 100).toFixed(0)}% PERF FEE`
      : `${(baseFeeBps / 100).toFixed(2)}% BASE FEE`
    : 'NO. 02 · YIELD ON PUSD';

  const ppsLabel = stats.pricePerShare === null
    ? '1.000000'
    : (Number(stats.pricePerShare) / 1e18).toFixed(6);

  const ctaLabel = (() => {
    if (notConfigured) return 'PUSD+ NOT YET CONFIGURED';
    if (!account) return 'CONNECT TO ' + (mode === 'deposit' ? 'DEPOSIT' : 'WITHDRAW');
    if (stage.kind === 'preparing') return 'PREPARING…';
    if (stage.kind === 'signing') return 'SIGNING…';
    if (stage.kind === 'broadcasting') return mode === 'deposit' ? 'DEPOSITING…' : 'WITHDRAWING…';
    if (!amountValid) return mode === 'deposit' ? 'ENTER AN AMOUNT' : 'ENTER SHARES';
    if (exceedsBalance) return 'INSUFFICIENT BALANCE';
    if (mode === 'deposit') {
      const amt = formatAmount(parsedAmount, selected.decimals, { maxFractionDigits: 2 });
      return `DEPOSIT ${amt} ${selected.symbol} →`;
    }
    return `WITHDRAW TO ${selected.symbol}·${selected.chainShort} →`;
  })();

  const ctaDisabled =
    notConfigured ||
    !account ||
    submitting ||
    !amountValid ||
    exceedsBalance;

  // ---------------------------------------------------------------------
  // tab nav
  // ---------------------------------------------------------------------
  const goMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setAmount('');
    setStage({ kind: 'idle' });
    if (advanced) navigate(`/save/${next}`);
  };

  // ---------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------
  return (
    <div className="convert">
      <div className="convert__head">
        <div className="convert__title">{title}</div>
        <div className="convert__kicker">{kicker}</div>
      </div>

      <div className="convert__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'deposit'}
          className={`convert__tab ${mode === 'deposit' ? 'convert__tab--active' : ''}`}
          onClick={() => goMode('deposit')}
        >
          Deposit
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'withdraw'}
          className={`convert__tab ${mode === 'withdraw' ? 'convert__tab--active' : ''}`}
          onClick={() => goMode('withdraw')}
        >
          Withdraw
        </button>
      </div>

      <div className="convert__body">
        {/* PAY input */}
        <div>
          <div className="input-head">
            <span>{mode === 'deposit' ? 'PAY' : 'BURN SHARES'}</span>
            <button
              type="button"
              disabled={!account || balance === 0n}
              onClick={() => {
                const base = 10n ** BigInt(decimals);
                const whole = balance / base;
                const frac = balance % base;
                const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
                setAmount(fracStr ? `${whole}.${fracStr}` : whole.toString());
              }}
            >
              {account
                ? `BALANCE ${balanceLoading ? '…' : formatAmount(balance, decimals, { maxFractionDigits: 2 })} · MAX`
                : 'CONNECT TO SEE BALANCE'}
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
            {mode === 'deposit' ? (
              <button
                type="button"
                className="selector-btn"
                onClick={() => setShowSelector((s) => !s)}
                disabled={submitting}
              >
                <TokenPill symbol={selected.symbol} chainShort="PUSH" size="sm" />
                <span className="selector-btn__caret">▾</span>
              </button>
            ) : (
              <TokenPill symbol="PUSD+" chainShort="PUSH" size="md" />
            )}
          </div>
          {mode === 'deposit' && showSelector && (
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
                    <div className="selector-panel__lead">
                      <TokenPill symbol={t.symbol} chainShort="PUSH" size="sm" />
                      <span className="meta">{t.chainLabel}</span>
                    </div>
                    <span className="addr mono">
                      {t.address.slice(0, 6)}…{t.address.slice(-4)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* RECEIVE preview */}
        <div>
          <div className="input-head">
            <span>RECEIVE</span>
            <span>1 SHARE ≈ {ppsLabel} PUSD</span>
          </div>
          <div className="input-shell">
            <div
              className="input-shell__amount"
              aria-readonly="true"
              style={{ color: amountValid ? 'var(--c-magenta)' : 'var(--c-ink-mute)' }}
            >
              {mode === 'deposit'
                ? amountValid
                  ? formatAmount(depositPreview.shares, stats.shareDecimals, { maxFractionDigits: 4 })
                  : '0.0000'
                : amountValid
                  ? formatAmount(withdrawPreview.stableOut, 6, { maxFractionDigits: 2 })
                  : '0.00'}
            </div>
            {mode === 'deposit' ? (
              <TokenPill symbol="PUSD+" chainShort="PUSH" size="md" />
            ) : (
              <button
                type="button"
                className="selector-btn"
                onClick={() => setShowSelector((s) => !s)}
                disabled={submitting}
              >
                <TokenPill symbol={selected.symbol} chainShort="PUSH" size="sm" />
                <span className="selector-btn__caret">▾</span>
              </button>
            )}
          </div>
          {mode === 'withdraw' && showSelector && (
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
                    <div className="selector-panel__lead">
                      <TokenPill symbol={t.symbol} chainShort="PUSH" size="sm" />
                      <span className="meta">{t.chainLabel}</span>
                    </div>
                    <span className="addr mono">
                      {t.address.slice(0, 6)}…{t.address.slice(-4)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 2x2 stats grid */}
        <div className="convert__grid">
          <div>
            <div className="convert__grid-label">VAULT TVL</div>
            <div className="convert__grid-value">
              {formatAmount(stats.totalAssets, 6, { maxFractionDigits: 0 })} PUSD
            </div>
          </div>
          <div>
            <div className="convert__grid-label">PRICE / SHARE</div>
            <div className="convert__grid-value">{ppsLabel}</div>
          </div>
          <div>
            <div className="convert__grid-label">{mode === 'deposit' ? 'HAIRCUT' : 'BASE FEE'}</div>
            <div className="convert__grid-value">
              {mode === 'deposit'
                ? `${(stats.vaultHaircutBps / 100).toFixed(2)}%`
                : `${(baseFeeBps / 100).toFixed(2)}%`}
            </div>
          </div>
          <div>
            <div className="convert__grid-label">YOUR SHARES</div>
            <div className="convert__grid-value">
              {account && userPlus.shares > 0n
                ? formatAmount(userPlus.shares, stats.shareDecimals, { maxFractionDigits: 4 })
                : '—'}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="btn btn--accent btn--block convert__cta"
          onClick={account ? handleSubmit : handleConnectToPushWallet}
          disabled={ctaDisabled && !!account}
        >
          {ctaLabel}
        </button>

        <p className="convert__fineprint">
          {mode === 'deposit'
            ? `Deposit ${selected.symbol}·${selected.chainShort} on Push Chain into the PUSD+ vault. Receive shares that accrue yield from the protocol's deployed liquidity.`
            : `Burn PUSD+ shares and withdraw the underlying PUSD as ${selected.symbol}·${selected.chainShort} on Push Chain.`}
        </p>

        {notConfigured && (
          <div className="feedback feedback--warn">
            <div className="feedback__title">PUSD+ NOT YET CONFIGURED</div>
            <div className="mono" style={{ marginTop: 4 }}>
              Set <strong>VITE_PUSD_PLUS_ADDRESS</strong> in <code>app/.env.local</code> after the v2
              broadcast and reload.
            </div>
          </div>
        )}

        {stage.kind === 'error' && (
          <div className="feedback feedback--error">
            <div className="feedback__title">TRANSACTION FAILED</div>
            <div className="mono">{stage.message}</div>
          </div>
        )}
        {(stage.kind === 'broadcasting' || stage.kind === 'confirmed') && (
          <div className={`feedback ${stage.kind === 'confirmed' ? 'feedback--success' : ''}`}>
            <div className="feedback__title">
              {stage.kind === 'broadcasting' ? 'BROADCASTING' : 'CONFIRMED'}
            </div>
            <a className="link-mono" href={explorerTx(stage.hash)} target="_blank" rel="noreferrer">
              {truncHash(stage.hash)} ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

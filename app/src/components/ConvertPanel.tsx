/**
 * ConvertPanel — one panel, both directions.
 *
 * Two tabs — MINT and REDEEM. `initialMode` controls which is active so
 * /mint opens on mint and /redeem opens on redeem.
 *
 * Mint — asks "where is the money coming FROM?"
 *   - Default route = the connected wallet's origin chain (external).
 *     The token dropdown only lists tokens on that chain (that's what the
 *     SDK can bridge in one signature via `funds`).
 *   - Alt route = FROM PUSH CHAIN. User pays with the Donut-side ERC-20
 *     already on Push Chain; no bridge leg. Dropdown shows every token.
 *
 * Redeem — always burns PUSD on Push Chain. Asks "where does the money
 * go TO?" — it's a destination question, not a source one.
 *   - Default destination = the selected token's own origin chain (e.g.
 *     pick USDC·ETH SEP → deliver on Ethereum Sepolia). Needs a recipient
 *     address on that chain.
 *   - Alt destination = PUSH CHAIN. Deliver the Donut-side ERC-20 to the
 *     user's UEA, no bridge leg.
 *
 * `advanced` unlocks the Push Chain recipient override and basket mode —
 * surfaced on the dedicated /mint and /redeem pages.
 */

import { useEffect, useMemo, useState } from 'react';
import { usePushChain, usePushChainClient, usePushWalletContext } from '@pushchain/ui-kit';
import { PUSD_ADDRESS, PUSD_MANAGER_ADDRESS } from '../contracts/config';
import { TOKENS, type ReserveToken } from '../contracts/tokens';
import { useInvariants } from '../hooks/useInvariants';
import { useProtocolStats } from '../hooks/useProtocolStats';
import { usePUSDBalance } from '../hooks/usePUSDBalance';
import { useTokenBalance } from '../hooks/useTokenBalance';
import {
  buildApproveLeg,
  buildDepositLeg,
  buildRedeemLeg,
  type CascadeLeg,
  type HelpersLike,
} from '../lib/cascade';
import { explorerTx, formatAmount, truncHash } from '../lib/format';
import {
  chainLabelFromKey,
  filterTokensByChainKey,
  isPushChainKey,
  isValidAddress,
  isValidAddressForChain,
  resolveMoveableToken,
  resolveOriginChainKey,
} from '../lib/wallet';
import { TokenPill } from './TokenPill';

type Mode = 'mint' | 'redeem';
type Route = 'external' | 'push';

type Stage =
  | { kind: 'idle' }
  | { kind: 'signing' }
  | { kind: 'broadcasting'; hash: `0x${string}` }
  | { kind: 'confirmed'; hash: `0x${string}` }
  // redeem-only second leg — forward the reserve back out to the external chain
  | { kind: 'step2-signing'; prevHash: `0x${string}` }
  | { kind: 'step2-broadcasting'; prevHash: `0x${string}`; hash: `0x${string}` }
  | { kind: 'step2-confirmed'; prevHash: `0x${string}`; hash: `0x${string}` }
  | { kind: 'error'; message: string };

type Props = {
  initialMode?: Mode;
  advanced?: boolean;
};

export function ConvertPanel({ initialMode = 'mint', advanced = false }: Props) {
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();
  const { handleConnectToPushWallet } = usePushWalletContext();
  const invariants = useInvariants();
  const { baseFeeBps } = useProtocolStats();

  const account = (pushChainClient?.universal?.account ?? null) as `0x${string}` | null;
  const origin = pushChainClient?.universal?.origin ?? null;

  // --- resolve SDK chain identifier --------------------------------------
  // The SDK emits origin.chain as CAIP-2 ("eip155:11155111"), while our TOKENS
  // table and MOVEABLE.TOKEN lookups use friendly keys ("ETHEREUM_SEPOLIA").
  // Normalize once so every downstream check can treat them as one.
  const originChainKey = useMemo(
    () => (PushChain ? resolveOriginChainKey(PushChain.CONSTANTS, origin) : origin?.chain ?? ''),
    [PushChain, origin],
  );
  const originIsPush = isPushChainKey(originChainKey);
  const originChainDisplay = chainLabelFromKey(originChainKey);

  // --- mode + route ------------------------------------------------------
  const [mode, setMode] = useState<Mode>(initialMode);
  useEffect(() => setMode(initialMode), [initialMode]);

  // For mint, route defaults to external whenever we know the wallet is on
  // an external chain. For redeem, route defaults to external too — i.e.
  // pay out on the selected token's own chain. Push Chain wallets default
  // to push on both tabs.
  const [route, setRoute] = useState<Route>(originIsPush ? 'push' : 'external');
  const [routeTouched, setRouteTouched] = useState(false);
  useEffect(() => {
    if (routeTouched) return;
    setRoute(originIsPush ? 'push' : 'external');
  }, [originIsPush, routeTouched]);

  // Route toggle is meaningful only after connect. Pre-connect we render the
  // "push" route (shows all tokens, no cross-chain wiring yet).
  const effectiveRoute: Route = account ? route : 'push';
  const isExternalRoute = effectiveRoute === 'external';

  // --- tokens ------------------------------------------------------------
  // Mint + external route: lock the dropdown to the wallet's origin chain
  // (that's what the SDK bridges in one signature).
  // Mint + push route:    all Donut-side tokens.
  // Redeem:               always all tokens — user picks *where* to redeem.
  const eligibleTokens = useMemo<readonly ReserveToken[]>(() => {
    if (mode === 'mint' && isExternalRoute) {
      const filtered = filterTokensByChainKey(TOKENS, originChainKey);
      return filtered.length ? filtered : TOKENS;
    }
    return TOKENS;
  }, [mode, isExternalRoute, originChainKey]);

  const [selected, setSelected] = useState<ReserveToken>(eligibleTokens[0] ?? TOKENS[0]);
  const [showSelector, setShowSelector] = useState(false);

  useEffect(() => {
    if (!eligibleTokens.some((t) => t.address === selected.address) && eligibleTokens.length) {
      setSelected(eligibleTokens[0]);
    }
  }, [eligibleTokens, selected.address]);

  // --- amount + balances -------------------------------------------------
  const [amount, setAmount] = useState('');
  const { balance: pusdBalance, loading: pusdLoading } = usePUSDBalance();
  const { balance: tokenBal, loading: tokenLoading } = useTokenBalance(
    selected.address,
    PUSD_MANAGER_ADDRESS as `0x${string}`,
  );

  // On the external mint route, the source balance lives on the origin chain
  // and we can't read it from the Donut-side ERC-20. We intentionally don't
  // surface a max/balance number there — the SDK will surface shortfalls at
  // signing time.
  const balanceKnown = mode === 'redeem' || !isExternalRoute;
  const balance = mode === 'mint' ? tokenBal : pusdBalance;
  const balanceLoading = mode === 'mint' ? tokenLoading : pusdLoading;

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
  const exceedsBalance = balanceKnown && parsedAmount > balance;
  const solventHalt = invariants.state === 'violation';

  const feeAmount = useMemo(() => {
    if (mode !== 'redeem' || parsedAmount === 0n) return 0n;
    return (parsedAmount * BigInt(baseFeeBps)) / 10_000n;
  }, [mode, parsedAmount, baseFeeBps]);
  const receiveAmount = mode === 'mint' ? parsedAmount : parsedAmount - feeAmount;

  // --- advanced fields ---------------------------------------------------
  const [pushRecipient, setPushRecipient] = useState('');
  useEffect(() => {
    if (account && !pushRecipient) setPushRecipient(account);
  }, [account, pushRecipient]);
  const pushRecipientValid = isValidAddress(pushRecipient);

  const [allowBasket, setAllowBasket] = useState(false);

  const [externalRecipient, setExternalRecipient] = useState('');
  const externalRecipientValid = isValidAddressForChain(
    externalRecipient,
    selected.moveableKey[0],
  );
  const needsExternalRecipient = mode === 'redeem' && isExternalRoute;

  // Pre-flight Route 2 check: SDK may not yet carry a MOVEABLE.TOKEN entry
  // for every chain. When missing, any external-route tx can't run.
  const moveableAvailable = useMemo(() => {
    if (!PushChain) return true; // optimistic until SDK loads
    const [chainKey, symbolKey] = selected.moveableKey;
    return resolveMoveableToken(PushChain.CONSTANTS, chainKey, symbolKey) !== undefined;
  }, [PushChain, selected.moveableKey]);
  const externalBlocked = isExternalRoute && !moveableAvailable;

  // --- execution ---------------------------------------------------------
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const submitting =
    stage.kind === 'signing' ||
    stage.kind === 'broadcasting' ||
    stage.kind === 'step2-signing' ||
    stage.kind === 'step2-broadcasting';

  const handleConvert = async () => {
    if (!pushChainClient || !PushChain || !account) return;
    if (!amountValid || exceedsBalance || solventHalt || externalBlocked) return;
    if (advanced && !pushRecipientValid) return;
    if (needsExternalRecipient && !externalRecipientValid) return;

    const helpers = PushChain.utils.helpers as unknown as HelpersLike;
    const target = (advanced ? pushRecipient : account) as `0x${string}`;

    setStage({ kind: 'signing' });

    try {
      if (mode === 'mint') {
        const legs: CascadeLeg[] = [
          buildApproveLeg(helpers, selected.address, PUSD_MANAGER_ADDRESS as `0x${string}`, parsedAmount),
          buildDepositLeg(helpers, PUSD_MANAGER_ADDRESS as `0x${string}`, selected.address, parsedAmount, target),
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const txOptions: any = {
          to: '0x0000000000000000000000000000000000000000',
          value: 0n,
          data: legs,
        };
        if (isExternalRoute) {
          const [chainKey, symbolKey] = selected.moveableKey;
          const moveable = resolveMoveableToken(PushChain.CONSTANTS, chainKey, symbolKey);
          if (moveable) txOptions.funds = { amount: parsedAmount, token: moveable };
        }
        const tx = await pushChainClient.universal.sendTransaction(txOptions);
        const hash = tx.hash as `0x${string}`;
        setStage({ kind: 'broadcasting', hash });
        await tx.wait();
        setStage({ kind: 'confirmed', hash });
        setAmount('');
        return;
      }

      // --- REDEEM -------------------------------------------------------
      // Step 1: burn PUSD on Push Chain, receive the reserve at the UEA.
      const legs: CascadeLeg[] = [
        buildApproveLeg(helpers, PUSD_ADDRESS as `0x${string}`, PUSD_MANAGER_ADDRESS as `0x${string}`, parsedAmount),
        buildRedeemLeg(
          helpers,
          PUSD_MANAGER_ADDRESS as `0x${string}`,
          parsedAmount,
          selected.address,
          allowBasket,
          target,
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
      setStage({ kind: 'broadcasting', hash: step1Hash });
      await tx1.wait();
      setStage({ kind: 'confirmed', hash: step1Hash });

      if (!needsExternalRecipient) {
        setAmount('');
        return;
      }

      // Step 2: Route 2 forward to the selected token's origin chain.
      setStage({ kind: 'step2-signing', prevHash: step1Hash });
      const [chainKey, symbolKey] = selected.moveableKey;
      const moveable = resolveMoveableToken(PushChain.CONSTANTS, chainKey, symbolKey);
      if (!moveable) {
        throw new Error(
          `MOVEABLE token for ${symbolKey} on ${chainKey} not available — pick a different asset or keep the payout on Push Chain.`,
        );
      }
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
      setAmount('');
    } catch (err) {
      setStage({ kind: 'error', message: err instanceof Error ? err.message : 'Transaction failed' });
    }
  };

  // --- derived labels ----------------------------------------------------
  // For mint the "wallet" option uses the connected origin chain's label
  // (properly resolved from CAIP-2). For redeem the "external" option uses
  // the selected token's chain label — because redeem destination is the
  // token's own chain, not the wallet's.
  const routeConfig = (() => {
    if (mode === 'mint') {
      return {
        label: 'SOURCE',
        externalLabel: account ? `FROM ${originChainDisplay}` : 'FROM YOUR WALLET',
        pushLabel: 'FROM PUSH CHAIN',
      };
    }
    return {
      label: 'DESTINATION',
      externalLabel: `TO ${selected.chainLabel}`,
      pushLabel: 'KEEP ON PUSH CHAIN',
    };
  })();

  // What chain tag shows on the amount pills.
  const mintSourceChainShort = isExternalRoute ? selected.chainShort : 'PUSH';
  const redeemDestChainShort = isExternalRoute ? selected.chainShort : 'PUSH';

  const feeBpsLabel = `${(baseFeeBps / 100).toFixed(2)}%`;

  const ctaLabel = (() => {
    if (!account) return 'CONNECT TO CONVERT';
    if (stage.kind === 'signing') return 'SIGNING…';
    if (stage.kind === 'broadcasting') return mode === 'mint' ? 'MINTING…' : 'REDEEMING…';
    if (stage.kind === 'step2-signing') return 'SIGNING PAYOUT…';
    if (stage.kind === 'step2-broadcasting') return 'PAYING OUT…';
    if (solventHalt) return 'HALTED · SOLVENCY CHECK FAILED';
    if (externalBlocked) return `${selected.chainShort} BRIDGE NOT AVAILABLE`;
    if (!amountValid) return mode === 'mint' ? 'MINT PUSD' : 'REDEEM PUSD';
    if (exceedsBalance) return 'INSUFFICIENT BALANCE';
    if (advanced && !pushRecipientValid) return 'INVALID PUSH RECIPIENT';
    if (needsExternalRecipient && !externalRecipientValid) {
      return `INVALID ${selected.chainShort} RECIPIENT`;
    }
    const amt = formatAmount(parsedAmount, decimals, { maxFractionDigits: 2 });
    if (mode === 'mint') return `MINT ${amt} PUSD →`;
    return needsExternalRecipient
      ? `REDEEM → SEND TO ${selected.chainShort} →`
      : `REDEEM ${amt} PUSD →`;
  })();

  const ctaDisabled =
    !account ||
    submitting ||
    !amountValid ||
    exceedsBalance ||
    solventHalt ||
    externalBlocked ||
    (advanced && !pushRecipientValid) ||
    (needsExternalRecipient && !externalRecipientValid);

  // --- render helpers ----------------------------------------------------
  const title = advanced ? (mode === 'mint' ? 'Mint PUSD' : 'Redeem PUSD') : 'Convert.';
  const kicker = advanced
    ? mode === 'mint'
      ? '1:1 · NO HAIRCUT'
      : '1:1 · BASE FEE'
    : 'NO. 01 · ONE ACTION';

  const plainBlurb = (() => {
    if (mode === 'mint') {
      return isExternalRoute
        ? `Pay with ${selected.symbol} on ${selected.chainLabel}. Receive PUSD on Push Chain in one signature.`
        : `Pay with ${selected.symbol}·${selected.chainShort} held on Push Chain. Receive PUSD.`;
    }
    return isExternalRoute
      ? `Burn PUSD on Push Chain. Receive ${selected.symbol} on ${selected.chainLabel}.`
      : `Burn PUSD on Push Chain. Receive ${selected.symbol}·${selected.chainShort} on Push Chain.`;
  })();

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
          aria-selected={mode === 'mint'}
          className={`convert__tab ${mode === 'mint' ? 'convert__tab--active' : ''}`}
          onClick={() => {
            setMode('mint');
            setAmount('');
            setStage({ kind: 'idle' });
          }}
        >
          Mint
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'redeem'}
          className={`convert__tab ${mode === 'redeem' ? 'convert__tab--active' : ''}`}
          onClick={() => {
            setMode('redeem');
            setAmount('');
            setStage({ kind: 'idle' });
          }}
        >
          Redeem
        </button>
      </div>

      <div className="convert__body">
        {/* Route switch — SOURCE for mint, DESTINATION for redeem */}
        <div className="route-switch">
          <div className="route-switch__label">{routeConfig.label}</div>
          <div className="route-switch__options" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={effectiveRoute === 'external'}
              className={`route-switch__opt ${effectiveRoute === 'external' ? 'is-active' : ''}`}
              onClick={() => {
                setRouteTouched(true);
                setRoute('external');
              }}
              disabled={!account && mode === 'mint'}
              title={!account && mode === 'mint' ? 'Connect a wallet to pick a source' : ''}
            >
              {routeConfig.externalLabel}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveRoute === 'push'}
              className={`route-switch__opt ${effectiveRoute === 'push' ? 'is-active' : ''}`}
              onClick={() => {
                setRouteTouched(true);
                setRoute('push');
              }}
            >
              {routeConfig.pushLabel}
            </button>
          </div>
        </div>

        {/* Amount in */}
        <div>
          <div className="input-head">
            <span>{mode === 'mint' ? 'PAY' : 'BURN'}</span>
            <button
              type="button"
              disabled={!balanceKnown || balance === 0n}
              onClick={() => {
                const base = 10n ** BigInt(decimals);
                const whole = balance / base;
                const frac = balance % base;
                const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
                setAmount(fracStr ? `${whole}.${fracStr}` : whole.toString());
              }}
            >
              {balanceKnown
                ? `BALANCE ${balanceLoading ? '…' : formatAmount(balance, decimals, { maxFractionDigits: 2 })} · MAX`
                : `BALANCE ON ${originChainDisplay}`}
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
              <button
                type="button"
                className="selector-btn"
                onClick={() => setShowSelector((s) => !s)}
                disabled={submitting}
              >
                <TokenPill symbol={selected.symbol} chainShort={mintSourceChainShort} size="sm" />
                <span className="selector-btn__caret">▾</span>
              </button>
            ) : (
              <TokenPill symbol="PUSD" chainShort="PUSH" size="md" />
            )}
          </div>
          {mode === 'mint' && showSelector && (
            <div className="selector-panel" role="listbox" style={{ marginTop: 6 }}>
              {eligibleTokens.map((t) => {
                const active = t.address === selected.address;
                const onYourChain = originChainKey === t.moveableKey[0];
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
                      <TokenPill
                        symbol={t.symbol}
                        chainShort={isExternalRoute ? t.chainShort : 'PUSH'}
                        size="sm"
                      />
                      <span className="meta">{t.chainLabel}</span>
                      {isExternalRoute && onYourChain && (
                        <span className="chip chip--accent">YOUR WALLET</span>
                      )}
                    </div>
                    <span className="addr">{t.address.slice(0, 6)}…{t.address.slice(-4)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Amount out */}
        <div>
          <div className="input-head">
            <span>RECEIVE</span>
            <span>1 : 1</span>
          </div>
          <div className="input-shell">
            <div
              className="input-shell__amount"
              aria-readonly="true"
              style={{ color: amountValid ? 'var(--c-magenta)' : 'var(--c-ink-mute)' }}
            >
              {amountValid ? formatAmount(receiveAmount, 6, { maxFractionDigits: 2 }) : '0.00'}
            </div>
            {mode === 'mint' ? (
              <TokenPill symbol="PUSD" chainShort="PUSH CHAIN" size="md" />
            ) : (
              <button
                type="button"
                className="selector-btn"
                onClick={() => setShowSelector((s) => !s)}
                disabled={submitting}
              >
                <TokenPill
                  symbol={selected.symbol}
                  chainShort={redeemDestChainShort}
                  size="sm"
                />
                <span className="selector-btn__caret">▾</span>
              </button>
            )}
          </div>
          {mode === 'redeem' && showSelector && (
            <div className="selector-panel" role="listbox" style={{ marginTop: 6 }}>
              {eligibleTokens.map((t) => {
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
                      <TokenPill
                        symbol={t.symbol}
                        chainShort={isExternalRoute ? t.chainShort : 'PUSH'}
                        size="sm"
                      />
                      <span className="meta">{t.chainLabel}</span>
                    </div>
                    <span className="addr">{t.address.slice(0, 6)}…{t.address.slice(-4)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Advanced-only — Push Chain recipient override + basket mode */}
        {advanced && (
          <>
            <div>
              <div className="input-head">
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
            </div>

            {mode === 'redeem' && (
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
                  <div className="toggle-row__label">
                    BASKET MODE {allowBasket ? '[ON]' : '[OFF]'}
                  </div>
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
            )}
          </>
        )}

        {/* Destination address — required whenever redeem delivers off Push. */}
        {needsExternalRecipient && (
          <div>
            <div className="input-head">
              <span>RECIPIENT ({selected.chainShort})</span>
              <span>•</span>
            </div>
            <div className="input-row">
              <input
                type="text"
                placeholder={`Address on ${selected.chainLabel}`}
                value={externalRecipient}
                onChange={(e) => setExternalRecipient(e.target.value.trim())}
                disabled={submitting}
                spellCheck={false}
              />
              {externalRecipient && !externalRecipientValid && (
                <span className="input-row__hint input-row__hint--warn">
                  ✕ Not a valid {selected.moveableKey[0].startsWith('SOLANA') ? 'Solana' : 'EVM'} address
                  for {selected.chainLabel}.
                </span>
              )}
            </div>
          </div>
        )}

        {/* 2x2 meta grid */}
        <div className="convert__grid">
          <div>
            <div className="convert__grid-label">FEE</div>
            <div className="convert__grid-value">
              {mode === 'mint' ? '0.00% · None' : feeBpsLabel}
            </div>
          </div>
          <div>
            <div className="convert__grid-label">RATE</div>
            <div className="convert__grid-value">1.000000</div>
          </div>
          <div>
            <div className="convert__grid-label">SOURCE</div>
            <div className="convert__grid-value">
              {mode === 'mint'
                ? `${selected.symbol} · ${isExternalRoute ? selected.chainLabel : 'PUSH CHAIN'}`
                : 'PUSD · PUSH CHAIN'}
            </div>
          </div>
          <div>
            <div className="convert__grid-label">DESTINATION</div>
            <div className="convert__grid-value">
              {mode === 'mint'
                ? 'PUSD · PUSH CHAIN'
                : `${selected.symbol} · ${isExternalRoute ? selected.chainLabel : 'PUSH CHAIN'}`}
            </div>
          </div>
        </div>

        <button
          type="button"
          className={`btn ${solventHalt ? 'btn--danger' : 'btn--accent'} btn--block convert__cta`}
          onClick={account ? handleConvert : handleConnectToPushWallet}
          disabled={ctaDisabled && !!account}
        >
          {ctaLabel}
        </button>

        <p className="convert__fineprint">{plainBlurb}</p>

        {externalBlocked && (
          <div className="feedback feedback--warn">
            <div className="feedback__title">BRIDGE UNAVAILABLE · {selected.chainLabel}</div>
            <div className="mono" style={{ marginTop: 4 }}>
              The SDK does not yet support moving {selected.symbol} between Push Chain and{' '}
              {selected.chainLabel}. Switch to{' '}
              <strong>{mode === 'mint' ? 'FROM PUSH CHAIN' : 'KEEP ON PUSH CHAIN'}</strong> or pick a
              different asset.
            </div>
          </div>
        )}

        {stage.kind === 'error' && (
          <div className="feedback feedback--error">
            <div className="feedback__title">TRANSACTION FAILED</div>
            <div className="mono">{stage.message}</div>
          </div>
        )}
        {stage.kind !== 'idle' && stage.kind !== 'error' && stage.kind !== 'signing' && (
          <div
            className={`feedback ${
              (stage.kind === 'confirmed' && !needsExternalRecipient) ||
              stage.kind === 'step2-confirmed'
                ? 'feedback--success'
                : ''
            }`}
          >
            <div className="feedback__title">
              {needsExternalRecipient ? 'STEP 1 · ' : ''}
              {stage.kind === 'broadcasting' ? 'BROADCASTING' : 'CONFIRMED'}
            </div>
            <a
              className="link-mono"
              href={explorerTx('prevHash' in stage ? stage.prevHash : stage.hash)}
              target="_blank"
              rel="noreferrer"
            >
              {truncHash('prevHash' in stage ? stage.prevHash : stage.hash)} ↗
            </a>
            {(stage.kind === 'step2-signing' ||
              stage.kind === 'step2-broadcasting' ||
              stage.kind === 'step2-confirmed') && (
              <>
                <div className="feedback__title" style={{ marginTop: 10 }}>
                  STEP 2 ·{' '}
                  {stage.kind === 'step2-signing'
                    ? 'SIGNING…'
                    : stage.kind === 'step2-broadcasting'
                      ? 'BROADCASTING'
                      : 'CONFIRMED'}
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
      </div>
    </div>
  );
}

/**
 * ConvertPanel — one panel, both directions.
 *
 * Two tabs — MINT and REDEEM — that update the URL (`/convert/mint`,
 * `/convert/redeem`) so the panel is deep-linkable. `initialMode` is set
 * by the parent from the route param and flips when the user picks a tab.
 *
 * Mint — asks "where is the money coming FROM?"
 *   - Primary route = the connected wallet's origin chain. The SDK bridges
 *     the token in one signature via `funds`. Dropdown is locked to tokens
 *     that exist on that origin chain.
 *   - Secondary route = "use Donut-side tokens already on Push Chain" —
 *     surfaced as a subtle link below the source header, not as a peer
 *     button. When chosen, the dropdown opens up to every reserve token.
 *
 * Redeem — always burns PUSD on Push Chain; the question is "where does
 * the money go TO?" The token selector doubles as a destination picker.
 *   - Default destination = the selected token's origin chain. Needs a
 *     recipient address on that chain.
 *   - Alt destination = PUSH CHAIN. Deliver the Donut-side ERC-20 to the
 *     user's UEA, no bridge leg.
 */

import { usePushChain, usePushChainClient, usePushWalletContext } from '@pushchain/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PUSD_ADDRESS, PUSD_MANAGER_ADDRESS, PUSD_PLUS_ADDRESS } from '../contracts/config';
import { PUSD_WRAP_TOKEN, TOKENS, type ReserveToken } from '../contracts/tokens';
import { useExternalTokenBalance } from '../hooks/useExternalTokenBalance';
import { useInvariants } from '../hooks/useInvariants';
import { useNAV } from '../hooks/useNAV';
import { useProtocolStats } from '../hooks/useProtocolStats';
import { usePUSDBalance } from '../hooks/usePUSDBalance';
import { usePUSDPlusBalance } from '../hooks/usePUSDPlusBalance';
import { useRedeemRecipient } from '../hooks/useRedeemRecipient';
import { useTokenBalance } from '../hooks/useTokenBalance';
import {
  buildApproveLeg,
  buildDepositLeg,
  buildDepositToPlusLeg,
  buildRedeemFromPlusLeg,
  buildRedeemLeg,
  type CascadeLeg,
  type HelpersLike,
} from '../lib/cascade';
import { explorerAddressForChain, explorerTxForChain } from '../lib/externalRpc';
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
/** Which token does this transaction mint or burn? PUSD+ is the default. */
type Product = 'pusd-plus' | 'pusd';

type Stage =
  | { kind: 'idle' }
  | { kind: 'preparing' }
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // ?wrap=1 — opens the panel with PUSD as the source/destination asset, for
  // the PUSD ↔ PUSD+ wrap path. Surfaced from the Dashboard cards. The user
  // can dismiss the wrap mode in-panel; the param is cleared when they do.
  const wrapMode = searchParams.get('wrap') === '1';
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();
  const { handleConnectToPushWallet, handleUserLogOutEvent } = usePushWalletContext();
  const invariants = useInvariants();
  const { baseFeeBps } = useProtocolStats();

  const account = (pushChainClient?.universal?.account ?? null) as `0x${string}` | null;
  const origin = pushChainClient?.universal?.origin ?? null;
  const originAddress = origin?.address ?? null;

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

  // --- mode + route + product -------------------------------------------
  const [mode, setMode] = useState<Mode>(initialMode);
  useEffect(() => setMode(initialMode), [initialMode]);

  // PUSD+ is the default product when configured; the panel falls back to
  // plain PUSD when VITE_PUSD_PLUS_ADDRESS is unset (so the panel still
  // works in pre-v2 environments).
  const plusEnabled = !!PUSD_PLUS_ADDRESS;
  const [product, setProduct] = useState<Product>(plusEnabled ? 'pusd-plus' : 'pusd');
  const isPlus = product === 'pusd-plus';
  const productLabel = isPlus ? 'PUSD+' : 'PUSD';
  const nav = useNAV();

  // For mint, external route is default whenever the wallet is on an external
  // chain. For redeem, external = "deliver on the selected token's chain".
  // Push-Chain-origin wallets default to push on both tabs.
  const [route, setRoute] = useState<Route>(originIsPush ? 'push' : 'external');
  const [routeTouched, setRouteTouched] = useState(false);
  useEffect(() => {
    if (routeTouched) return;
    setRoute(originIsPush ? 'push' : 'external');
  }, [originIsPush, routeTouched]);

  // Route toggle is meaningful only after connect. Pre-connect we render the
  // "push" route (shows all tokens, no cross-chain wiring yet). Wrap mode
  // also forces push: PUSD lives only on Push Chain, so any wrap/unwrap
  // payout is delivered there regardless of wallet origin.
  const effectiveRoute: Route = !account || wrapMode ? 'push' : route;
  const isExternalRoute = effectiveRoute === 'external';

  // --- tokens ------------------------------------------------------------
  // Mint + external route: lock the dropdown to the wallet's origin chain.
  // Mint + push route OR redeem: all reserve tokens.
  // The PUSD wrap pseudo-entry only appears when ?wrap=1 is set — the
  // PUSD ↔ PUSD+ wrap path is a niche flow surfaced from the Dashboard,
  // not a regular dropdown option.
  const eligibleTokens = useMemo<readonly ReserveToken[]>(() => {
    if (wrapMode && isPlus) return [PUSD_WRAP_TOKEN];
    if (mode === 'mint' && isExternalRoute && originChainKey) {
      const filtered = filterTokensByChainKey(TOKENS, originChainKey);
      return filtered.length ? filtered : TOKENS;
    }
    return TOKENS;
  }, [mode, isExternalRoute, originChainKey, wrapMode, isPlus]);

  const [selected, setSelected] = useState<ReserveToken>(eligibleTokens[0] ?? TOKENS[0]);
  const [showSelector, setShowSelector] = useState(false);

  // Selected asset is the PUSD wrap pseudo-token? Forces push route, uses
  // PUSD balance, and routes through the wrap/unwrap leg of depositToPlus /
  // redeemFromPlus.
  const isPusdAsset = selected.address.toLowerCase() === PUSD_ADDRESS.toLowerCase();

  useEffect(() => {
    if (!eligibleTokens.some((t) => t.address === selected.address) && eligibleTokens.length) {
      setSelected(eligibleTokens[0]);
    }
  }, [eligibleTokens, selected.address]);

  // --- amount + balances -------------------------------------------------
  const [amount, setAmount] = useState('');
  const { balance: pusdBalance, loading: pusdLoading } = usePUSDBalance();
  const { balance: pusdPlusBalance, loading: pusdPlusLoading } = usePUSDPlusBalance();
  const burnBalance = isPlus ? pusdPlusBalance : pusdBalance;
  const burnBalanceLoading = isPlus ? pusdPlusLoading : pusdLoading;
  const { balance: donutTokenBal, loading: donutTokenLoading } = useTokenBalance(
    selected.address,
    PUSD_MANAGER_ADDRESS as `0x${string}`,
  );
  // External-chain balance for mint → Route 2. Returns `available: false` when
  // the origin chain is non-EVM (Solana) or the SDK doesn't carry an address.
  const externalBal = useExternalTokenBalance(originChainKey, selected.symbol);

  // What "balance" row should we display on the PAY input?
  const mintBalanceKnown =
    mode === 'mint' && !!account && (isExternalRoute ? externalBal.available : true);
  const balanceKnown = mode === 'redeem' || mintBalanceKnown;

  const balance = useMemo(() => {
    if (mode === 'redeem') return burnBalance;
    // Wrap path (mint PUSD+ from PUSD): the user pays from their PUSD holdings.
    if (isPusdAsset) return pusdBalance;
    if (!isExternalRoute) return donutTokenBal;
    return externalBal.balance;
  }, [mode, isExternalRoute, isPusdAsset, burnBalance, pusdBalance, donutTokenBal, externalBal.balance]);

  const balanceLoading = useMemo(() => {
    if (mode === 'redeem') return burnBalanceLoading;
    if (isPusdAsset) return pusdLoading;
    if (!isExternalRoute) return donutTokenLoading;
    return externalBal.loading;
  }, [mode, isExternalRoute, isPusdAsset, burnBalanceLoading, pusdLoading, donutTokenLoading, externalBal.loading]);

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
    // PUSD+ redeem path is fee-exempt (manager._payoutToUser fee=0 for vault).
    if (isPlus) return 0n;
    return (parsedAmount * BigInt(baseFeeBps)) / 10_000n;
  }, [mode, parsedAmount, baseFeeBps, isPlus]);

  // v2.1: PUSD+ mint/redeem amounts go through NAV. PUSD direct mint/redeem
  // stay 1:1 (PUSD is 1:1 par-backed by manager reserves).
  const receiveAmount = useMemo(() => {
    if (parsedAmount === 0n) return 0n;
    const NAV_PRECISION = 1_000_000_000_000_000_000n; // 1e18
    if (mode === 'mint') {
      if (isPlus && nav.navE18 > 0n) {
        // plusOut = pusdIn × 1e18 / navE18  (pre-deposit NAV; matches vault.previewMintPlus)
        return (parsedAmount * NAV_PRECISION) / nav.navE18;
      }
      return parsedAmount;
    }
    // redeem
    if (isPlus && nav.navE18 > 0n) {
      // pusdOwed = plusIn × navE18 / 1e18  (matches vault.previewBurnPlus)
      return (parsedAmount * nav.navE18) / NAV_PRECISION;
    }
    return parsedAmount - feeAmount;
  }, [mode, parsedAmount, feeAmount, isPlus, nav.navE18]);

  // "Exact out" helper: solve for burn so that (burn - burn*fee%) = current parsedAmount.
  const handleExactReceive = () => {
    if (!amountValid || baseFeeBps === 0) return;
    const divisor = 10_000n - BigInt(baseFeeBps);
    const invertedBurn = (parsedAmount * 10_000n + divisor - 1n) / divisor; // ceiling div
    const base = 10n ** BigInt(decimals);
    const whole = invertedBurn / base;
    const frac = invertedBurn % base;
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
    setAmount(fracStr ? `${whole}.${fracStr}` : whole.toString());
  };

  // --- redeem recipient + advanced fields --------------------------------
  const [allowBasket, setAllowBasket] = useState(false);

  const [externalRecipient, setExternalRecipient] = useState('');
  const [recipientTouched, setRecipientTouched] = useState(false);
  const needsExternalRecipient = mode === 'redeem' && isExternalRoute;

  // --- mint recipient ---------------------------------------------------
  // Mint always lands on Push Chain (an EVM address). The contract supports
  // depositing to an arbitrary recipient; default to the connected UEA so
  // the common case is friction-free, and let advanced users override.
  const [mintRecipient, setMintRecipient] = useState('');
  const [mintRecipientTouched, setMintRecipientTouched] = useState(false);

  useEffect(() => {
    if (mintRecipientTouched) return;
    setMintRecipient(account ?? '');
  }, [account, mintRecipientTouched]);

  // Reset touched flag when mode/account changes — switching tabs or accounts
  // should restore the auto-derived default.
  useEffect(() => { setMintRecipientTouched(false); }, [mode, account]);

  const mintRecipientValid = isValidAddress(mintRecipient);

  // Auto-derive the default recipient for redeem based on three branches:
  //  1. Push route   → account (UEA)
  //  2. Same chain   → originAddress
  //  3. Other chain  → CEA from UEAFactory.getUEAForOrigin()
  const autoRecipient = useRedeemRecipient(
    isExternalRoute,
    selected.moveableKey[0],
    originChainKey,
    origin?.chain ?? '',
    account,
    originAddress,
    selected.chainLabel,
  );

  // Sync auto-derived address into the input whenever the user hasn't overridden it.
  useEffect(() => {
    if (recipientTouched) return;
    if (autoRecipient.address) setExternalRecipient(autoRecipient.address);
  }, [autoRecipient.address, recipientTouched]);

  // Reset touched flag when mode / route / token changes.
  useEffect(() => { setRecipientTouched(false); }, [mode, effectiveRoute, selected.address]);

  // Push route recipient is always an EVM address; external route is chain-specific.
  const externalRecipientValid = isExternalRoute
    ? isValidAddressForChain(externalRecipient, selected.moveableKey[0])
    : isValidAddress(externalRecipient);

  // Pre-flight Route 2 check: SDK may not yet carry a MOVEABLE.TOKEN entry
  // for every chain. When missing, any external-route tx can't run.
  const moveableAvailable = useMemo(() => {
    if (!PushChain) return true; // optimistic until SDK loads
    const [chainKey, symbolKey] = selected.moveableKey;
    return resolveMoveableToken(PushChain.CONSTANTS, chainKey, symbolKey) !== undefined;
  }, [PushChain, selected.moveableKey]);
  const externalBlocked = isExternalRoute && !moveableAvailable;

  // Pre-flight reserve check: when basket is off the manager must hold enough
  // of the selected token to cover the full redemption amount.
  const reserveShortfall = useMemo(() => {
    if (mode !== 'redeem' || allowBasket || parsedAmount === 0n) return false;
    const row = invariants.perToken.find(
      (r) => r.address.toLowerCase() === selected.address.toLowerCase(),
    );
    if (!row) return false; // data not loaded yet — optimistic
    return row.balance < parsedAmount;
  }, [mode, allowBasket, parsedAmount, invariants.perToken, selected.address]);

  // --- execution ---------------------------------------------------------
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [progressNote, setProgressNote] = useState('');
  const submitting =
    stage.kind === 'preparing' ||
    stage.kind === 'signing' ||
    stage.kind === 'broadcasting' ||
    stage.kind === 'step2-signing' ||
    stage.kind === 'step2-broadcasting';

  const handleConvert = async () => {
    if (!pushChainClient || !PushChain || !account) return;
    if (!amountValid || exceedsBalance || solventHalt || externalBlocked || reserveShortfall) return;
    if (mode === 'redeem' && !externalRecipientValid) return;
    if (mode === 'mint' && !mintRecipientValid) return;

    const helpers = PushChain.utils.helpers as unknown as HelpersLike;
    // Three branches for the on-chain "recipient" arg to deposit/redeem:
    //   - mint                        → mintRecipient (Push Chain EVM, defaults to UEA)
    //   - redeem · push route         → externalRecipient (Push Chain EVM, defaults to UEA)
    //   - redeem · external route     → account (UEA holds the reserve between hops; the
    //                                   outbound leg's `to` field carries the real
    //                                   external-chain destination)
    const target = (() => {
      if (mode === 'mint') return mintRecipient;
      if (!isExternalRoute) return externalRecipient;
      return account;
    })() as `0x${string}`;

    setStage({ kind: 'preparing' });
    setProgressNote('');

    try {
      if (mode === 'mint') {
        const mintLeg = isPlus
          ? buildDepositToPlusLeg(
              helpers,
              PUSD_MANAGER_ADDRESS as `0x${string}`,
              selected.address,
              parsedAmount,
              target,
            )
          : buildDepositLeg(
              helpers,
              PUSD_MANAGER_ADDRESS as `0x${string}`,
              selected.address,
              parsedAmount,
              target,
            );
        const legs: CascadeLeg[] = [
          buildApproveLeg(helpers, selected.address, PUSD_MANAGER_ADDRESS as `0x${string}`, parsedAmount),
          mintLeg,
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
        setStage({ kind: 'signing' });
        const tx = await pushChainClient.universal.sendTransaction(txOptions);
        const hash = tx.hash as `0x${string}`;
        setStage({ kind: 'broadcasting', hash });
        await tx.wait();
        setStage({ kind: 'confirmed', hash });
        setAmount('');
        return;
      }

      // --- REDEEM -------------------------------------------------------
      // Shared cascade legs for step 1.
      // PUSD redeem  → approve PUSD + manager.redeem.
      // PUSD+ redeem → manager.redeemFromPlus pulls PUSD+ via vault.burnPlus
      //                (MANAGER_ROLE-gated _burn). No allowance needed; we
      //                still approve defensively in case future paths need it.
      const burnTokenAddress = (isPlus
        ? (PUSD_PLUS_ADDRESS as `0x${string}`)
        : (PUSD_ADDRESS as `0x${string}`));
      const redeemLeg = isPlus
        ? buildRedeemFromPlusLeg(
            helpers,
            PUSD_MANAGER_ADDRESS as `0x${string}`,
            parsedAmount,
            selected.address,
            allowBasket,
            target,
          )
        : buildRedeemLeg(
            helpers,
            PUSD_MANAGER_ADDRESS as `0x${string}`,
            parsedAmount,
            selected.address,
            allowBasket,
            target,
          );
      const legs: CascadeLeg[] = [
        buildApproveLeg(helpers, burnTokenAddress, PUSD_MANAGER_ADDRESS as `0x${string}`, parsedAmount),
        redeemLeg,
      ];

      // Resolve the outbound leg token & destination up front so both paths below can share them.
      let moveable: ReturnType<typeof resolveMoveableToken> = undefined;
      let destChain: string | undefined;
      if (needsExternalRecipient) {
        const [chainKey, symbolKey] = selected.moveableKey;
        moveable = resolveMoveableToken(PushChain.CONSTANTS, chainKey, symbolKey);
        if (!moveable) {
          throw new Error(
            `MOVEABLE token for ${symbolKey} on ${chainKey} not available — pick a different asset or keep the payout on Push Chain.`,
          );
        }
        // CAIP-2 value (`eip155:…` / `solana:…`) — the SDK route validator
        // rejects the friendly key (throws `ChainNotSupportedError`).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        destChain = (PushChain.CONSTANTS.CHAIN as any)[chainKey];
      }

      // Single-signature cascade: prepare both legs, compose them into one
      // Push Chain tx, and let universal.executeTransactions() handle it.
      const params1 = {
        to: '0x0000000000000000000000000000000000000000',
        value: 0n,
        data: legs,
      };
      console.log('[prepareTransaction] leg 1 params:', params1);
      const prepared1 = await pushChainClient.universal.prepareTransaction({
        to: '0x0000000000000000000000000000000000000000',
        value: 0n,
        data: legs,
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const preparedTxs = [prepared1];

      if (needsExternalRecipient) {
        const params2 = {
          to: { address: externalRecipient, chain: destChain },
          value: 0n,
          data: '0x',
          funds: { amount: receiveAmount, token: moveable },
        };
        console.log('[prepareTransaction] leg 2 params:', params2);
        const prepared2 = await pushChainClient.universal.prepareTransaction({
          to: { address: externalRecipient as `0x${string}`, chain: destChain },
          value: 0n,
          data: '0x',
          funds: { amount: receiveAmount, token: moveable },
        } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        preparedTxs.push(prepared2);
      }

      setStage({ kind: 'signing' });
      const cascade = await pushChainClient.universal.executeTransactions(preparedTxs);
      const initialHash = cascade.initialTxHash as `0x${string}`;
      setStage({ kind: 'broadcasting', hash: initialHash });
      setProgressNote('Waiting for Push Chain confirmation…');

      // Track per-hop progress so the two-stage UI (broadcasting → paying-out
      // → confirmed) still works with a single signature.
      await cascade.wait({
        progressHook: (ev) => {
          console.log('[progressHook] ev:', ev);
          // Always update the progress note regardless of route.
          if (ev.hopIndex === 0) {
            setProgressNote(
              ev.status === 'confirmed'
                ? needsExternalRecipient
                  ? `Confirmed on Push Chain · Sending to ${selected.chainLabel}…`
                  : 'Confirmed on Push Chain'
                : 'Waiting for Push Chain confirmation…',
            );
          } else if (ev.hopIndex === 1) {
            setProgressNote(
              ev.status === 'confirmed'
                ? `Confirmed on ${selected.chainLabel}`
                : ev.txHash
                  ? `Submitted to ${selected.chainLabel} · Waiting for confirmation…`
                  : `Sending to ${selected.chainLabel}…`,
            );
          }

          if (!needsExternalRecipient) return;
          if (ev.hopIndex === 0 && ev.status === 'confirmed') {
            setStage({ kind: 'step2-broadcasting', prevHash: initialHash, hash: '0x' as `0x${string}` });
            return;
          }
          if (ev.hopIndex === 1 && ev.txHash) {
            setStage({
              kind: 'step2-broadcasting',
              prevHash: initialHash,
              hash: ev.txHash as `0x${string}`,
            });
          }
        },
      });

      if (needsExternalRecipient) {
        const hop1 = cascade.hops[1];
        const outHash = (hop1?.outboundDetails?.externalTxHash ?? hop1?.txHash ?? initialHash) as `0x${string}`;
        setStage({ kind: 'step2-confirmed', prevHash: initialHash, hash: outHash });
      } else {
        setStage({ kind: 'confirmed', hash: initialHash });
      }
      setAmount('');
    } catch (err) {
      setStage({ kind: 'error', message: err instanceof Error ? err.message : 'Transaction failed' });
    }
  };

  // --- "Switch account" affordance --------------------------------------
  // Disconnect first, wait for account to become null, then open connect.
  // Calling handleConnectToPushWallet immediately after logout leaves the
  // UI-kit in a transitional state that causes the spinner to hang.
  const pendingConnectRef = useRef(false);
  useEffect(() => {
    if (pendingConnectRef.current && !account) {
      pendingConnectRef.current = false;
      handleConnectToPushWallet();
    }
  }, [account, handleConnectToPushWallet]);

  const handleSwitchAccount = () => {
    setRouteTouched(false);
    if (account) {
      pendingConnectRef.current = true;
      handleUserLogOutEvent();
    } else {
      handleConnectToPushWallet();
    }
  };

  // --- derived labels ----------------------------------------------------
  const feeBpsLabel = isPlus ? `NAV ${nav.pusdPerPlus.toFixed(6)}` : `${(baseFeeBps / 100).toFixed(2)}%`;

  // Source / destination strings for the header + summary.
  const sourceLabel = mode === 'mint'
    ? (isExternalRoute
        ? (account ? originChainDisplay : 'CONNECT A WALLET')
        : (account ? 'PUSH CHAIN' : selected.chainLabel))
    : 'PUSH CHAIN';

  const destLabel = mode === 'mint'
    ? 'PUSH CHAIN'
    : (account && !isExternalRoute ? 'PUSH CHAIN' : selected.chainLabel);

  // What chain tag shows on the amount pills.
  const mintSourceChainShort = isExternalRoute || !account ? selected.chainShort : 'PUSH';
  const redeemDestChainShort = isExternalRoute || !account ? selected.chainShort : 'PUSH';
  const destChainKey = isExternalRoute ? selected.moveableKey[0] : 'PUSH_TESTNET_DONUT';

  const ctaLabel = (() => {
    if (!account) return 'CONNECT TO CONVERT';
    if (stage.kind === 'preparing') return 'PREPARING…';
    if (stage.kind === 'signing') return 'SIGNING…';
    if (stage.kind === 'broadcasting') return mode === 'mint' ? `MINTING ${productLabel}…` : `REDEEMING ${productLabel}…`;
    if (stage.kind === 'step2-signing') return 'SIGNING PAYOUT…';
    if (stage.kind === 'step2-broadcasting') return 'PAYING OUT…';
    if (solventHalt) return 'HALTED · SOLVENCY CHECK FAILED';
    if (externalBlocked) return `${selected.chainShort} BRIDGE NOT AVAILABLE`;
    if (reserveShortfall) return `INSUFFICIENT ${selected.symbol} RESERVE`;
    if (!amountValid) return mode === 'mint' ? `MINT ${productLabel}` : `REDEEM ${productLabel}`;
    if (exceedsBalance) return 'INSUFFICIENT BALANCE';
    if (mode === 'redeem' && account && !externalRecipientValid) {
      return `INVALID ${isExternalRoute ? selected.chainShort : 'PUSH CHAIN'} RECIPIENT`;
    }
    if (mode === 'mint' && account && !mintRecipientValid) {
      return 'INVALID PUSH CHAIN RECIPIENT';
    }
    const amt = formatAmount(parsedAmount, decimals, { maxFractionDigits: 2 });
    if (mode === 'mint') return `MINT ${amt} ${productLabel} →`;
    return needsExternalRecipient
      ? `REDEEM → SEND TO ${selected.chainShort} →`
      : `REDEEM ${amt} ${productLabel} →`;
  })();

  const ctaDisabled =
    !account ||
    submitting ||
    !amountValid ||
    exceedsBalance ||
    solventHalt ||
    externalBlocked ||
    reserveShortfall ||
    (mode === 'redeem' && !!account && !externalRecipientValid) ||
    (mode === 'mint' && !!account && !mintRecipientValid);

  // --- render helpers ----------------------------------------------------
  const title = advanced
    ? (mode === 'mint' ? `Mint ${productLabel}` : `Redeem ${productLabel}`)
    : 'Convert.';
  const kicker = advanced
    ? mode === 'mint'
      ? (isPlus ? `NAV ${nav.pusdPerPlus.toFixed(6)} · YIELD-BEARING` : '1:1 · NO HAIRCUT')
      : (isPlus ? `NAV ${nav.pusdPerPlus.toFixed(6)} · YIELD-BEARING` : '1:1 · BASE FEE')
    : 'NO. 01 · ONE ACTION';

  const plainBlurb = (() => {
    if (mode === 'mint') {
      return isExternalRoute
        ? `Pay with ${selected.symbol} on ${selected.chainLabel}. Receive ${productLabel} on Push Chain in one signature.`
        : `Pay with ${selected.symbol}·${selected.chainShort} held on Push Chain. Receive ${productLabel}.`;
    }
    return isExternalRoute
      ? `Burn ${productLabel} on Push Chain. Receive ${selected.symbol} on ${selected.chainLabel}.`
      : `Burn ${productLabel} on Push Chain. Receive ${selected.symbol}·${selected.chainShort} on Push Chain.`;
  })();

  // --- tab switcher navigates the URL -----------------------------------
  const goMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setAmount('');
    setStage({ kind: 'idle' });
    if (advanced) navigate(`/convert/${next}`);
  };

  return (
    <div className="convert">
      <div className="convert__head">
        <div className="convert__title">{title}</div>
        <div className="convert__kicker">{kicker}</div>
      </div>

      {plusEnabled && (
        <div className="convert__product" role="tablist" aria-label="Product">
          <button
            type="button"
            role="tab"
            aria-selected={isPlus}
            className={`convert__product-btn ${isPlus ? 'convert__product-btn--active' : ''}`}
            onClick={() => {
              if (!isPlus) {
                setProduct('pusd-plus');
                setAmount('');
                setStage({ kind: 'idle' });
              }
            }}
            disabled={submitting}
          >
            PUSD+
            <span className="convert__product-tag">YIELD</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isPlus}
            className={`convert__product-btn ${!isPlus ? 'convert__product-btn--active' : ''}`}
            onClick={() => {
              if (isPlus) {
                setProduct('pusd');
                setAmount('');
                setStage({ kind: 'idle' });
              }
            }}
            disabled={submitting}
          >
            PUSD
            <span className="convert__product-tag">PAR</span>
          </button>
        </div>
      )}

      <div className="convert__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'mint'}
          className={`convert__tab ${mode === 'mint' ? 'convert__tab--active' : ''}`}
          onClick={() => goMode('mint')}
        >
          Mint
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'redeem'}
          className={`convert__tab ${mode === 'redeem' ? 'convert__tab--active' : ''}`}
          onClick={() => goMode('redeem')}
        >
          Redeem
        </button>
      </div>

      <div className="convert__body">
        {/* Wrap-mode banner — shown when arriving via /convert/...?wrap=1 from
            the Dashboard. The PUSD asset is locked; clicking × clears the
            param and returns the panel to the regular reserve flow. */}
        {wrapMode && isPlus && (
          <div className="convert__wrap-banner" role="status">
            <span>
              {mode === 'mint'
                ? 'WRAP MODE — converting PUSD into PUSD+'
                : 'UNWRAP MODE — converting PUSD+ back into PUSD'}
            </span>
            <button
              type="button"
              className="convert__wrap-banner-x"
              aria-label="Exit wrap mode"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete('wrap');
                setSearchParams(next, { replace: true });
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* SOURCE header — mint only, shown before the inputs */}
        {mode === 'mint' && (
          <div className="src-header">
            <div className="src-header__main">
              <span className="src-header__label">SOURCE</span>
              <span className="src-header__chain">{sourceLabel}</span>
            </div>
            <button
              type="button"
              className="src-header__action"
              onClick={handleSwitchAccount}
              disabled={submitting}
            >
              Minting from a different chain?{' '}
              <span className="src-header__action-link">
                {account ? 'Switch account ↗' : 'Connect Wallet ↗'}
              </span>
            </button>
          </div>
        )}

        {/* Secondary: switch mint route. Only shown when external is available
            and the selected asset can actually bridge (PUSD wrap can't). */}
        {mode === 'mint' && account && !originIsPush && !isPusdAsset && (
          <button
            type="button"
            className="src-header__aside"
            onClick={() => {
              setRouteTouched(true);
              setRoute((r) => (r === 'external' ? 'push' : 'external'));
            }}
            disabled={submitting}
          >
            {isExternalRoute
              ? '↳ Already hold reserves on Push Chain? Use those instead'
              : `↳ Pay from ${originChainDisplay} wallet instead`}
          </button>
        )}

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
                : `BALANCE ON ${account ? originChainDisplay : selected.chainLabel}`}
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
              <TokenPill symbol={productLabel} chainShort="PUSH" size="md" />
            )}
          </div>
          {mode === 'mint' && showSelector && (
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
                    <div className="selector-panel__lead">
                      <TokenPill
                        symbol={t.symbol}
                        chainShort={isExternalRoute || !account ? t.chainShort : 'PUSH'}
                        size="sm"
                      />
                      <span className="meta">{t.chainLabel}</span>
                    </div>
                    <a
                      className="addr"
                      href={explorerAddressForChain(t.address, 'PUSH_TESTNET_DONUT')}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.address.slice(0, 6)}…{t.address.slice(-4)} ↗
                    </a>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Amount out */}
        <div>
          <div className="input-head">
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              RECEIVE
              {mode === 'redeem' && baseFeeBps > 0 && (
                <button
                  type="button"
                  data-tooltip={
                    amountValid
                      ? `Receive exactly ${formatAmount(parsedAmount, decimals, { maxFractionDigits: 6 })} ${selected.symbol}. Increases burn slightly to cover the ${(baseFeeBps / 100).toFixed(2)}% fee`
                      : 'Enter an amount, then click to receive that exact amount'
                  }
                  className="exact-out-btn"
                  onClick={handleExactReceive}
                  disabled={!amountValid || submitting}
                >
                  ⇅ exact
                </button>
              )}
            </span>
            <span>{isPlus ? `NAV ${nav.pusdPerPlus.toFixed(6)}` : '1 : 1'}</span>
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
              <TokenPill symbol={productLabel} chainShort="PUSH CHAIN" size="md" />
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
                const resRow = invariants.perToken.find(
                  (r) => r.address.toLowerCase() === t.address.toLowerCase(),
                );
                const dotColor = !resRow
                  ? '#6b7280'
                  : resRow.balance === 0n
                    ? '#ef4444'
                    : parsedAmount > 0n && resRow.balance < parsedAmount
                      ? '#eab308'
                      : '#22c55e';
                return (
                  <button
                    key={t.address}
                    type="button"
                    className={active ? 'active' : undefined}
                    role="option"
                    aria-selected={active}
                    style={{ position: 'relative' }}
                    onClick={() => {
                      setSelected(t);
                      setShowSelector(false);
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 4,
                        background: dotColor,
                      }}
                    />
                    <div className="selector-panel__lead">
                      <TokenPill
                        symbol={t.symbol}
                        chainShort={isExternalRoute ? t.chainShort : 'PUSH'}
                        size="sm"
                      />
                      <span className="meta">{t.chainLabel}</span>
                    </div>
                    <a
                      className="addr"
                      href={explorerAddressForChain(t.address, 'PUSH_TESTNET_DONUT')}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.address.slice(0, 6)}…{t.address.slice(-4)} ↗
                    </a>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* DESTINATION + recipient — mint. Destination chain is fixed
            (Push Chain), so it lives inline with the recipient input
            instead of in a separate header row. */}
        {mode === 'mint' && account && (
          <div>
            <div className="input-head">
              <span>DESTINATION (PUSH CHAIN)</span>
              {mintRecipientTouched && (
                <button
                  type="button"
                  onClick={() => {
                    setMintRecipientTouched(false);
                    setMintRecipient(account);
                  }}
                  disabled={submitting}
                >
                  USE MY ADDRESS
                </button>
              )}
            </div>
            <div className="input-row">
              <input
                type="text"
                placeholder="0x…"
                value={mintRecipient}
                onChange={(e) => {
                  setMintRecipientTouched(true);
                  setMintRecipient(e.target.value.trim());
                }}
                disabled={submitting}
                spellCheck={false}
              />
              {!mintRecipientTouched && mintRecipient && (
                <span className="input-row__hint">
                  Your connected wallet on Push Chain. Change to mint to a different address.
                </span>
              )}
              {mintRecipient && !mintRecipientValid && (
                <span className="input-row__hint input-row__hint--warn">
                  ✕ Not a valid EVM address for Push Chain.
                </span>
              )}
            </div>
          </div>
        )}

        {reserveShortfall && mode === 'redeem' && (
          <div className="feedback feedback--warn">
            <div className="feedback__title">
              INSUFFICIENT {selected.symbol} RESERVE ON {selected.chainLabel}
            </div>
            <div className="mono" style={{ marginTop: 4 }}>
              The manager does not hold enough {selected.symbol} to cover this redemption.
              Enable <strong>basket mode</strong> to spread across all reserves, or select a
              different stablecoin.
            </div>
          </div>
        )}

        {/* DESTINATION header — redeem only, shown after BURN + RECEIVE */}
        {mode === 'redeem' && (
          <div className="src-header">
            <div className="src-header__main">
              <span className="src-header__label">DESTINATION</span>
              <span className="src-header__chain">{destLabel}</span>
            </div>
            {!account ? (
              <button
                type="button"
                className="src-header__action"
                onClick={handleConnectToPushWallet}
              >
                <span className="src-header__action-link">Connect wallet ↗</span>
              </button>
            ) : !originIsPush && (
              allowBasket ? (
                <span
                  data-tooltip={`Basket mode distributes across all reserves on Push Chain only.`}
                  style={{ display: 'inline-flex', cursor: 'not-allowed' }}
                >
                  <button
                    type="button"
                    className="src-header__action"
                    disabled
                    style={{ pointerEvents: 'none' }}
                  >
                    <span className="src-header__action-link">
                      {`Deliver on ${selected.chainLabel} →`}
                    </span>
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="src-header__action"
                  onClick={() => {
                    setRouteTouched(true);
                    setRoute((r) => (r === 'external' ? 'push' : 'external'));
                  }}
                  disabled={submitting}
                >
                  <span className="src-header__action-link">
                    {isExternalRoute ? 'Keep on Push Chain →' : `Deliver on ${selected.chainLabel} →`}
                  </span>
                </button>
              )
            )}
          </div>
        )}

        {/* Recipient — shown for all redeem routes, right after destination */}
        {mode === 'redeem' && account && (
          <div>
            <div className="input-head">
              <span>RECIPIENT ({isExternalRoute ? selected.chainShort : 'PUSH CHAIN'})</span>
              {recipientTouched && autoRecipient.address && (
                <button
                  type="button"
                  onClick={() => {
                    setRecipientTouched(false);
                    setExternalRecipient(autoRecipient.address);
                  }}
                  disabled={submitting}
                >
                  USE MY ADDRESS
                </button>
              )}
            </div>
            <div className="input-row">
              <input
                type="text"
                placeholder={autoRecipient.loading ? 'Deriving address…' : selected.moveableKey[0].startsWith('SOLANA') ? 'Solana address…' : '0x…'}
                value={externalRecipient}
                onChange={(e) => {
                  setRecipientTouched(true);
                  setExternalRecipient(e.target.value.trim());
                }}
                disabled={submitting || autoRecipient.loading}
                spellCheck={false}
              />
              {!recipientTouched && autoRecipient.hint?.kind === 'cea' && externalRecipient && (
                <span className="input-row__hint">
                  This is your linked account on {autoRecipient.hint.chainLabel}, controlled by
                  your connected wallet. Funds will be retrievable only through your universal
                  wallet, change the address above to send to a different recipient.
                </span>
              )}
              {!recipientTouched && autoRecipient.hint?.kind === 'own-wallet' && externalRecipient && (
                <span className="input-row__hint">
                  Your connected wallet address on {selected.chainLabel}.
                </span>
              )}
              {externalRecipient && !externalRecipientValid && (
                <span className="input-row__hint input-row__hint--warn">
                  ✕ Not a valid {selected.moveableKey[0].startsWith('SOLANA') ? 'Solana' : 'EVM'} address
                  for {isExternalRoute ? selected.chainLabel : 'Push Chain'}.
                </span>
              )}
            </div>
          </div>
        )}

        {/* Advanced basket mode toggle */}
        {advanced && mode === 'redeem' && (
          <div
            className="toggle-row"
            role="button"
            tabIndex={0}
            onClick={() => {
              const next = !allowBasket;
              setAllowBasket(next);
              if (next) { setRoute('push'); setRouteTouched(true); }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const next = !allowBasket;
                setAllowBasket(next);
                if (next) { setRoute('push'); setRouteTouched(true); }
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
            <div className="convert__grid-value">{isPlus ? nav.pusdPerPlus.toFixed(6) : '1.000000'}</div>
          </div>
          <div>
            <div className="convert__grid-label">SOURCE</div>
            <div className="convert__grid-value">
              {mode === 'mint'
                ? `${selected.symbol} · ${isExternalRoute || !account ? selected.chainLabel : 'PUSH CHAIN'}`
                : `${productLabel} · PUSH CHAIN`}
            </div>
          </div>
          <div>
            <div className="convert__grid-label">DESTINATION</div>
            <div className="convert__grid-value">
              {mode === 'mint'
                ? `${productLabel} · PUSH CHAIN`
                : `${selected.symbol} · ${isExternalRoute || !account ? selected.chainLabel : 'PUSH CHAIN'}`}
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

        {originAddress && mode === 'mint' && isExternalRoute && (
          <p className="convert__fineprint" style={{ marginTop: -8 }}>
            Wallet{' '}
            <a
              className="link-mono"
              href={explorerAddressForChain(originAddress, originChainKey)}
              target="_blank"
              rel="noreferrer"
            >
              {originAddress.slice(0, 6)}…{originAddress.slice(-4)} ↗
            </a>
            {' '}on {originChainDisplay}.
          </p>
        )}

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
        {stage.kind !== 'idle' && stage.kind !== 'error' && stage.kind !== 'preparing' && stage.kind !== 'signing' && (
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
              {stage.kind === 'broadcasting'
                ? 'BROADCASTING'
                : needsExternalRecipient
                  ? 'CONFIRMED · REDEEMED ON PUSH CHAIN'
                  : 'CONFIRMED'}
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
                      : `CONFIRMED · SENT TO ${selected.chainLabel.toUpperCase()}`}
                </div>
                {stage.kind === 'step2-broadcasting' && stage.hash === '0x' ? (
                  <span className="link-mono">PENDING…</span>
                ) : (stage.kind === 'step2-broadcasting' || stage.kind === 'step2-confirmed') && (
                  <a className="link-mono" href={explorerTxForChain(stage.hash, destChainKey)} target="_blank" rel="noreferrer">
                    {truncHash(stage.hash)} ↗
                  </a>
                )}
              </>
            )}
            {progressNote && stage.kind !== 'confirmed' && stage.kind !== 'step2-confirmed' && (
              <div className="mono" style={{ marginTop: 8, opacity: 0.7 }}>
                {progressNote}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

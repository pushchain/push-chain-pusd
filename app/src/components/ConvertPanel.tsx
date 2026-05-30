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
import { CHAIN_ID, PUSD_ADDRESS, PUSD_MANAGER_ADDRESS, PUSD_PLUS_ADDRESS } from '../contracts/config';
import { PUSD_WRAP_TOKEN, TOKENS, type ReserveToken } from '../contracts/tokens';
import { useExternalTokenBalance } from '../hooks/useExternalTokenBalance';
import { useInvariants } from '../hooks/useInvariants';
import { useNAV } from '../hooks/useNAV';
import { useProtocolStats } from '../hooks/useProtocolStats';
import { usePUSDBalance } from '../hooks/usePUSDBalance';
import { usePUSDPlusBalance } from '../hooks/usePUSDPlusBalance';
import { useRedeemRecipient } from '../hooks/useRedeemRecipient';
import { useTokenBalance } from '../hooks/useTokenBalance';
import { analytics, toAmountNumber } from '../lib/analytics';
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
import { normalizeToPUSD } from '../lib/invariants';
import { reportQuestEvent, type QuestEventType } from '../lib/questWebhook';
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
  const { baseFeeBps, preferredFeeMinBps, preferredFeeMaxBps } = useProtocolStats();

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
  const isPusdAsset = selected.address?.toLowerCase() === PUSD_ADDRESS?.toLowerCase();

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

  // Declared early so feeAmount (below) can reference it. Toggle UI is rendered later.
  const [allowBasket, setAllowBasket] = useState(false);

  // Mirror PUSDManager._calculatePreferredFee — needed when allowBasket=false so
  // the frontend's payout estimate matches the contract's actual transfer. If we
  // only subtract baseFee here, the UEA receives less than receiveAmount and the
  // cross-chain outbound leg fails with InsufficientBalance.
  const preferredFeeBps = useMemo(() => {
    if (preferredFeeMinBps === 0 && preferredFeeMaxBps === 0) return 0;
    const rows = invariants.perToken;
    if (rows.length === 0) return preferredFeeMaxBps; // optimistic max while loading
    const totalPusd = rows.reduce(
      (acc, r) => acc + normalizeToPUSD(r.balance, r.decimals),
      0n,
    );
    if (totalPusd === 0n) return preferredFeeMaxBps;
    const row = rows.find((r) => r.address.toLowerCase() === selected.address.toLowerCase());
    if (!row) return preferredFeeMaxBps;
    const tokenPusd = normalizeToPUSD(row.balance, row.decimals);
    const liquidityPct = Number((tokenPusd * 10_000n) / totalPusd);
    if (liquidityPct >= 5000) return preferredFeeMinBps;
    if (liquidityPct <= 1000) return preferredFeeMaxBps;
    const range = liquidityPct - 1000;
    const feeRange = preferredFeeMaxBps - preferredFeeMinBps;
    const feeReduction = Math.floor((range * feeRange) / 4000);
    return preferredFeeMaxBps - feeReduction;
  }, [preferredFeeMinBps, preferredFeeMaxBps, invariants.perToken, selected.address]);

  const feeAmount = useMemo(() => {
    if (mode !== 'redeem' || parsedAmount === 0n) return 0n;
    // PUSD+ redeem path is fee-exempt (manager._payoutToUser fee=0 for vault).
    if (isPlus) return 0n;
    // Single-token redeem charges baseFee + preferred premium; basket redeem
    // charges baseFee only (preferred premium is per-token).
    const totalBps = allowBasket ? baseFeeBps : baseFeeBps + preferredFeeBps;
    return (parsedAmount * BigInt(totalBps)) / 10_000n;
  }, [mode, parsedAmount, baseFeeBps, preferredFeeBps, allowBasket, isPlus]);

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
  // Fee depends on basket mode: baseFee only when basket=on; baseFee+preferred otherwise.
  // PUSD+ redeem path is fee-exempt — the inverse there is NAV, not fee (skipped).
  const handleExactReceive = () => {
    if (!amountValid || isPlus) return;
    const feeBps = allowBasket ? baseFeeBps : baseFeeBps + preferredFeeBps;
    if (feeBps === 0) return;
    analytics.event('convert_exact_out_clicked', {
      basket: allowBasket,
      fee_bps: feeBps,
    });
    const divisor = 10_000n - BigInt(feeBps);
    const invertedBurn = (parsedAmount * 10_000n + divisor - 1n) / divisor; // ceiling div
    const base = 10n ** BigInt(decimals);
    const whole = invertedBurn / base;
    const frac = invertedBurn % base;
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
    setAmount(fracStr ? `${whole}.${fracStr}` : whole.toString());
  };

  // --- redeem recipient + advanced fields --------------------------------
  // (allowBasket state declared earlier so feeAmount can read it.)

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

  // --- quest webhook -----------------------------------------------------
  const fireQuestEvent = async (txHash: `0x${string}`, failureReason?: string) => {
    if (!account) return;
    let eventType: QuestEventType;
    let fromToken: string;
    let toToken: string;

    if (mode === 'mint') {
      if (isPusdAsset && isPlus) {
        eventType = 'CONVERT';
        fromToken = 'PUSD';
        toToken = 'PUSD+';
      } else {
        eventType = 'MINT';
        fromToken = selected.symbol;
        toToken = isPlus ? 'PUSD+' : 'PUSD';
      }
    } else {
      if (isPusdAsset && isPlus) {
        eventType = 'CONVERT';
        fromToken = 'PUSD+';
        toToken = 'PUSD';
      } else {
        eventType = 'REDEEM';
        fromToken = isPlus ? 'PUSD+' : 'PUSD';
        toToken = selected.symbol;
      }
    }
    console.log('made backend call');

    await reportQuestEvent({
      eventId: txHash,
      eventType,
      status: failureReason ? 'FAILED' : 'COMPLETED',
      userAddress: originAddress ?? account,
      fromToken,
      fromAmount: parsedAmount.toString(),
      toToken,
      toAmount: receiveAmount.toString(),
      txHash,
      chainId: CHAIN_ID.toString(),
      eventTimestamp: new Date().toISOString(),
      ...(failureReason ? { failureReason } : {}),
    });
  };

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

    // Tracks the on-chain hash once broadcast so the catch block can report
    // FAILED events without relying on React state (which is stale inside the
    // async closure).
    let submittedHash: `0x${string}` | null = null;

    const analyticsCommon = {
      mode,
      product,
      route: isExternalRoute ? 'external' : 'push',
      token: selected.symbol,
      token_chain: selected.chainShort,
      origin_chain: origin?.chain ?? 'unknown',
      amount_pusd: toAmountNumber(mode === 'mint' ? receiveAmount : parsedAmount, 6),
      amount_token: toAmountNumber(parsedAmount, decimals),
      basket: allowBasket,
      wrap: wrapMode && isPlus,
    };

    analytics.event('convert_submit', analyticsCommon);

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
        submittedHash = hash;
        analytics.event('convert_signed', analyticsCommon);
        setStage({ kind: 'broadcasting', hash });
        await tx.wait();
        analytics.event('convert_confirmed', { ...analyticsCommon, two_leg: false });
        setStage({ kind: 'confirmed', hash });
        setAmount('');
        await fireQuestEvent(hash);
        return;
      }

      // --- REDEEM -------------------------------------------------------
      // Redeem burns the caller's PUSD / PUSD+ directly: PUSDManager holds
      // BURNER_ROLE on PUSD (and MANAGER_ROLE on the vault for PUSD+), so it
      // burns msg.sender with no allowance. Redeem is therefore a single
      // contract call — no approve leg required.
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

      // Push route (deliver on Push Chain) — a single direct call to the
      // manager. prepareTransaction()/executeTransactions() are reserved for
      // the cross-chain cascade below, and native Push EOAs are rejected by
      // prepareTransaction outright ("Push native accounts cannot use
      // prepareTransaction… Use sendTransaction() instead for direct Push
      // Chain calls"). A plain sendTransaction works for both native Push
      // EOAs and external-chain wallets.
      if (!needsExternalRecipient) {
        setStage({ kind: 'signing' });
        const tx = await pushChainClient.universal.sendTransaction({
          to: redeemLeg.to,
          value: redeemLeg.value,
          data: redeemLeg.data,
        });
        const hash = tx.hash as `0x${string}`;
        submittedHash = hash;
        analytics.event('convert_signed', analyticsCommon);
        setStage({ kind: 'broadcasting', hash });
        await tx.wait();
        analytics.event('convert_confirmed', { ...analyticsCommon, two_leg: false });
        setStage({ kind: 'confirmed', hash });
        setAmount('');
        await fireQuestEvent(hash);
        return;
      }

      // External route (cross-chain payout) — burn PUSD/PUSD+ on Push Chain,
      // then bridge the reserve token out to the recipient on the destination
      // chain. Resolve the outbound token + CAIP-2 destination first; both
      // wallet paths below share them.
      const [chainKey, symbolKey] = selected.moveableKey;
      const moveable = resolveMoveableToken(PushChain.CONSTANTS, chainKey, symbolKey);
      if (!moveable) {
        throw new Error(
          `MOVEABLE token for ${symbolKey} on ${chainKey} not available — pick a different asset or keep the payout on Push Chain.`,
        );
      }
      // CAIP-2 value (`eip155:…` / `solana:…`) — the SDK route validator
      // rejects the friendly key (throws `ChainNotSupportedError`).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const destChain = (PushChain.CONSTANTS.CHAIN as any)[chainKey];

      if (originIsPush) {
        // Native Push EOA: prepareTransaction()/executeTransactions() reject the
        // Push-execution (burn) hop ("Push native accounts cannot use
        // prepareTransaction… Use sendTransaction() instead"), so the
        // single-signature cascade is off-limits. Run the burn and the outbound
        // bridge as two independent sendTransaction() calls instead.
        //
        // Note on signatures: the SDK has no multicall for a native EOA, so the
        // outbound (Route-2) call itself fans out into sequential signed sub-txs
        // (approve PRC-20 → sendUniversalTxOutbound — see sendPushTx). Expect up
        // to ~3 wallet prompts total: 1 for the burn, 2 for the outbound.

        // Tx 1 — burn on Push Chain. The reserve token lands in this account
        // (redeem recipient = target = account), so the outbound below can spend
        // it. Redeem needs no approve (PUSDManager holds BURNER_ROLE).
        setStage({ kind: 'signing' });
        const burnTx = await pushChainClient.universal.sendTransaction({
          to: redeemLeg.to,
          value: redeemLeg.value,
          data: redeemLeg.data,
        });
        const burnHash = burnTx.hash as `0x${string}`;
        submittedHash = burnHash;
        analytics.event('convert_signed', analyticsCommon);
        setStage({ kind: 'broadcasting', hash: burnHash });
        setProgressNote('Waiting for Push Chain confirmation…');
        await burnTx.wait();
        setProgressNote(`Confirmed on Push Chain · Sending to ${selected.chainLabel}…`);

        // Tx 2 — Route 2 outbound: burn the PRC-20 reserve on Push Chain and
        // release the real token to the recipient on the destination chain.
        setStage({ kind: 'step2-signing', prevHash: burnHash });
        const payoutTx = await pushChainClient.universal.sendTransaction({
          to: { address: externalRecipient as `0x${string}`, chain: destChain },
          value: 0n,
          data: '0x',
          funds: { amount: receiveAmount, token: moveable },
        } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        const payoutHash = payoutTx.hash as `0x${string}`;
        setStage({ kind: 'step2-broadcasting', prevHash: burnHash, hash: payoutHash });
        setProgressNote(`Submitted to ${selected.chainLabel} · Waiting for confirmation…`);
        await payoutTx.wait();
        // Best-effort: wait for the external-chain landing when the SDK exposes
        // it; never let a missing/throwing hook block confirmation.
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (payoutTx as any).waitForExternalExecution?.();
        } catch {
          /* external confirmation is best-effort */
        }

        analytics.event('convert_confirmed', { ...analyticsCommon, two_leg: true });
        analytics.event('convert_step2_confirmed', {
          ...analyticsCommon,
          dest_chain: destChainKey ?? 'unknown',
        });
        setStage({ kind: 'step2-confirmed', prevHash: burnHash, hash: payoutHash });
        setProgressNote(`Confirmed on ${selected.chainLabel}`);
        setAmount('');
        await fireQuestEvent(burnHash);
        return;
      }

      // External-chain wallet (MetaMask / Phantom / etc.) → relay-managed
      // account that supports the single-signature cascade. Hop 1 burns on
      // Push Chain (the UEA holds the reserve between hops); hop 2 bridges it
      // out. We still approve defensively in hop 1 in case a future manager
      // path needs the allowance.
      const legs: CascadeLeg[] = [
        buildApproveLeg(helpers, burnTokenAddress, PUSD_MANAGER_ADDRESS as `0x${string}`, parsedAmount),
        redeemLeg,
      ];

      // Hop 1: burn on Push Chain (outer `to` = zero sentinel → multicall).
      const prepared1 = await pushChainClient.universal.prepareTransaction({
        to: '0x0000000000000000000000000000000000000000',
        value: 0n,
        data: legs,
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      // Hop 2: forward the reserve to the recipient on the external chain.
      const prepared2 = await pushChainClient.universal.prepareTransaction({
        to: { address: externalRecipient as `0x${string}`, chain: destChain },
        value: 0n,
        data: '0x',
        funds: { amount: receiveAmount, token: moveable },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      setStage({ kind: 'signing' });
      const cascade = await pushChainClient.universal.executeTransactions([prepared1, prepared2]);
      const initialHash = cascade.initialTxHash as `0x${string}`;
      submittedHash = initialHash;
      analytics.event('convert_signed', analyticsCommon);
      setStage({ kind: 'broadcasting', hash: initialHash });
      setProgressNote('Waiting for Push Chain confirmation…');

      // Track per-hop progress so the two-stage UI (broadcasting → paying-out
      // → confirmed) still works with a single signature.
      await cascade.wait({
        progressHook: (ev) => {
          if (ev.hopIndex === 0) {
            setProgressNote(
              ev.status === 'confirmed'
                ? `Confirmed on Push Chain · Sending to ${selected.chainLabel}…`
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

      const hop1 = cascade.hops[1];
      const outHash = (hop1?.outboundDetails?.externalTxHash ?? hop1?.txHash ?? initialHash) as `0x${string}`;
      analytics.event('convert_confirmed', { ...analyticsCommon, two_leg: true });
      analytics.event('convert_step2_confirmed', {
        ...analyticsCommon,
        dest_chain: destChainKey ?? 'unknown',
      });
      setStage({ kind: 'step2-confirmed', prevHash: initialHash, hash: outHash });
      setAmount('');
      await fireQuestEvent(initialHash);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      analytics.event('convert_failed', {
        ...analyticsCommon,
        reason: message.slice(0, 96),
        broadcasted: !!submittedHash,
      });
      setStage({ kind: 'error', message });
      // Only report FAILED when the tx reached the chain (we have a hash).
      // Pre-broadcast failures (user rejection, gas estimation, etc.) have no
      // txHash so there's nothing to report.
      if (submittedHash) {
        await fireQuestEvent(submittedHash, message);
      }
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
    analytics.event('wallet_switch_clicked', {
      surface: 'convert_source_header',
      had_account: !!account,
    });
    setRouteTouched(false);
    if (account) {
      pendingConnectRef.current = true;
      handleUserLogOutEvent();
    } else {
      handleConnectToPushWallet();
    }
  };

  // --- derived labels ----------------------------------------------------
  // Per-row address shown in the token dropdown. When the user already holds
  // reserves on Push Chain (push route), the PRC-20 wrapper address is the
  // relevant one. When they're paying from a source chain (external route),
  // show that chain's ERC-20 contract address instead so the explorer link
  // jumps to Etherscan / Basescan / Arbiscan / BscScan / Solscan rather than
  // the Donut explorer.
  const rowAddressInfo = (t: ReserveToken): { addr: string; chainKey: string } => {
    if (!isExternalRoute) return { addr: t.address, chainKey: 'PUSH_TESTNET_DONUT' };
    const [chainKey, symbolKey] = t.moveableKey;
    if (!chainKey || !PushChain) return { addr: t.address, chainKey: 'PUSH_TESTNET_DONUT' };
    const moveable = resolveMoveableToken(PushChain.CONSTANTS, chainKey, symbolKey) as
      | { address?: string }
      | undefined;
    const sourceAddr = moveable?.address ?? '';
    return sourceAddr
      ? { addr: sourceAddr, chainKey }
      : { addr: t.address, chainKey: 'PUSH_TESTNET_DONUT' };
  };

  const effectiveFeeBps = mode === 'redeem' && !isPlus && !allowBasket
    ? baseFeeBps + preferredFeeBps
    : baseFeeBps;
  const feeBpsLabel = isPlus ? `NAV ${nav.pusdPerPlus.toFixed(6)}` : `${(effectiveFeeBps / 100).toFixed(2)}%`;

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
    // For PUSD+ mint/redeem the receive amount goes through NAV — the
    // input ≠ the output. Show the *receive* amount on the button so
    // "MINT N PUSD+" matches what actually lands in the user's wallet.
    // PUSD direct (1:1) keeps parsedAmount; both end up showing the
    // user-facing number.
    const outAmt = formatAmount(receiveAmount, 6, { maxFractionDigits: 4 });
    const inAmt = formatAmount(parsedAmount, decimals, { maxFractionDigits: 4 });
    if (mode === 'mint') return `MINT ${outAmt} ${productLabel} →`;
    return needsExternalRecipient
      ? `REDEEM → SEND TO ${selected.chainShort} →`
      : `REDEEM ${inAmt} ${productLabel} →`;
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
    analytics.event('convert_tab_switch', { to: next, product, advanced });
    setMode(next);
    setAmount('');
    setStage({ kind: 'idle' });
    if (advanced) navigate(`/convert/${next}`);
  };

  return (
    <div className="convert">
        {plusEnabled && (
          <div className="convert__product" role="tablist" aria-label="Product">
            <button
              type="button"
              role="tab"
              aria-selected={isPlus}
              className={`convert__product-btn ${isPlus ? 'convert__product-btn--active' : ''}`}
              onClick={() => {
                if (!isPlus) {
                  analytics.event('convert_product_switch', { to: 'pusd-plus' });
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
                  analytics.event('convert_product_switch', { to: 'pusd' });
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
                analytics.event('convert_wrap_mode_exit', { mode });
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
              setRoute((r) => {
                const next = r === 'external' ? 'push' : 'external';
                analytics.event('convert_route_toggle', { mode: 'mint', to: next });
                return next;
              });
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
                analytics.event('convert_amount_max_clicked', {
                  mode,
                  product,
                  token: mode === 'mint' ? selected.symbol : productLabel,
                });
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
            <div className="input-shell-item">
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
                onClick={() => {
                  setShowSelector((s) => {
                    const next = !s;
                    if (next) analytics.event('convert_token_selector_open', { mode });
                    return next;
                  });
                }}
                disabled={submitting}
              >
                <TokenPill symbol={selected.symbol} chainShort={mintSourceChainShort} size="sm" />
                <span className="selector-btn__caret">▾</span>
              </button>
            ) : (
              <TokenPill symbol={productLabel} chainShort="PUSH" size="md" />
              )}
            </div>

            {mode === 'mint' && (!amount || Number(amount) === 0) && (
              <button
                type="button"
                className="src-header__action"
                onClick={() => {
                  analytics.event('convert_faucet_link_clicked_inline');
                  navigate('/mint');
                }}
                disabled={submitting}
              >
                Don&apos;t have USDC/USDT?{' '}
                <span className="src-header__action-link">Mint using faucet here ↗</span>
              </button>
            )}
          </div>


          {mode === 'mint' && showSelector && (
            <div className="selector-panel" role="listbox" style={{ marginTop: 6 }}>
              {eligibleTokens.map((t) => {
                const active = t.address === selected.address;
                const info = rowAddressInfo(t);
                return (
                  <button
                    key={t.address}
                    type="button"
                    className={active ? 'active' : undefined}
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      analytics.event('convert_token_select', {
                        mode: 'mint',
                        symbol: t.symbol,
                        chain: t.chainShort,
                      });
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
                      href={explorerAddressForChain(info.addr, info.chainKey)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        e.stopPropagation();
                        analytics.event('explorer_link_clicked', {
                          contract: 'reserve_token',
                          surface: 'convert_mint_token_row',
                          symbol: t.symbol,
                          chain: t.chainShort,
                          shown_chain: info.chainKey,
                        });
                      }}
                    >
                      {info.addr.slice(0, 6)}…{info.addr.slice(-4)} ↗
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
              {mode === 'redeem' && !isPlus && effectiveFeeBps > 0 && (
                <button
                  type="button"
                  data-tooltip={
                    amountValid
                      ? `Receive exactly ${formatAmount(parsedAmount, decimals, { maxFractionDigits: 6 })} ${selected.symbol}. Increases burn slightly to cover the ${(effectiveFeeBps / 100).toFixed(2)}% fee`
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
              {amountValid ? formatAmount(receiveAmount, 6, { maxFractionDigits: 4 }) : '0.0000'}
            </div>
            {mode === 'mint' ? (
              <TokenPill symbol={productLabel} chainShort="PUSH CHAIN" size="md" />
            ) : (
              <button
                type="button"
                className="selector-btn"
                onClick={() => {
                  setShowSelector((s) => {
                    const next = !s;
                    if (next) analytics.event('convert_token_selector_open', { mode });
                    return next;
                  });
                }}
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
                const info = rowAddressInfo(t);
                return (
                  <button
                    key={t.address}
                    type="button"
                    className={active ? 'active' : undefined}
                    role="option"
                    aria-selected={active}
                    style={{ position: 'relative' }}
                    onClick={() => {
                      analytics.event('convert_token_select', {
                        mode: 'redeem',
                        symbol: t.symbol,
                        chain: t.chainShort,
                      });
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
                      href={explorerAddressForChain(info.addr, info.chainKey)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        e.stopPropagation();
                        analytics.event('explorer_link_clicked', {
                          contract: 'reserve_token',
                          surface: 'convert_redeem_token_row',
                          symbol: t.symbol,
                          chain: t.chainShort,
                          shown_chain: info.chainKey,
                        });
                      }}
                    >
                      {info.addr.slice(0, 6)}…{info.addr.slice(-4)} ↗
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
                    analytics.event('convert_recipient_reset', { mode: 'mint' });
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
                  if (!mintRecipientTouched) {
                    analytics.event('convert_recipient_overridden', { mode: 'mint' });
                  }
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
                onClick={() => {
                  analytics.event('wallet_connect_clicked', { surface: 'convert_destination_header' });
                  handleConnectToPushWallet();
                }}
              >
                <span className="src-header__action-link">Connect wallet ↗</span>
              </button>
            ) : (
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
                    setRoute((r) => {
                      const next = r === 'external' ? 'push' : 'external';
                      analytics.event('convert_route_toggle', { mode: 'redeem', to: next });
                      return next;
                    });
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
                    analytics.event('convert_recipient_reset', { mode: 'redeem' });
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
                  if (!recipientTouched) {
                    analytics.event('convert_recipient_overridden', {
                      mode: 'redeem',
                      external_route: isExternalRoute,
                      dest_chain: selected.moveableKey[0],
                    });
                  }
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
              analytics.event('convert_basket_toggle', { on: next });
              setAllowBasket(next);
              if (next) { setRoute('push'); setRouteTouched(true); }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const next = !allowBasket;
                analytics.event('convert_basket_toggle', { on: next });
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
            <div className="convert__grid-label">FROM</div>
            <div className="convert__grid-value convert__grid-value--col">
              {mode === 'mint' ? (
                <>
                  <span>{selected.symbol}</span>
                  <span className="convert__grid-chain">{isExternalRoute || !account ? selected.chainLabel : 'PUSH CHAIN'}</span>
                </>
              ) : (
                <>
                  <span>{productLabel}</span>
                  <span className="convert__grid-chain">PUSH CHAIN</span>
                </>
              )}
            </div>
          </div>
          <div>
            <div className="convert__grid-label">TO</div>
            <div className="convert__grid-value convert__grid-value--col">
              {mode === 'mint' ? (
                <>
                  <span>{productLabel}</span>
                  <span className="convert__grid-chain">PUSH CHAIN</span>
                </>
              ) : (
                <>
                  <span>{selected.symbol}</span>
                  <span className="convert__grid-chain">{isExternalRoute || !account ? selected.chainLabel : 'PUSH CHAIN'}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          className={`btn ${solventHalt ? 'btn--danger' : 'btn--accent'} btn--block convert__cta`}
          onClick={() => {
            if (account) {
              handleConvert();
            } else {
              analytics.event('wallet_connect_clicked', { surface: 'convert_cta', mode });
              handleConnectToPushWallet();
            }
          }}
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
              onClick={() =>
                analytics.event('explorer_link_clicked', {
                  contract: 'origin_wallet',
                  surface: 'convert_fineprint',
                })
              }
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
              onClick={() =>
                analytics.event('explorer_link_clicked', {
                  contract: 'tx',
                  surface: 'convert_feedback_step1',
                })
              }
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
                  <a
                    className="link-mono"
                    href={explorerTxForChain(stage.hash, destChainKey)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() =>
                      analytics.event('explorer_link_clicked', {
                        contract: 'tx',
                        surface: 'convert_feedback_step2',
                        dest_chain: destChainKey,
                      })
                    }
                  >
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

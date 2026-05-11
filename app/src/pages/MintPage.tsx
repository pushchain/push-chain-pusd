/**
 * MintPage — testnet faucet for the supported reserve stablecoins.
 *
 * One row per (chain, symbol) pair. Each row carries its own amount input
 * (pre-filled with `10`), a destination toggle (SOURCE CHAIN by default;
 * PUSH CHAIN as alternative), the source-chain contract address, the
 * resolved recipient for that row, and a MINT button.
 *
 * Recipient resolution per row:
 *
 *   destination = PUSH       → UEA  (the user's Push Chain account)
 *   destination = SOURCE
 *     · token's chain == user's origin chain → UOA  (same wallet)
 *     · token's chain != user's origin chain → CEA  (Chain-External Address
 *                                              derived via the SDK)
 *
 * The page derives every chain's CEA up-front (async in a single effect)
 * so each row can render its own resolved recipient without a per-click
 * delay. Users can override per-row via an inline edit affordance.
 *
 * This mints the underlying stablecoin directly (USDC/USDT) — the
 * PUSD-conversion flow lives at /convert/mint.
 */

import { usePushChain, usePushChainClient } from '@pushchain/ui-kit';
import { useEffect, useMemo, useState } from 'react';
import { TokenPill } from '../components/TokenPill';
import { TOKENS, type ReserveToken } from '../contracts/tokens';
import type { HelpersLike } from '../lib/cascade';
import { explorerAddressForChain, explorerTxForChain } from '../lib/externalRpc';
import { formatAmount, truncHash } from '../lib/format';
import { isPushChainKey, isValidAddress, resolveMoveableToken, resolveOriginChainKey } from '../lib/wallet';

/** Resolve the *source-chain* contract address for a (chain, symbol) pair via
 *  the SDK's MOVEABLE registry. Returns '' when the SDK doesn't expose one. */
function getSourceAddress(constants: unknown, chainKey: string, symbolKey: string): string {
  const moveable = resolveMoveableToken(constants, chainKey, symbolKey) as
    | { address?: string }
    | undefined;
  return moveable?.address ?? '';
}

type Destination = 'source' | 'push';

/** Per-row tx state. The SDK splits a cross-chain mint into two phases:
 *  the gateway tx on Push Chain (immediate), and the destination-chain
 *  tx that the relayer submits afterward. We surface both. */
type RowStage =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'signing' }
  | {
      kind: 'pending';
      gatewayHash?: `0x${string}`;
      /** Latest progress message from the SDK (e.g. "WAITING FOR DESTINATION CHAIN TX"). */
      progress?: string;
    }
  | {
      kind: 'confirmed';
      gatewayHash: `0x${string}`;
      /** Destination-chain tx hash (e.g. on Sepolia). Only set for source-chain dests. */
      externalHash?: string;
      /** Explorer URL for the external tx, supplied by the SDK. */
      externalExplorerUrl?: string;
      /** Friendly key for the destination chain (used for fallback explorer routing). */
      externalChainKey?: string;
    }
  | { kind: 'error'; message: string };

type RecipientKind = 'uoa' | 'cea' | 'uea';
type ResolvedRecipient = {
  address: string;
  kind: RecipientKind;
  /** Short label, e.g. "YOUR ETH SEP WALLET", "CEA · SOL DEV", "PUSH UEA". */
  label: string;
};

const DEFAULT_AMOUNT = '10';

const MINT_ABI = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

// Solana CEAs come back from the SDK as 0x-prefixed 32-byte hex; the
// runtime expects them in base58 for display + signing. Same conversion
// used by useRedeemRecipient.
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function hexToBase58(hex: string): string {
  const bytes = Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let result = '';
  while (n > 0n) {
    result = BASE58_ALPHABET[Number(n % 58n)] + result;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    result = '1' + result;
  }
  return result;
}

const isSolanaChainKey = (k: string) => k.toUpperCase().startsWith('SOLANA_');

function truncAddress(addr: string): string {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function MintPage() {
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();
  const account = (pushChainClient?.universal?.account ?? null) as `0x${string}` | null;
  const origin = pushChainClient?.universal?.origin ?? null;
  const originAddress = origin?.address ?? null;
  const originChainCaip2 = origin?.chain ?? '';
  const originChainKey = useMemo(
    () => (PushChain ? resolveOriginChainKey(PushChain.CONSTANTS, origin) : origin?.chain ?? ''),
    [PushChain, origin],
  );

  // Distinct destination chain keys we need CEAs for. The user's origin
  // chain doesn't need a CEA (UOA is used directly), and Push Chain
  // destinations use UEA. So we only derive for OTHER chains the user has
  // tokens on.
  const ceaTargets = useMemo(() => {
    const set = new Set<string>();
    for (const t of TOKENS) {
      const chainKey = t.moveableKey[0];
      if (!chainKey) continue;
      if (originChainKey && chainKey === originChainKey) continue;
      set.add(chainKey);
    }
    return Array.from(set);
  }, [originChainKey]);

  const [ceaMap, setCeaMap] = useState<Record<string, string>>({});

  // Pre-derive CEAs for every non-origin chain in one pass when the user
  // first connects. Each derivation is independent so we run them in
  // parallel and merge results as they land.
  useEffect(() => {
    if (!PushChain || !originAddress || !originChainCaip2 || ceaTargets.length === 0) return;
    let cancelled = false;
    const originCaip10 = `${originChainCaip2}:${originAddress}`;
    let originAccount: ReturnType<typeof PushChain.utils.account.fromChainAgnostic>;
    try {
      originAccount = PushChain.utils.account.fromChainAgnostic(originCaip10);
    } catch {
      return;
    }
    Promise.all(
      ceaTargets.map(async (chainKey) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const destChain = (PushChain.CONSTANTS.CHAIN as any)[chainKey];
          const result = await PushChain.utils.account.deriveExecutorAccount(originAccount, {
            chain: destChain,
            skipNetworkCheck: true,
          });
          const formatted = isSolanaChainKey(chainKey) ? hexToBase58(result.address) : result.address;
          return [chainKey, formatted] as const;
        } catch {
          return [chainKey, ''] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setCeaMap((prev) => {
        const next = { ...prev };
        for (const [k, v] of entries) if (v) next[k] = v;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [PushChain, originAddress, originChainCaip2, ceaTargets]);

  function resolveRecipient(token: ReserveToken, dest: Destination): ResolvedRecipient | null {
    if (!account) return null;
    if (dest === 'push') {
      return { address: account, kind: 'uea', label: 'PUSH UEA' };
    }
    const tokenChainKey = token.moveableKey[0];
    // Same chain as the user's wallet → use the wallet itself (UOA).
    if (originChainKey && tokenChainKey === originChainKey && originAddress) {
      return { address: originAddress, kind: 'uoa', label: `YOUR ${token.chainShort} WALLET` };
    }
    // Different external chain → CEA.
    const cea = ceaMap[tokenChainKey];
    if (cea) {
      return { address: cea, kind: 'cea', label: `CEA · ${token.chainShort}` };
    }
    // Fallback while CEAs are still resolving — UEA is a valid Push-side
    // address even if the destination is an external chain. The mint
    // call would land on Donut-side; better to surface "deriving" than
    // an empty field, but we still gate the MINT button on a real CEA.
    return null;
  }

  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const t of TOKENS) seed[t.address] = DEFAULT_AMOUNT;
    return seed;
  });
  const [destinations, setDestinations] = useState<Record<string, Destination>>(() => {
    const seed: Record<string, Destination> = {};
    for (const t of TOKENS) seed[t.address] = 'source';
    return seed;
  });

  // Per-row recipient overrides. Empty string = use the resolved default.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [editingOverride, setEditingOverride] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [stages, setStages] = useState<Record<string, RowStage>>({});

  function setStage(address: string, stage: RowStage) {
    setStages((prev) => ({ ...prev, [address]: stage }));
  }

  function parseAmount(raw: string, decimals: number): bigint | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
    const [whole, frac = ''] = trimmed.split('.');
    if (frac.length > decimals) return null;
    const padded = frac.padEnd(decimals, '0');
    const combined = (whole === '' ? '0' : whole) + padded;
    try {
      const v = BigInt(combined);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }

  async function mint(token: ReserveToken) {
    if (!pushChainClient || !PushChain || !account) return;
    const dest = destinations[token.address] ?? 'source';
    const resolved = resolveRecipient(token, dest);
    const override = (overrides[token.address] ?? '').trim();
    const target = (override || resolved?.address || '') as `0x${string}`;
    if (!target) return;
    // Source-chain destinations may use Solana base58 — only check EVM
    // validity when the target looks like an EVM address.
    if (target.startsWith('0x') && !isValidAddress(target)) return;

    const raw = amounts[token.address] ?? '';
    const parsed = parseAmount(raw, token.decimals);
    if (parsed === null) return;

    setBusy(token.address);
    setStage(token.address, { kind: 'preparing' });

    try {
      const helpers = PushChain.utils.helpers as unknown as HelpersLike;
      const [chainKey, symbolKey] = token.moveableKey;
      // Source-chain destination: target the actual on-chain ERC-20
      // contract on (e.g.) Sepolia. The SDK reads this from
      // MOVEABLE.TOKEN[chain][symbol].address. Push-chain destination:
      // keep the Donut-side address.
      const sourceAddress = getSourceAddress(PushChain.CONSTANTS, chainKey, symbolKey);
      if (dest === 'source' && !sourceAddress) {
        setStage(token.address, {
          kind: 'error',
          message: 'No source-chain contract registered for this token.',
        });
        setBusy(null);
        return;
      }

      const data = helpers.encodeTxData({
        abi: MINT_ABI as unknown as readonly unknown[],
        functionName: 'mint',
        args: [target, parsed],
      });
      // Route 2 (UOA_TO_CEA) when sending to a foreign chain — the SDK
      // takes `to: { address, chain }` and routes the call to that chain
      // via the gateway. Route 1 (UOA_TO_PUSH) when destination is Push
      // itself; just pass the bare address.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chainEnum = (PushChain.CONSTANTS.CHAIN as any)[chainKey];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txOptions: any = {
        to:
          dest === 'source'
            ? { address: sourceAddress, chain: chainEnum }
            : (token.address as `0x${string}`),
        value: 0n,
        data,
      };

      setStage(token.address, { kind: 'signing' });
      const tx = await pushChainClient.universal.sendTransaction(txOptions);
      const gatewayHash = tx.hash as `0x${string}`;

      // Register the SDK's progressHook BEFORE wait() so we capture the
      // 209-/299-/399- series events for the destination-chain leg as
      // they fire. Each event has a human-readable `title` we surface in
      // the row status line.
      let lastProgress: string | undefined;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tx as any).progressHook?.((evt: { id?: string; title?: string; message?: string; level?: string }) => {
          lastProgress = evt.title || evt.message || lastProgress;
          setStage(token.address, {
            kind: 'pending',
            gatewayHash,
            progress: lastProgress,
          });
        });
      } catch {
        /* progressHook unsupported on this SDK version — fall back to plain pending */
      }

      setStage(token.address, { kind: 'pending', gatewayHash, progress: lastProgress });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receipt = (await tx.wait()) as any;

      setStage(token.address, {
        kind: 'confirmed',
        gatewayHash,
        externalHash: receipt?.externalTxHash,
        externalExplorerUrl: receipt?.externalExplorerUrl,
        externalChainKey: dest === 'source' ? chainKey : 'PUSH_TESTNET_DONUT',
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Mint failed.';
      setStage(token.address, { kind: 'error', message });
    } finally {
      setBusy(null);
    }
  }

  const grouped = useMemo(() => {
    const set = new Set<string>();
    for (const t of TOKENS) set.add(t.chainLabel);
    return set.size;
  }, []);

  const originIsPush = isPushChainKey(originChainKey);

  return (
    <div className="container">
      <section className="section">
        <div className="section__header">
          <span>§ MINT · TESTNET STABLECOIN FAUCET</span>
          <span>USDC · USDT</span>
        </div>

        <div className="book">
          <div>
            <h2 className="book__title">
              Mint <em>stablecoins.</em>
            </h2>
            <div className="book__sub">
              Get test USDC and USDT for any supported chain. Minting
              defaults to the source chain — you'll receive the token on
              the chain where it natively lives. Switch a row to
              <strong> PUSH</strong> to receive the Donut-side bridged
              version on Push Chain instead.
            </div>
          </div>
          <div className="book__totals">
            <span className="book__totals-value">{TOKENS.length}</span>
            <div className="book__totals-label">RESERVES · {grouped} CHAINS</div>
          </div>
        </div>

        {/* Account context — explains where each variant resolves from. */}
        <div className="mint-acct">
          <div className="mint-acct__row">
            <span className="meta">CONNECTED</span>
            <span className="mono">
              {originAddress
                ? `${truncAddress(originAddress)} · ${originIsPush ? 'PUSH CHAIN' : (originChainKey || 'EXTERNAL')}`
                : 'CONNECT WALLET TO MINT'}
            </span>
          </div>
          <div className="mint-acct__row">
            <span className="meta">PUSH UEA</span>
            <span className="mono">{account ? truncAddress(account) : '—'}</span>
          </div>
          <div className="meta-sm" style={{ marginTop: 6, color: 'var(--c-ink-mute)' }}>
            Each row resolves its own recipient: your wallet on its own
            chain, your CEA on a foreign chain, or your UEA when minting
            to Push.
          </div>
        </div>

        <div className="table-wrap" style={{ marginTop: 20 }}>
          <table className="table table--responsive mint-table">
            <thead>
              <tr>
                <th>ASSET</th>
                <th className="cell-md-up">CONTRACT</th>
                <th>AMOUNT</th>
                <th>RECEIVE ON</th>
                <th className="cell-md-up">RECIPIENT</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {TOKENS.map((t) => {
                const stage = stages[t.address] ?? { kind: 'idle' };
                const raw = amounts[t.address] ?? '';
                const parsed = parseAmount(raw, t.decimals);
                const amountValid = parsed !== null;
                const isBusy = busy === t.address;
                const dest = destinations[t.address] ?? 'source';
                const resolved = resolveRecipient(t, dest);
                const override = (overrides[t.address] ?? '').trim();
                const recipientAddress = override || resolved?.address || '';
                const overrideOk =
                  !override ||
                  (override.startsWith('0x') ? isValidAddress(override) : override.length > 0);
                // Resolve which contract address + explorer this row points
                // at right now. Source destinations target the on-chain
                // contract on (e.g.) Sepolia and link to that chain's
                // explorer; Push destinations target the Donut-side
                // bridged contract and link to the Push explorer.
                const [chainKey, symbolKey] = t.moveableKey;
                const sourceAddress = PushChain
                  ? getSourceAddress(PushChain.CONSTANTS, chainKey, symbolKey)
                  : '';
                const contractAddress = dest === 'source' ? sourceAddress : t.address;
                const contractChainKey = dest === 'source' ? chainKey : 'PUSH_TESTNET_DONUT';
                const sourceMissing = dest === 'source' && !sourceAddress;
                const disabled =
                  !pushChainClient ||
                  !account ||
                  !recipientAddress ||
                  !overrideOk ||
                  !amountValid ||
                  sourceMissing ||
                  busy !== null;

                const isEditing = editingOverride === t.address;

                return (
                  <tr key={t.address}>
                    <td>
                      <TokenPill symbol={t.symbol} chainShort={t.chainShort} size="sm" />
                    </td>
                    <td className="addr cell-md-up">
                      {contractAddress ? (
                        <a
                          className="link-mono"
                          href={explorerAddressForChain(contractAddress, contractChainKey)}
                          target="_blank"
                          rel="noreferrer"
                          title={contractAddress}
                        >
                          {truncAddress(contractAddress)} ↗
                        </a>
                      ) : (
                        <span className="meta-sm" style={{ color: 'var(--c-oxblood)' }}>
                          NO SOURCE ADDR
                        </span>
                      )}
                    </td>
                    <td>
                      <input
                        type="text"
                        className="mint-amount-input"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={raw}
                        onChange={(e) =>
                          setAmounts((prev) => ({ ...prev, [t.address]: e.target.value }))
                        }
                        disabled={isBusy || (busy !== null && busy !== t.address)}
                      />
                    </td>
                    <td>
                      <div className="mint-dest-toggle" role="group" aria-label="Destination chain">
                        <button
                          type="button"
                          className={`mint-dest-toggle__btn${dest === 'source' ? ' is-active' : ''}`}
                          onClick={() =>
                            setDestinations((prev) => ({ ...prev, [t.address]: 'source' }))
                          }
                          disabled={busy !== null && busy !== t.address}
                          title={`Receive ${t.symbol} on ${t.chainLabel}`}
                        >
                          {t.chainShort}
                        </button>
                        <button
                          type="button"
                          className={`mint-dest-toggle__btn${dest === 'push' ? ' is-active' : ''}`}
                          onClick={() =>
                            setDestinations((prev) => ({ ...prev, [t.address]: 'push' }))
                          }
                          disabled={busy !== null && busy !== t.address}
                          title="Receive bridged token on Push Chain"
                        >
                          PUSH
                        </button>
                      </div>
                    </td>
                    <td className="cell-md-up mint-recipient-cell">
                      {isEditing ? (
                        <input
                          type="text"
                          className="mint-recipient-edit"
                          autoFocus
                          placeholder={resolved?.address ?? '0x…'}
                          value={overrides[t.address] ?? ''}
                          onChange={(e) =>
                            setOverrides((prev) => ({ ...prev, [t.address]: e.target.value }))
                          }
                          onBlur={() => setEditingOverride(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Escape') setEditingOverride(null);
                          }}
                          spellCheck={false}
                        />
                      ) : (
                        <button
                          type="button"
                          className="mint-recipient-display"
                          onClick={() => setEditingOverride(t.address)}
                          title="Click to override"
                        >
                          <span className="mono">
                            {recipientAddress ? truncAddress(recipientAddress) : '— deriving'}
                          </span>
                          <span className={`mint-recipient-tag mint-recipient-tag--${resolved?.kind ?? 'uea'}`}>
                            {override
                              ? 'CUSTOM'
                              : (resolved?.label ?? '—')}
                          </span>
                        </button>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="mint-row-btn"
                        onClick={() => mint(t)}
                        disabled={disabled}
                      >
                        {isBusy ? stageLabel(stage) : 'MINT'}
                      </button>
                      <RowStatus
                        stage={stage}
                        parsed={parsed}
                        token={t}
                        dest={dest}
                        txChainKey={contractChainKey}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="meta-sm" style={{ marginTop: 18, maxWidth: '60ch' }}>
          Universal transaction · the call routes to the destination chain
          via Push Chain's MOVEABLE registry. Tap any RECIPIENT cell to
          override the auto-resolved address.
        </div>
      </section>
    </div>
  );
}

function stageLabel(stage: RowStage): string {
  switch (stage.kind) {
    case 'preparing':    return 'PREPARING…';
    case 'signing':      return 'SIGN IN WALLET…';
    case 'pending':      return 'BROADCASTING…';
    case 'confirmed':    return 'CONFIRMED ✓';
    case 'error':        return 'RETRY';
    default:             return 'MINT';
  }
}

function RowStatus({
  stage,
  parsed,
  token,
  dest,
  txChainKey,
}: {
  stage: RowStage;
  parsed: bigint | null;
  token: ReserveToken;
  dest: Destination;
  txChainKey: string;
}) {
  // Pending — show the gateway hash plus the latest SDK progress message.
  if (stage.kind === 'pending') {
    return (
      <div className="mint-row-status mint-row-status--pending">
        {stage.progress && (
          <div className="mint-row-status__progress">{stage.progress}</div>
        )}
        {stage.gatewayHash && (
          <div>
            <span className="mint-row-status__leg">PUSH</span>{' '}
            <a
              className="link-mono"
              href={explorerTxForChain(stage.gatewayHash, 'PUSH_TESTNET_DONUT')}
              target="_blank"
              rel="noreferrer"
            >
              {truncHash(stage.gatewayHash)} ↗
            </a>
          </div>
        )}
      </div>
    );
  }
  // Confirmed — show both legs: gateway tx (Push Chain) and, if it's a
  // source-chain mint, the destination-chain tx the relayer submitted.
  if (stage.kind === 'confirmed') {
    return (
      <div className="mint-row-status mint-row-status--ok">
        <div>
          <span className="mint-row-status__leg">PUSH</span>{' '}
          <a
            className="link-mono"
            href={explorerTxForChain(stage.gatewayHash, 'PUSH_TESTNET_DONUT')}
            target="_blank"
            rel="noreferrer"
          >
            {truncHash(stage.gatewayHash)} ↗
          </a>
        </div>
        {stage.externalHash && (
          <div>
            <span className="mint-row-status__leg">
              {(stage.externalChainKey ?? token.chainShort).toUpperCase()}
            </span>{' '}
            <a
              className="link-mono"
              href={
                stage.externalExplorerUrl ??
                explorerTxForChain(stage.externalHash, stage.externalChainKey ?? txChainKey)
              }
              target="_blank"
              rel="noreferrer"
            >
              {truncHash(stage.externalHash as `0x${string}`)} ↗
            </a>
          </div>
        )}
      </div>
    );
  }
  if (stage.kind === 'error') {
    return <div className="mint-row-status mint-row-status--err">{stage.message.slice(0, 64)}</div>;
  }
  if (parsed !== null) {
    return (
      <div className="mint-row-status">
        ≈ {formatAmount(parsed, token.decimals, { maxFractionDigits: 2 })} {token.symbol}
        {' · '}
        {dest === 'source' ? token.chainShort : 'PUSH'}
      </div>
    );
  }
  return null;
}

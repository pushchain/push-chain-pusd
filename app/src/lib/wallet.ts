/**
 * Wallet helpers — interpret the connected universal-wallet state for the UI.
 *
 * 1. originChainLabel() / chainLabelFromKey() turn a chain identifier into a
 *    short display label. They accept either the SDK's friendly key
 *    (ETHEREUM_SEPOLIA, SOLANA_DEVNET, …) or a CAIP-2 string (eip155:…).
 * 2. resolveOriginChainKey() normalizes origin.chain (which the SDK emits in
 *    CAIP-2 form on recent versions) to the friendly key our TOKENS table and
 *    `MOVEABLE.TOKEN` lookups expect.
 * 3. isValidEvmAddress() / isValidSolanaAddress() / isValidAddressForChain()
 *    validate recipient inputs per destination chain.
 * 4. resolveMoveableToken() looks up `PushChain.CONSTANTS.MOVEABLE.TOKEN[chain][symbol]`
 *    via a safely typed cast — the SDK doesn't expose the table statically, but
 *    it's reliably populated at runtime.
 */

export function isValidEvmAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Minimal Solana address check — base58, 32–44 characters. We don't verify
 * the on-curve / Ed25519 constraint here because the SDK will reject an
 * invalid pubkey at submit time; this gate just rules out copy-paste
 * mistakes and accidental EVM strings.
 */
export function isValidSolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

/**
 * Validate a recipient string against the chain it's going to. For Push
 * Chain and every supported EVM chain we want an EVM 0x… string; for Solana
 * we want a base58 pubkey. Unknown chain keys fall back to EVM.
 */
export function isValidAddressForChain(value: string, chainKey?: string | null): boolean {
  const chain = (chainKey ?? '').toUpperCase();
  if (chain.startsWith('SOLANA')) return isValidSolanaAddress(value);
  return isValidEvmAddress(value);
}

/**
 * Legacy EVM-only gate. Prefer `isValidAddressForChain` when a destination
 * chain is known. Retained for callers (Push Chain recipient inputs) where
 * the destination is always EVM.
 */
export function isValidAddress(value: string): value is `0x${string}` {
  return isValidEvmAddress(value);
}

/**
 * Friendly labels keyed by the SDK's friendly chain names (ETHEREUM_SEPOLIA,
 * SOLANA_DEVNET, …). Used by both chainLabelFromKey() and originChainLabel().
 */
const CHAIN_LABELS: Record<string, string> = {
  PUSH_TESTNET_DONUT: 'PUSH CHAIN',
  PUSH_MAINNET: 'PUSH CHAIN',
  // PUSH_TESTNET shares its CAIP-2 with PUSH_TESTNET_DONUT; resolveOriginChainKey
  // can surface either. PUSH_LOCALNET for completeness with the SDK's set.
  PUSH_TESTNET: 'PUSH CHAIN',
  PUSH_LOCALNET: 'PUSH CHAIN',
  ETHEREUM_SEPOLIA: 'ETHEREUM SEPOLIA',
  ETHEREUM_MAINNET: 'ETHEREUM',
  SOLANA_DEVNET: 'SOLANA DEVNET',
  SOLANA_MAINNET: 'SOLANA',
  BASE_SEPOLIA: 'BASE SEPOLIA',
  BASE_MAINNET: 'BASE',
  ARBITRUM_SEPOLIA: 'ARBITRUM SEPOLIA',
  ARBITRUM_MAINNET: 'ARBITRUM',
  BNB_TESTNET: 'BNB TESTNET',
  BNB_MAINNET: 'BNB',
};

/** Pretty label for a chain identifier (friendly key OR CAIP-2 string). */
export function chainLabelFromKey(chainKey?: string | null): string {
  const key = chainKey ?? '';
  if (!key) return '—';
  if (CHAIN_LABELS[key]) return CHAIN_LABELS[key];
  // CAIP-2 fallback — namespace-based best effort.
  if (key.includes(':')) {
    const [ns] = key.split(':');
    if (ns === 'solana') return 'SOLANA';
    // Unknown eip155:<id> — show the namespace + id so it's at least legible.
    return key.toUpperCase();
  }
  return key.replace(/_/g, ' ');
}

/** Short label for the connected wallet's origin chain (accepts CAIP-2 too). */
export function originChainLabel(origin?: { chain?: string } | null): string {
  return chainLabelFromKey(origin?.chain);
}

/**
 * Resolve a CAIP-2 chain string (e.g. "eip155:11155111") to the SDK's friendly
 * key (e.g. "ETHEREUM_SEPOLIA") using `PushChain.CONSTANTS.CHAIN` at runtime.
 * Returns the input unchanged when it's already a friendly key or when the
 * constants table hasn't loaded yet.
 */
export function resolveOriginChainKey(
  constants: unknown,
  origin?: { chain?: string } | null,
): string {
  const raw = origin?.chain ?? '';
  if (!raw) return '';
  const chainMap = (constants as { CHAIN?: Record<string, unknown> }).CHAIN ?? {};
  if (raw in chainMap) return raw;
  for (const [key, value] of Object.entries(chainMap)) {
    if (value === raw) return key;
  }
  return raw;
}

/** Normalize a chain key the SDK uses into a stable uppercase identifier. */
export function normalizeChainKey(chain?: string | null): string {
  return (chain ?? '').toUpperCase();
}

/**
 * Is a resolved chain key one of the Push Chain variants?
 *
 * Must match the SDK's full `PUSH_CHAINS` set, not just the two we display.
 * `PUSH_TESTNET` and `PUSH_TESTNET_DONUT` share one CAIP-2 ("eip155:42101"),
 * and the SDK lists `PUSH_TESTNET` first — so `resolveOriginChainKey()`
 * reverse-maps a native Push wallet's origin to `PUSH_TESTNET`, not
 * `PUSH_TESTNET_DONUT`. Matching only the Donut/Mainnet keys made native Push
 * wallets read as external, which routed their redeem into the cross-chain
 * cascade and threw "Push native accounts cannot use prepareTransaction".
 */
export function isPushChainKey(chainKey?: string | null): boolean {
  const key = (chainKey ?? '').toUpperCase();
  return (
    key === 'PUSH_TESTNET_DONUT' ||
    key === 'PUSH_MAINNET' ||
    key === 'PUSH_TESTNET' ||
    key === 'PUSH_LOCALNET'
  );
}

/**
 * Resolve the MOVEABLE token constant for a (chain, symbol) pair.
 * Returns `undefined` if the SDK doesn't carry an entry — in which case
 * the caller should fall back to a plain cascade without `funds`.
 */
export function resolveMoveableToken(
  constants: unknown,
  chainKey: string,
  symbolKey: string,
): unknown | undefined {
  const root = (constants as { MOVEABLE?: { TOKEN?: Record<string, Record<string, unknown>> } })
    .MOVEABLE?.TOKEN;
  return root?.[chainKey]?.[symbolKey];
}

/**
 * Filter tokens by a (pre-resolved) friendly chain key. Returns an empty
 * array when no chain key is known — callers fall back to showing every
 * token.
 */
export function filterTokensByChainKey<T extends { moveableKey: [string, string] }>(
  tokens: readonly T[],
  chainKey: string,
): T[] {
  if (!chainKey) return [];
  return tokens.filter((t) => t.moveableKey[0] === chainKey);
}

/**
 * Back-compat wrapper — filters by origin.chain assuming it's already the
 * friendly key. Prefer `filterTokensByChainKey` after normalizing with
 * `resolveOriginChainKey` when the SDK constants are available.
 */
export function filterTokensByOrigin<T extends { moveableKey: [string, string] }>(
  tokens: readonly T[],
  origin?: { chain?: string } | null,
): T[] {
  return filterTokensByChainKey(tokens, origin?.chain ?? '');
}

/**
 * Is the origin chain the Push Chain itself? When true, the user already
 * holds the Donut-side reserve tokens and we should default to the "Push
 * route" in mint/redeem rather than the external-chain moveable path.
 */
export function isPushChainOrigin(origin?: { chain?: string } | null): boolean {
  return isPushChainKey(origin?.chain);
}

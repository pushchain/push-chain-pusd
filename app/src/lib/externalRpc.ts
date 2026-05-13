/**
 * External-chain read access.
 *
 * We need to surface the connected wallet's balance of the selected token on
 * its *origin* chain (e.g. the user's USDT on Ethereum Sepolia) when the user
 * is minting via Route 2. The SDK carries the token's canonical external
 * address under `PushChain.CONSTANTS.MOVEABLE.TOKEN[chainKey][symbol].address`,
 * but it doesn't expose a user-facing read-RPC for external chains — so we
 * keep a small public-endpoint map here.
 *
 * Only EVM testnets are wired up (Ethereum Sepolia, Base Sepolia, Arbitrum
 * Sepolia, BNB Testnet). Solana Devnet would need `@solana/web3.js` and a
 * different balance call; for now we return `null` and the UI shows an
 * explorer link rather than a number.
 */

const EVM_RPCS: Record<string, string> = {
  ETHEREUM_SEPOLIA: 'https://ethereum-sepolia-rpc.publicnode.com',
  ETHEREUM_MAINNET: 'https://ethereum-rpc.publicnode.com',
  BASE_SEPOLIA: 'https://base-sepolia-rpc.publicnode.com',
  BASE_MAINNET: 'https://base-rpc.publicnode.com',
  ARBITRUM_SEPOLIA: 'https://arbitrum-sepolia-rpc.publicnode.com',
  ARBITRUM_MAINNET: 'https://arbitrum-one-rpc.publicnode.com',
  BNB_TESTNET: 'https://bsc-testnet-rpc.publicnode.com',
  BNB_MAINNET: 'https://bsc-rpc.publicnode.com',
};

/** Public read-only RPC URL for an SDK friendly chain key, or null if we
 * don't have a route (e.g. Solana chains use a different protocol). */
export function getExternalEvmRpc(chainKey: string): string | null {
  return EVM_RPCS[chainKey] ?? null;
}

/** Is this chain an EVM chain we can read from? */
export function isEvmChainKey(chainKey: string): boolean {
  return chainKey in EVM_RPCS;
}

/** Explorer address URL per friendly chain key. */
const EXPLORER_ADDRESS: Record<string, (addr: string) => string> = {
  PUSH_TESTNET_DONUT: (a) => `https://donut.push.network/address/${a}`,
  PUSH_MAINNET: (a) => `https://donut.push.network/address/${a}`,
  ETHEREUM_SEPOLIA: (a) => `https://sepolia.etherscan.io/address/${a}`,
  ETHEREUM_MAINNET: (a) => `https://etherscan.io/address/${a}`,
  BASE_SEPOLIA: (a) => `https://sepolia.basescan.org/address/${a}`,
  BASE_MAINNET: (a) => `https://basescan.org/address/${a}`,
  ARBITRUM_SEPOLIA: (a) => `https://sepolia.arbiscan.io/address/${a}`,
  ARBITRUM_MAINNET: (a) => `https://arbiscan.io/address/${a}`,
  BNB_TESTNET: (a) => `https://testnet.bscscan.com/address/${a}`,
  BNB_MAINNET: (a) => `https://bscscan.com/address/${a}`,
  SOLANA_DEVNET: (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`,
  SOLANA_MAINNET: (a) => `https://explorer.solana.com/address/${a}`,
};

/**
 * Explorer URL for an address on the given chain. Falls back to Donut explorer
 * when the chain key is unknown — safe because most addresses in our UI are
 * either on Push Chain or on a chain we've mapped.
 */
export function explorerAddressForChain(address: string, chainKey: string): string {
  const fn = EXPLORER_ADDRESS[chainKey];
  return fn ? fn(address) : `https://donut.push.network/address/${address}`;
}

/** Explorer tx URL per friendly chain key. */
const EXPLORER_TX: Record<string, (hash: string) => string> = {
  PUSH_TESTNET_DONUT: (h) => `https://donut.push.network/tx/${h}`,
  PUSH_MAINNET: (h) => `https://donut.push.network/tx/${h}`,
  ETHEREUM_SEPOLIA: (h) => `https://sepolia.etherscan.io/tx/${h}`,
  ETHEREUM_MAINNET: (h) => `https://etherscan.io/tx/${h}`,
  BASE_SEPOLIA: (h) => `https://sepolia.basescan.org/tx/${h}`,
  BASE_MAINNET: (h) => `https://basescan.org/tx/${h}`,
  ARBITRUM_SEPOLIA: (h) => `https://sepolia.arbiscan.io/tx/${h}`,
  ARBITRUM_MAINNET: (h) => `https://arbiscan.io/tx/${h}`,
  BNB_TESTNET: (h) => `https://testnet.bscscan.com/tx/${h}`,
  BNB_MAINNET: (h) => `https://bscscan.com/tx/${h}`,
  SOLANA_DEVNET: (h) => `https://explorer.solana.com/tx/${h}?cluster=devnet`,
  SOLANA_MAINNET: (h) => `https://explorer.solana.com/tx/${h}`,
};

/** Explorer URL for a tx hash on the given chain. Falls back to Donut explorer. */
export function explorerTxForChain(hash: string, chainKey: string): string {
  const fn = EXPLORER_TX[chainKey];
  return fn ? fn(hash) : `https://donut.push.network/tx/${hash}`;
}

// ---------------------------------------------------------------------------
// Solana SPL token balance
// ---------------------------------------------------------------------------

const SOLANA_RPCS: Record<string, string> = {
  SOLANA_DEVNET: 'https://api.devnet.solana.com',
  SOLANA_MAINNET: 'https://api.mainnet-beta.solana.com',
};

export function isSolanaChainKey(chainKey: string): boolean {
  return chainKey in SOLANA_RPCS;
}

export function getSolanaRpc(chainKey: string): string | null {
  return SOLANA_RPCS[chainKey] ?? null;
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function toBase58(addr: string): string {
  if (!addr.startsWith('0x')) return addr; // already base58
  const clean = addr.slice(2);
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  let leadingZeros = 0;
  for (const b of bytes) { if (b === 0) leadingZeros++; else break; }
  let num = BigInt('0x' + (clean || '0'));
  const result: string[] = [];
  while (num > 0n) { result.unshift(BASE58_ALPHABET[Number(num % 58n)]); num /= 58n; }
  return '1'.repeat(leadingZeros) + result.join('');
}

/**
 * Fetch the combined SPL token balance (sum across all ATAs) for a given
 * owner + mint on a Solana RPC. Addresses may be hex (0x…) or base58.
 */
export async function getSolanaTokenBalance(
  ownerAddress: string,
  mintAddress: string,
  rpcUrl: string,
): Promise<bigint> {
  const owner = toBase58(ownerAddress);
  const mint = toBase58(mintAddress);
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'getTokenAccountsByOwner',
      params: [owner, { mint }, { encoding: 'jsonParsed' }],
    }),
  });
  if (!res.ok) throw new Error(`Solana RPC ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();
  if (json.error) throw new Error(`Solana RPC: ${json.error.message}`);
  const accounts: unknown[] = json?.result?.value ?? [];
  let total = 0n;
  for (const acct of accounts as { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[]) {
    const amount = acct?.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (amount) total += BigInt(amount);
  }
  return total;
}

/**
 * Consolidated list of reserve tokens accepted by PUSDManager.
 *
 * Every entry carries:
 *  - `address`     — Donut-side ERC-20 bridged representation (what PUSDManager holds).
 *  - `symbol`      — USDC or USDT.
 *  - `chain`       — Canonical origin chain id as shown in contract `chainNamespace`.
 *  - `chainLabel`  — Uppercase label for UI chips.
 *  - `chainShort`  — Short uppercase label (ETH SEP, SOL DEV, ...).
 *  - `decimals`    — Token's own decimals (all 6 in v1).
 *  - `moveableKey` — Pair [chainKey, symbol] used to resolve
 *                    `PushChain.CONSTANTS.MOVEABLE.TOKEN[chainKey][symbol]`
 *                    for cross-chain `funds` routing.
 *
 * When deployment addresses change, only this file + .env.local must be touched.
 *
 * Source of truth: docs/design/v1-deployment.md §3.
 */

export type ReserveTokenStatus = 'ENABLED' | 'REDEEM_ONLY' | 'EMERGENCY_REDEEM' | 'REMOVED';

export type ReserveToken = {
  address: `0x${string}`;
  symbol: 'USDC' | 'USDT';
  chain: string;
  chainLabel: string;
  chainShort: string;
  decimals: number;
  moveableKey: [string, string];
};

export const TOKENS: readonly ReserveToken[] = [
  {
    address: '0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3',
    symbol: 'USDT',
    chain: 'Ethereum Sepolia',
    chainLabel: 'ETHEREUM SEPOLIA',
    chainShort: 'ETH SEP',
    decimals: 6,
    moveableKey: ['ETHEREUM_SEPOLIA', 'USDT'],
  },
  {
    address: '0x7A58048036206bB898008b5bBDA85697DB1e5d66',
    symbol: 'USDC',
    chain: 'Ethereum Sepolia',
    chainLabel: 'ETHEREUM SEPOLIA',
    chainShort: 'ETH SEP',
    decimals: 6,
    moveableKey: ['ETHEREUM_SEPOLIA', 'USDC'],
  },
  {
    address: '0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34',
    symbol: 'USDT',
    chain: 'Solana Devnet',
    chainLabel: 'SOLANA DEVNET',
    chainShort: 'SOL DEV',
    decimals: 6,
    moveableKey: ['SOLANA_DEVNET', 'USDT'],
  },
  {
    address: '0x04B8F634ABC7C879763F623e0f0550a4b5c4426F',
    symbol: 'USDC',
    chain: 'Solana Devnet',
    chainLabel: 'SOLANA DEVNET',
    chainShort: 'SOL DEV',
    decimals: 6,
    moveableKey: ['SOLANA_DEVNET', 'USDC'],
  },
  {
    address: '0x2C455189D2af6643B924A981a9080CcC63d5a567',
    symbol: 'USDT',
    chain: 'Base Sepolia',
    chainLabel: 'BASE SEPOLIA',
    chainShort: 'BASE SEP',
    decimals: 6,
    moveableKey: ['BASE_SEPOLIA', 'USDT'],
  },
  {
    address: '0xD7C6cA1e2c0CE260BE0c0AD39C1540de460e3Be1',
    symbol: 'USDC',
    chain: 'Base Sepolia',
    chainLabel: 'BASE SEPOLIA',
    chainShort: 'BASE SEP',
    decimals: 6,
    moveableKey: ['BASE_SEPOLIA', 'USDC'],
  },
  {
    address: '0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9',
    symbol: 'USDT',
    chain: 'Arbitrum Sepolia',
    chainLabel: 'ARBITRUM SEPOLIA',
    chainShort: 'ARB SEP',
    decimals: 6,
    moveableKey: ['ARBITRUM_SEPOLIA', 'USDT'],
  },
  {
    address: '0x1091cCBA2FF8d2A131AE4B35e34cf3308C48572C',
    symbol: 'USDC',
    chain: 'Arbitrum Sepolia',
    chainLabel: 'ARBITRUM SEPOLIA',
    chainShort: 'ARB SEP',
    decimals: 6,
    moveableKey: ['ARBITRUM_SEPOLIA', 'USDC'],
  },
  {
    address: '0x2f98B4235FD2BA0173a2B056D722879360B12E7b',
    symbol: 'USDT',
    chain: 'BNB Testnet',
    chainLabel: 'BNB TESTNET',
    chainShort: 'BNB',
    decimals: 6,
    moveableKey: ['BNB_TESTNET', 'USDT'],
  },
] as const;

/** Lookup by Donut address (case-insensitive). */
export function tokenByAddress(address: string): ReserveToken | undefined {
  const a = address.toLowerCase();
  return TOKENS.find((t) => t.address.toLowerCase() === a);
}

/** Decoded contract enum mapping — matches PUSDManager.TokenStatus. */
export const TOKEN_STATUS_ORDER: ReserveTokenStatus[] = [
  'REMOVED',
  'ENABLED',
  'REDEEM_ONLY',
  'EMERGENCY_REDEEM',
];

export function statusFromEnum(code: number | bigint): ReserveTokenStatus {
  const i = Number(code);
  return TOKEN_STATUS_ORDER[i] ?? 'REMOVED';
}

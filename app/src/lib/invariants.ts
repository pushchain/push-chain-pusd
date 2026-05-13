/**
 * I-01 solvency invariant helpers.
 *
 * I-01 (simple form, v1): Σ normalize(reserve[tᵢ]) ≥ pusd.totalSupply()
 * Since v1 has no active capital deployment, reserves are simply the token
 * balances held directly by PUSDManager.
 *
 * PUSD uses 6 decimals. All tokens in v1 use 6 decimals. We still run the
 * generic normalizer so that future tokens with different decimals work.
 */

export const PUSD_DECIMALS = 6;

/** Normalize a token-native amount to PUSD decimals (6). */
export function normalizeToPUSD(amount: bigint, tokenDecimals: number): bigint {
  if (tokenDecimals === PUSD_DECIMALS) return amount;
  if (tokenDecimals > PUSD_DECIMALS) {
    const factor = 10n ** BigInt(tokenDecimals - PUSD_DECIMALS);
    return amount / factor;
  }
  const factor = 10n ** BigInt(PUSD_DECIMALS - tokenDecimals);
  return amount * factor;
}

/** Inverse of normalizeToPUSD — round-trip safe (I-08). */
export function convertFromPUSD(pusdAmount: bigint, tokenDecimals: number): bigint {
  if (tokenDecimals === PUSD_DECIMALS) return pusdAmount;
  if (tokenDecimals > PUSD_DECIMALS) {
    const factor = 10n ** BigInt(tokenDecimals - PUSD_DECIMALS);
    return pusdAmount * factor;
  }
  const factor = 10n ** BigInt(PUSD_DECIMALS - tokenDecimals);
  return pusdAmount / factor;
}

export type InvariantState = 'ok' | 'warning' | 'violation' | 'loading';

export type InvariantPulse = {
  state: InvariantState;
  reserves: bigint; // normalized to PUSD decimals
  supply: bigint;
  delta: bigint;    // reserves - supply
  perToken: Array<{
    symbol: string;
    chain: string;
    address: `0x${string}`;
    balance: bigint;
    decimals: number;
  }>;
  updatedAt: number;
  error: Error | null;
};

/**
 * Derive invariant state from reserves vs. supply.
 *  - violation: reserves < supply (real deficit, peg breach)
 *  - ok:        reserves >= supply (fully backed; no extra surplus required)
 *
 * Earlier this function returned 'warning' when reserves matched supply but
 * surplus was below 0.01%. That triggered an alarming ▲/△ glyph on a perfectly
 * solvent protocol — at testnet balances surplus rounds to zero — so a 1:1
 * match is treated as the healthy case. 'warning' is reserved for future
 * use (e.g. accrued-fee divergence).
 */
export function deriveInvariantState(reserves: bigint, supply: bigint): InvariantState {
  if (supply === 0n) return reserves >= 0n ? 'ok' : 'violation';
  if (reserves < supply) return 'violation';
  return 'ok';
}

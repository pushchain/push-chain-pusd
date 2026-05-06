/**
 * useVaultPoolMeta — POOL_ADMIN view extras for /admin.
 *
 * Augments useVaultBook with the data the operator needs to drive openPool /
 * closePool / topUpPosition safely:
 *   - which TOKENS are currently in the basket
 *   - which fee tiers are allowed (100 / 500 / 3000 / 10000)
 *   - vault.defaultFeeTier
 *   - vault.positionIds[] for closing / topping up
 *
 * 30s poll like everything else admin reads.
 */

import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { PUSD_PLUS_ADDRESS } from '../contracts/config';
import { TOKENS } from '../contracts/tokens';
import { getReadProvider } from '../lib/provider';

const VAULT_ABI = [
  'function inBasket(address) view returns (bool)',
  'function feeTierAllowed(uint24) view returns (bool)',
  'function defaultFeeTier() view returns (uint24)',
  'function positionsLength() view returns (uint256)',
  'function positionIds(uint256) view returns (uint256)',
  'function positionManager() view returns (address)',
  'function getPositionValuePusd(uint256 tokenId) view returns (uint256)',
];

// Uniswap V3 NPM — only the slice we read.
const NPM_ABI = [
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
];

const POLL_MS = 30_000;
const STANDARD_FEE_TIERS = [100, 500, 3000, 10000] as const;

export type VaultPosition = {
  tokenId: bigint;
  token0: `0x${string}`;
  token1: `0x${string}`;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
  /** vault.getPositionValuePusd(tokenId) at the time of read — 6dp. */
  valuePusd: bigint;
  /** Resolved metadata for token0/token1 if they're in our TOKENS table. */
  symbol0: string | null;
  symbol1: string | null;
  decimals0: number;
  decimals1: number;
  chainShort0: string | null;
  chainShort1: string | null;
};

export type VaultPoolMeta = {
  loading: boolean;
  error: Error | null;
  unconfigured: boolean;
  /** Each known reserve token + whether it's in the vault basket. */
  basketMembership: Array<{
    address: `0x${string}`;
    symbol: string;
    chainShort: string;
    decimals: number;
    inBasket: boolean;
  }>;
  /** Which standard V3 fee tiers the vault has whitelisted. */
  allowedFeeTiers: number[];
  defaultFeeTier: number | null;
  /** NPM tokenIds of positions currently registered on the vault. */
  positionIds: bigint[];
  /** Per-position detail (decoded NPM.positions() + valuePusd). */
  positions: VaultPosition[];
  /** The Uniswap V3 NonfungiblePositionManager that the vault talks to.
   *  Needed to expose `createAndInitializePoolIfNecessary` from the admin UI. */
  positionManager: `0x${string}` | null;
  updatedAt: number;
};

const EMPTY: VaultPoolMeta = {
  loading: true,
  error: null,
  unconfigured: false,
  basketMembership: [],
  allowedFeeTiers: [],
  defaultFeeTier: null,
  positionIds: [],
  positions: [],
  positionManager: null,
  updatedAt: 0,
};

export function useVaultPoolMeta(): VaultPoolMeta {
  const unconfigured = !PUSD_PLUS_ADDRESS;
  const [state, setState] = useState<VaultPoolMeta>({
    ...EMPTY,
    loading: !unconfigured,
    unconfigured,
  });

  useEffect(() => {
    if (unconfigured) return;
    let cancelled = false;

    const read = async () => {
      try {
        const provider = getReadProvider();
        const vault = new ethers.Contract(PUSD_PLUS_ADDRESS!, VAULT_ABI, provider);

        const [basketReads, tierReads, defaultTier, positionsLength, npmAddr] =
          await Promise.all([
            Promise.all(
              TOKENS.map(async (t) => ({
                token: t,
                inBasket: (await vault.inBasket(t.address)) as boolean,
              })),
            ),
            Promise.all(
              STANDARD_FEE_TIERS.map(async (fee) => ({
                fee,
                allowed: (await vault.feeTierAllowed(fee)) as boolean,
              })),
            ),
            vault.defaultFeeTier() as Promise<bigint>,
            vault.positionsLength() as Promise<bigint>,
            vault.positionManager() as Promise<string>,
          ]);

        const positionIds: bigint[] = [];
        const n = Number(positionsLength);
        if (n > 0) {
          const idReads = await Promise.all(
            Array.from({ length: n }).map(
              (_, i) => vault.positionIds(i) as Promise<bigint>,
            ),
          );
          positionIds.push(...idReads.map((id) => BigInt(id)));
        }

        // Decode each position via the NPM. Settled per-tokenId so a single
        // bad-tokenId failure doesn't blank the whole list.
        let positions: VaultPosition[] = [];
        if (positionIds.length > 0 && npmAddr) {
          const npm = new ethers.Contract(npmAddr as string, NPM_ABI, provider);
          const settled = await Promise.allSettled(
            positionIds.map(async (tokenId) => {
              const [p, valuePusd] = await Promise.all([
                npm.positions(tokenId),
                vault.getPositionValuePusd(tokenId).catch(() => 0n),
              ]);
              const find = (a: string) =>
                TOKENS.find((t) => t.address.toLowerCase() === a.toLowerCase());
              const t0 = find(p.token0 as string);
              const t1 = find(p.token1 as string);
              return {
                tokenId,
                token0: p.token0 as `0x${string}`,
                token1: p.token1 as `0x${string}`,
                fee: Number(p.fee),
                tickLower: Number(p.tickLower),
                tickUpper: Number(p.tickUpper),
                liquidity: BigInt(p.liquidity),
                tokensOwed0: BigInt(p.tokensOwed0),
                tokensOwed1: BigInt(p.tokensOwed1),
                valuePusd: BigInt(valuePusd),
                symbol0: t0?.symbol ?? null,
                symbol1: t1?.symbol ?? null,
                decimals0: t0?.decimals ?? 18,
                decimals1: t1?.decimals ?? 18,
                chainShort0: t0?.chainShort ?? null,
                chainShort1: t1?.chainShort ?? null,
              } satisfies VaultPosition;
            }),
          );
          positions = settled
            .filter((s): s is PromiseFulfilledResult<VaultPosition> => s.status === 'fulfilled')
            .map((s) => s.value);
        }

        if (cancelled) return;

        setState({
          loading: false,
          error: null,
          unconfigured: false,
          basketMembership: basketReads.map((r) => ({
            address: r.token.address,
            symbol: r.token.symbol,
            chainShort: r.token.chainShort,
            decimals: r.token.decimals,
            inBasket: r.inBasket,
          })),
          allowedFeeTiers: tierReads.filter((t) => t.allowed).map((t) => t.fee),
          defaultFeeTier: Number(defaultTier),
          positionIds,
          positions,
          positionManager: npmAddr as `0x${string}`,
          updatedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error:
            err instanceof Error
              ? err
              : new Error('Failed to read vault pool meta'),
        }));
      }
    };

    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [unconfigured]);

  return state;
}

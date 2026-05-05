/**
 * useVaultBook — PUSDPlusVault balance sheet snapshot.
 *
 * Mirrors the philosophy of `useReserves` for the manager:
 *  - totalAssets / totalSupply / nav
 *  - idle PUSD held in vault
 *  - idle reserve tokens held in vault (per basket member)
 *  - deployed = totalAssets − idle (treats stables as $1)
 *  - InsuranceFund balances per basket token + cumulative
 *
 * Polled at 30s; reads only `view` functions plus `IERC20.balanceOf` so it's
 * cheap. No events needed — the vault exposes everything we need.
 */

import { ethers } from 'ethers';
import { useEffect, useMemo, useState } from 'react';
import {
  INSURANCE_FUND_ADDRESS,
  PUSD_ADDRESS,
  PUSD_PLUS_ADDRESS,
} from '../contracts/config';
import { TOKENS, type ReserveToken } from '../contracts/tokens';
import { getReadProvider } from './../lib/provider';

const VAULT_ABI = [
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function nav() view returns (uint256)',
  'function totalQueuedPusd() view returns (uint256)',
  'function idleReservesPusd() view returns (uint256)',
  'function inBasket(address) view returns (bool)',
];

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

const POLL_MS = 30_000;

export type VaultIdleSlice = {
  symbol: string;
  chainShort: string;
  address: `0x${string}`;
  decimals: number;
  /** raw token-decimal balance held by the vault */
  amount: bigint;
  /** normalized to 6dp PUSD-equivalent (treats stables at $1) */
  amountPusd: bigint;
};

export type VaultBookState = {
  loading: boolean;
  error: Error | null;
  unconfigured: boolean;

  totalAssets: bigint;        // 6dp
  plusTotalSupply: bigint;    // 6dp
  navE18: bigint;             // 1e18 fixed
  pusdPerPlus: number;        // ~1.0
  totalQueuedPusd: bigint;    // 6dp
  idleReservesPusd: bigint;   // 6dp — idle PUSD + Σ basket reserves
  deployedPusd: bigint;       // totalAssets − idle (clamped to ≥ 0)

  pusdIdle: bigint;           // 6dp — PUSD held by vault
  basketIdle: VaultIdleSlice[]; // per-basket-token idle on vault

  insuranceFund: {
    address: `0x${string}` | null;
    perToken: VaultIdleSlice[];
    totalPusd: bigint;        // 6dp — sum normalized
  };

  updatedAt: number;
};

const EMPTY: Omit<VaultBookState, 'loading' | 'error' | 'unconfigured' | 'updatedAt'> = {
  totalAssets: 0n,
  plusTotalSupply: 0n,
  navE18: 10n ** 18n,
  pusdPerPlus: 1,
  totalQueuedPusd: 0n,
  idleReservesPusd: 0n,
  deployedPusd: 0n,
  pusdIdle: 0n,
  basketIdle: [],
  insuranceFund: { address: null, perToken: [], totalPusd: 0n },
};

function normalizeToPusd(amount: bigint, decimals: number): bigint {
  if (decimals === 6) return amount;
  if (decimals < 6) return amount * 10n ** BigInt(6 - decimals);
  return amount / 10n ** BigInt(decimals - 6);
}

export function useVaultBook(): VaultBookState {
  const unconfigured = !PUSD_PLUS_ADDRESS;
  const [state, setState] = useState<VaultBookState>({
    ...EMPTY,
    loading: !unconfigured,
    error: null,
    unconfigured,
    updatedAt: 0,
  });

  // Stable token list as a string for the dep array (TOKENS is a static
  // import but typed `readonly`; reduce noise on re-renders).
  const tokenKey = useMemo(() => TOKENS.map((t) => t.address).join(','), []);

  useEffect(() => {
    if (unconfigured) return;
    let cancelled = false;

    const read = async () => {
      try {
        const provider = getReadProvider();
        const vault = new ethers.Contract(PUSD_PLUS_ADDRESS!, VAULT_ABI, provider);
        const pusdToken = new ethers.Contract(PUSD_ADDRESS, ERC20_ABI, provider);

        // --- Top-line ---
        const [totalAssets, plusSupply, navE18, totalQueued, idleAll] = await Promise.all([
          vault.totalAssets() as Promise<bigint>,
          vault.totalSupply() as Promise<bigint>,
          vault.nav() as Promise<bigint>,
          vault.totalQueuedPusd() as Promise<bigint>,
          vault.idleReservesPusd() as Promise<bigint>,
        ]);

        // --- PUSD idle ---
        const pusdIdle = (await pusdToken.balanceOf(PUSD_PLUS_ADDRESS)) as bigint;

        // --- Per-token vault holdings ---
        const tokenReads = await Promise.all(
          TOKENS.map(async (t: ReserveToken) => {
            const c = new ethers.Contract(t.address, ERC20_ABI, provider);
            const bal = (await c.balanceOf(PUSD_PLUS_ADDRESS!)) as bigint;
            return { token: t, amount: BigInt(bal) };
          }),
        );
        const basketIdle: VaultIdleSlice[] = tokenReads
          .filter((r) => r.amount > 0n)
          .map((r) => ({
            symbol: r.token.symbol,
            chainShort: r.token.chainShort,
            address: r.token.address,
            decimals: r.token.decimals,
            amount: r.amount,
            amountPusd: normalizeToPusd(r.amount, r.token.decimals),
          }));

        // --- Insurance Fund ---
        let ifAddress: `0x${string}` | null = null;
        let perTokenIF: VaultIdleSlice[] = [];
        let ifTotalPusd = 0n;
        if (INSURANCE_FUND_ADDRESS) {
          ifAddress = INSURANCE_FUND_ADDRESS;
          const ifReads = await Promise.all(
            TOKENS.map(async (t) => {
              const c = new ethers.Contract(t.address, ERC20_ABI, provider);
              const bal = (await c.balanceOf(INSURANCE_FUND_ADDRESS!)) as bigint;
              return { token: t, amount: BigInt(bal) };
            }),
          );
          perTokenIF = ifReads
            .filter((r) => r.amount > 0n)
            .map((r) => ({
              symbol: r.token.symbol,
              chainShort: r.token.chainShort,
              address: r.token.address,
              decimals: r.token.decimals,
              amount: r.amount,
              amountPusd: normalizeToPusd(r.amount, r.token.decimals),
            }));
          ifTotalPusd = perTokenIF.reduce((a, s) => a + s.amountPusd, 0n);
        }

        if (cancelled) return;

        const deployed =
          BigInt(totalAssets) > BigInt(idleAll) ? BigInt(totalAssets) - BigInt(idleAll) : 0n;

        setState({
          loading: false,
          error: null,
          unconfigured: false,
          totalAssets: BigInt(totalAssets),
          plusTotalSupply: BigInt(plusSupply),
          navE18: BigInt(navE18),
          pusdPerPlus: Number(BigInt(navE18) / 10n ** 12n) / 1e6,
          totalQueuedPusd: BigInt(totalQueued),
          idleReservesPusd: BigInt(idleAll),
          deployedPusd: deployed,
          pusdIdle,
          basketIdle,
          insuranceFund: { address: ifAddress, perToken: perTokenIF, totalPusd: ifTotalPusd },
          updatedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Failed to read vault'),
        }));
      }
    };

    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [unconfigured, tokenKey]);

  return state;
}

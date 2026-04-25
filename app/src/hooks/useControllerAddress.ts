/**
 * useControllerAddress — resolve the human-readable controller for any Push
 * Chain address by querying the UEAFactory precompile.
 *
 * For UEAs:  returns the origin chain's wallet address + chain metadata.
 *   - EVM:    20-byte hex → checksummed 0x address.
 *   - Solana: 32-byte hex → base58 pubkey.
 * For native Push Chain EOAs (isUEA = false): passes the address through as-is.
 *
 * Results are cached at module level — the same UEA won't trigger a second
 * RPC call for the lifetime of the page session.
 */

import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { getReadProvider } from '../lib/provider';
import { chainLabelFromKey } from '../lib/wallet';

// UEAFactory precompile — always at this address on Push Chain.
const UEA_FACTORY = '0x00000000000000000000000000000000000000eA';
const ABI = [
  'function getOriginForUEA(address) view returns (tuple(string chainNamespace, string chainId, bytes owner) account, bool isUEA)',
];

// CAIP chainId → SDK friendly chain key maps
const SOLANA_CHAIN_IDS: Record<string, string> = {
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: 'SOLANA_DEVNET',
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'SOLANA_MAINNET',
};
const EVM_CHAIN_IDS: Record<string, string> = {
  '11155111': 'ETHEREUM_SEPOLIA',
  '1': 'ETHEREUM_MAINNET',
  '84532': 'BASE_SEPOLIA',
  '8453': 'BASE_MAINNET',
  '421614': 'ARBITRUM_SEPOLIA',
  '42161': 'ARBITRUM_MAINNET',
  '97': 'BNB_TESTNET',
  '56': 'BNB_MAINNET',
  '42101': 'PUSH_TESTNET_DONUT',
};

const BASE58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function hexToBase58(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!clean) return '';
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b === 0) leadingZeros++;
    else break;
  }
  let num = BigInt('0x' + (clean || '0'));
  const result: string[] = [];
  while (num > 0n) {
    result.unshift(BASE58_CHARS[Number(num % 58n)]);
    num /= 58n;
  }
  return '1'.repeat(leadingZeros) + result.join('');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ControllerInfo = {
  /** Display address: checksummed 0x for EVM, base58 for Solana. */
  address: string;
  /** SDK-friendly chain key, e.g. 'ETHEREUM_SEPOLIA'. */
  chainKey: string;
  /** Short human label from chainLabelFromKey(), e.g. 'ETH SEPOLIA'. */
  chainLabel: string;
  /** True when the queried address is a UEA (controlled by an external wallet). */
  isUEA: boolean;
};

// Module-level cache: avoids re-querying the same UEA in the same page session.
const cache = new Map<string, ControllerInfo>();

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useControllerAddress(ueaAddress: string | null | undefined): {
  controller: ControllerInfo | null;
  loading: boolean;
} {
  const key = ueaAddress?.toLowerCase() ?? '';

  const [state, setState] = useState<{ controller: ControllerInfo | null; loading: boolean }>(
    () => {
      if (!key) return { controller: null, loading: false };
      const cached = cache.get(key);
      return cached ? { controller: cached, loading: false } : { controller: null, loading: true };
    },
  );

  useEffect(() => {
    if (!ueaAddress) {
      setState({ controller: null, loading: false });
      return;
    }
    const cacheKey = ueaAddress.toLowerCase();
    if (cache.has(cacheKey)) {
      setState({ controller: cache.get(cacheKey)!, loading: false });
      return;
    }

    let cancelled = false;
    setState({ controller: null, loading: true });

    const resolve = async () => {
      try {
        const provider = getReadProvider();
        const factory = new ethers.Contract(UEA_FACTORY, ABI, provider);
        const [account, isUEA]: [
          { chainNamespace: string; chainId: string; owner: string },
          boolean,
        ] = await factory.getOriginForUEA(ueaAddress);

        let address: string;
        let chainKey: string;

        if (account.chainNamespace === 'solana') {
          address = hexToBase58(account.owner);
          chainKey = SOLANA_CHAIN_IDS[account.chainId] ?? 'SOLANA_DEVNET';
        } else {
          // EVM: owner = abi.encodePacked(address) = 20 bytes = 0x + 40 hex chars
          address = ethers.getAddress(account.owner);
          chainKey = EVM_CHAIN_IDS[account.chainId] ?? '';
        }

        const chainLabel = chainLabelFromKey(chainKey);
        const info: ControllerInfo = { address, chainKey, chainLabel, isUEA };
        cache.set(cacheKey, info);
        if (!cancelled) setState({ controller: info, loading: false });
      } catch {
        if (!cancelled) setState({ controller: null, loading: false });
      }
    };

    resolve();
    return () => {
      cancelled = true;
    };
  }, [ueaAddress, key]);

  return state;
}

/**
 * useExternalTokenBalance — ERC-20 balance on an external EVM chain.
 *
 * The Mint card's "source" balance lives on whatever chain the user's wallet
 * is on (Ethereum Sepolia, Base Sepolia, …), NOT on Push Chain. Reading it
 * requires a read-only RPC against that external chain plus the token's
 * canonical address there.
 *
 * We rely on `PushChain.CONSTANTS.MOVEABLE.TOKEN[chainKey][symbol]` for the
 * token address + decimals, and our own `EVM_RPCS` map for the RPC URL.
 * Solana chains aren't wired up yet — the hook returns `available: false`.
 *
 * Polls every 12 seconds while mounted, same cadence as useTokenBalance.
 */

import { usePushChain, usePushChainClient } from '@pushchain/ui-kit';
import { ethers } from 'ethers';
import { useEffect, useRef, useState } from 'react';
import {
    getExternalEvmRpc,
    getSolanaRpc,
    getSolanaTokenBalance,
    isEvmChainKey,
    isSolanaChainKey,
} from '../lib/externalRpc';
import { resolveMoveableToken } from '../lib/wallet';

const ABI = ['function balanceOf(address) view returns (uint256)'];
const POLL_MS = 12_000;

export type ExternalBalanceState = {
  /** Can we read this chain? false for Solana etc. */
  available: boolean;
  balance: bigint;
  decimals: number;
  loading: boolean;
  error: Error | null;
  /** Canonical token address on the external chain (for explorer link). */
  tokenAddress: string | null;
};

/** ethers.JsonRpcProvider singletons keyed by RPC URL. */
const providerCache = new Map<string, ethers.JsonRpcProvider>();
function getProvider(rpcUrl: string): ethers.JsonRpcProvider {
  const existing = providerCache.get(rpcUrl);
  if (existing) return existing;
  const p = new ethers.JsonRpcProvider(rpcUrl);
  providerCache.set(rpcUrl, p);
  return p;
}

export function useExternalTokenBalance(
  chainKey: string,
  symbolKey: string,
): ExternalBalanceState {
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();
  const originAddress = pushChainClient?.universal?.origin?.address ?? null;

  const evm = isEvmChainKey(chainKey);
  const solana = isSolanaChainKey(chainKey);
  const rpcUrl = getExternalEvmRpc(chainKey);
  const solanaRpc = getSolanaRpc(chainKey);

  // Pull token metadata from SDK constants.
  const moveable = PushChain
    ? (resolveMoveableToken(PushChain.CONSTANTS, chainKey, symbolKey) as
        | { address?: string; decimals?: number }
        | undefined)
    : undefined;
  const tokenAddress = moveable?.address ?? null;
  const decimals = moveable?.decimals ?? 6;

  const readable = (evm && !!rpcUrl) || (solana && !!solanaRpc);

  const [state, setState] = useState<ExternalBalanceState>({
    available: readable && !!tokenAddress,
    balance: 0n,
    decimals,
    loading: readable && !!tokenAddress && !!originAddress,
    error: null,
    tokenAddress,
  });

  // Stable key so the effect only reruns on meaningful changes.
  const key = `${chainKey}|${symbolKey}|${originAddress ?? ''}|${tokenAddress ?? ''}|${rpcUrl ?? ''}|${solanaRpc ?? ''}`;
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (!readable || !tokenAddress || !originAddress) {
      setState({
        available: readable && !!tokenAddress,
        balance: 0n,
        decimals,
        loading: false,
        error: null,
        tokenAddress,
      });
      return;
    }

    let cancelled = false;

    const read = async () => {
      try {
        let raw: bigint;
        if (solana && solanaRpc) {
          raw = await getSolanaTokenBalance(originAddress, tokenAddress, solanaRpc);
        } else {
          const provider = getProvider(rpcUrl!);
          const token = new ethers.Contract(tokenAddress, ABI, provider);
          raw = (await token.balanceOf(originAddress)) as bigint;
        }
        if (cancelled) return;
        setState({
          available: true,
          balance: BigInt(raw),
          decimals,
          loading: false,
          error: null,
          tokenAddress,
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Balance read failed'),
        }));
      }
    };

    setState((prev) => ({ ...prev, loading: true, error: null }));
    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

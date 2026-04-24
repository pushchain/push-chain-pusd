/**
 * useRedeemRecipient — derive the default recipient address for a redeem payout.
 *
 * Three branches:
 *
 * 1. Push Chain route (deliver Donut-side ERC-20 to the UEA on Push Chain)
 *    → account (the user's Push Chain UEA address, already known from the SDK)
 *    → hint: { kind: 'push-chain' }
 *
 * 2. External route, destination == origin chain (deliver on the chain the wallet
 *    is already on, i.e. the user's own external wallet)
 *    → originAddress (the user's actual origin-chain wallet address)
 *    → hint: { kind: 'own-wallet' }
 *
 * 3. External route, destination != origin chain (deliver to a foreign external chain)
 *    → CEA derived via PushChain.utils.account.deriveExecutorAccount()
 *      The CEA is the deterministic Chain Executor Account for this user on
 *      the destination chain, derived purely in the SDK (no extra RPC needed).
 *    → hint: { kind: 'cea', chainLabel }
 *
 * The hook returns:
 *   address  — pre-computed address to populate the recipient input (or '' if loading)
 *   hint     — contextual annotation (null when no annotation is needed)
 *   loading  — true while the SDK async derivation for branch 3 is in flight
 */

import { usePushChain } from '@pushchain/ui-kit';
import { useEffect, useState } from 'react';

const SOLANA_CHAIN_PREFIXES = ['SOLANA_'];
const isSolanaChainKey = (key: string) =>
  SOLANA_CHAIN_PREFIXES.some((p) => key.toUpperCase().startsWith(p));

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

export type RedeemRecipientHint =
  | { kind: 'own-wallet' }
  | { kind: 'push-chain' }
  | { kind: 'cea'; chainLabel: string }
  | null;

export type RedeemRecipientState = {
  address: string;
  hint: RedeemRecipientHint;
  loading: boolean;
};

/**
 * @param isExternalRoute    true when delivering to an external chain (not Push Chain)
 * @param destChainKey       the SDK friendly key for the destination chain (e.g. "ETHEREUM_SEPOLIA")
 * @param originChainKey     the SDK friendly key for the wallet's origin chain (for branch-2 same-chain check)
 * @param originChainCaip2   the raw CAIP-2 string from origin.chain (e.g. "eip155:11155111") — used to build the UniversalAccount for CEA derivation
 * @param account            the UEA / Push Chain account address (0x…)
 * @param originAddress      the external-chain wallet address (0x… or Solana pubkey)
 * @param chainLabel         human-readable label for the destination chain
 */
export function useRedeemRecipient(
  isExternalRoute: boolean,
  destChainKey: string,
  originChainKey: string,
  originChainCaip2: string,
  account: string | null,
  originAddress: string | null,
  chainLabel: string,
): RedeemRecipientState {
  const { PushChain } = usePushChain();

  const [state, setState] = useState<RedeemRecipientState>({
    address: '',
    hint: null,
    loading: false,
  });

  useEffect(() => {
    if (!account || !PushChain) {
      setState({ address: '', hint: null, loading: false });
      return;
    }

    // Branch 1 — Push Chain route: pre-fill with the UEA (account)
    if (!isExternalRoute) {
      setState({ address: account, hint: { kind: 'push-chain' }, loading: false });
      return;
    }

    // Branch 2 — same chain as origin: pre-fill with the user's own wallet address
    if (destChainKey && originChainKey && destChainKey === originChainKey && originAddress) {
      setState({ address: originAddress, hint: { kind: 'own-wallet' }, loading: false });
      return;
    }

    // Branch 3 — different external chain: derive CEA via SDK (no extra RPC needed)
    if (!originAddress || !originChainCaip2 || !destChainKey) {
      setState({ address: '', hint: null, loading: false });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    const derive = async () => {
      try {
        // Build a proper UniversalAccount from the raw CAIP-2 origin chain + address.
        // origin.chain is "eip155:11155111"; append address → full CAIP-10 for fromChainAgnostic.
        const originCaip10 = `${originChainCaip2}:${originAddress}`;
        const originAccount = PushChain.utils.account.fromChainAgnostic(originCaip10);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const destChain = (PushChain.CONSTANTS.CHAIN as any)[destChainKey];
        const result = await PushChain.utils.account.deriveExecutorAccount(
          originAccount,
          { chain: destChain, skipNetworkCheck: true },
        );
        if (!cancelled) {
          // Solana CEAs come back as 0x-prefixed 32-byte hex; convert to base58.
          const ceaAddress = isSolanaChainKey(destChainKey)
            ? hexToBase58(result.address)
            : result.address;
          setState({
            address: ceaAddress,
            hint: { kind: 'cea', chainLabel },
            loading: false,
          });
        }
      } catch {
        if (!cancelled) {
          setState({ address: '', hint: { kind: 'cea', chainLabel }, loading: false });
        }
      }
    };

    derive();
    return () => { cancelled = true; };
  }, [PushChain, isExternalRoute, destChainKey, originChainKey, originChainCaip2, account, originAddress, chainLabel]);

  return state;
}

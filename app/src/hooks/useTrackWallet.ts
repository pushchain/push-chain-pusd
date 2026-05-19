/**
 * useTrackWallet — fires wallet_connected / wallet_disconnected analytics
 * events when the Push universal account transitions.
 *
 * The Push wallet provider doesn't expose lifecycle callbacks, so we
 * derive transitions from the account/origin shape returned by
 * `usePushChainClient`.
 */

import { usePushChain, usePushChainClient } from '@pushchain/ui-kit';
import { useEffect, useRef } from 'react';
import { analytics } from '../lib/analytics';
import { isPushChainKey, resolveOriginChainKey } from '../lib/wallet';

export function useTrackWallet(): void {
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();
  const wasConnectedRef = useRef(false);

  const account = pushChainClient?.universal?.account ?? null;
  const origin = pushChainClient?.universal?.origin ?? null;
  const originChainKey = PushChain
    ? resolveOriginChainKey(PushChain.CONSTANTS, origin)
    : origin?.chain ?? '';

  useEffect(() => {
    const isConnected = !!account;
    if (isConnected && !wasConnectedRef.current) {
      analytics.event('wallet_connected', {
        origin_chain: origin?.chain ?? 'unknown',
        origin_chain_key: originChainKey || 'unknown',
        origin_is_push: isPushChainKey(originChainKey),
      });
      wasConnectedRef.current = true;
    } else if (!isConnected && wasConnectedRef.current) {
      analytics.event('wallet_disconnected');
      wasConnectedRef.current = false;
    }
  }, [account, origin?.chain, originChainKey]);
}

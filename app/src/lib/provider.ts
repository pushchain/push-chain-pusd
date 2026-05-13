/**
 * Shared read-only RPC provider.
 *
 * Hooks need to read Donut chain state before a wallet is connected. The
 * UI-kit's `pushChainClient` is `null` until auth completes, so we fall back
 * to a bare ethers JsonRpcProvider for reads. This is fine — no writes,
 * no event subscriptions (we poll explicitly).
 */

import { ethers } from 'ethers';
import { RPC_URL } from '../contracts/config';

let cached: ethers.JsonRpcProvider | null = null;

/** Lazily-constructed singleton so we don't open a new connection per render. */
export function getReadProvider(): ethers.JsonRpcProvider {
  if (!cached) {
    cached = new ethers.JsonRpcProvider(RPC_URL);
  }
  return cached;
}

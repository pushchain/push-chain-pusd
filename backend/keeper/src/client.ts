import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Account,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Config } from './config.js';

export type Clients = {
  publicClient: PublicClient;
  walletClient: WalletClient | undefined;
  account: Account | undefined;
};

export function makeClients(cfg: Config): Clients {
  const chain = defineChain({
    id: cfg.chainId,
    name: 'Push Chain Donut',
    nativeCurrency: { decimals: 18, name: 'PUSH', symbol: 'PUSH' },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });

  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  if (!cfg.privateKey) {
    return { publicClient, walletClient: undefined, account: undefined };
  }

  const account = privateKeyToAccount(cfg.privateKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(cfg.rpcUrl),
  });
  return { publicClient, walletClient, account };
}

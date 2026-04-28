export const PUSD_ADDRESS = import.meta.env.VITE_PUSD_ADDRESS as `0x${string}`;
export const PUSD_MANAGER_ADDRESS = import.meta.env.VITE_PUSD_MANAGER_ADDRESS as `0x${string}`;
// v2 contracts — both addresses are optional at config-load time (returned as undefined when
// the env var is unset). Hooks/components that depend on them must guard accordingly so that
// the existing v1 deployment continues to work pre-cutover.
export const PUSD_PLUS_ADDRESS = (import.meta.env.VITE_PUSD_PLUS_ADDRESS ?? '') as `0x${string}` | '';
export const PUSD_LIQUIDITY_ADDRESS = (import.meta.env.VITE_PUSD_LIQUIDITY_ADDRESS ?? '') as `0x${string}` | '';
export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID);
export const RPC_URL = import.meta.env.VITE_RPC_URL;

export const PUSH_CHAIN = {
  id: CHAIN_ID,
  name: 'Push Chain Testnet',
  network: 'push-testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'PUSH',
    symbol: 'PUSH',
  },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'BlockScout', url: 'https://donut.push.network' },
  },
  testnet: true,
} as const;

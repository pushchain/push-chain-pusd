export const PUSD_ADDRESS = import.meta.env.VITE_PUSD_ADDRESS as `0x${string}`;
export const PUSD_MANAGER_ADDRESS = import.meta.env.VITE_PUSD_MANAGER_ADDRESS as `0x${string}`;
export const PUSD_PLUS_ADDRESS = import.meta.env.VITE_PUSD_PLUS_ADDRESS as `0x${string}` | undefined;
export const INSURANCE_FUND_ADDRESS = import.meta.env.VITE_INSURANCE_FUND_ADDRESS as `0x${string}` | undefined;
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

import 'dotenv/config';
import type { Hex } from 'viem';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function parseHexAddress(name: string): `0x${string}` {
  const v = required(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`${name} is not a 0x address`);
  return v as `0x${string}`;
}

function parseHexKey(name: string): Hex | undefined {
  const v = process.env[name];
  if (!v || v.length === 0) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} must be 0x + 64 hex chars`);
  return v as Hex;
}

export type Config = {
  rpcUrl: string;
  chainId: number;
  manager: `0x${string}`;
  vault: `0x${string}`;
  privateKey: Hex | undefined;
  loopIntervalMs: number;
  rebalancePageSize: number;
  dryRun: boolean;
};

export function loadConfig(): Config {
  return {
    rpcUrl: required('RPC_URL'),
    chainId: Number(required('CHAIN_ID')),
    manager: parseHexAddress('PUSD_MANAGER'),
    vault: parseHexAddress('PUSD_PLUS_VAULT'),
    privateKey: parseHexKey('KEEPER_PRIVATE_KEY'),
    loopIntervalMs: Number(optional('LOOP_INTERVAL_MS', '43200000')),
    rebalancePageSize: Number(optional('REBALANCE_PAGE_SIZE', '0')),
    dryRun: optional('DRY_RUN', 'false').toLowerCase() === 'true',
  };
}

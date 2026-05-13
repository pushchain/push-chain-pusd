/**
 * Blockscout API v2 client — https://donut.push.network
 *
 * Replaces raw eth_getLogs RPC calls for event history. Key advantages:
 *   - No block-range cap (query the full chain history)
 *   - Structured JSON pagination via next_page_params
 *   - Block timestamps resolved via /api/v2/blocks/{n} (no extra RPC needed)
 *
 * Event filtering is done client-side since the v2 address/logs endpoint
 * does not expose topic-level query params. Each page returns ~50 items;
 * pagination continues until the requested limit is met or history ends.
 */

import { ethers } from 'ethers';
import PUSDManagerArtifact from '../contracts/PUSDManager.json';
import PUSDPlusVaultArtifact from '../contracts/PUSDPlusVault.json';
import { PUSD_MANAGER_ADDRESS, PUSD_PLUS_ADDRESS } from '../contracts/config';
import {
  BURNED_PLUS_TOPIC,
  DEPOSITED_TOPIC,
  DEPOSITED_TO_PLUS_TOPIC,
  QUEUE_CLAIM_FILLED_TOPIC,
  REBALANCED_TOPIC,
  REDEEMED_FROM_PLUS_TOPIC,
  REDEEMED_TOPIC,
  type ManagerEvent,
  type VaultEvent,
} from './events';

const BLOCKSCOUT_BASE = 'https://donut.push.network/api/v2';

// Singleton ABI interfaces — avoids rebuilding per hook instance.
const iface = new ethers.Interface(PUSDManagerArtifact as ethers.InterfaceAbi);
const vaultIface = new ethers.Interface(
  ((PUSDPlusVaultArtifact as { abi: unknown }).abi ?? PUSDPlusVaultArtifact) as ethers.InterfaceAbi,
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BlockscoutLog = {
  address: { hash: string };
  block_hash: string;
  block_number: number;
  data: string;
  /** Log index within the transaction. */
  index: number;
  /** Blockscout pads to length 4 with nulls for unused indexed slots. */
  topics: (string | null)[];
  transaction_hash: string;
  transaction_index: number;
  /** ISO 8601 timestamp — present on Blockscout v6+; absent on older builds. */
  timestamp?: string | null;
};

type NextPageParams = Record<string, string | number> | null;

type LogsResponse = {
  items: BlockscoutLog[];
  next_page_params: NextPageParams;
};

export type FetchedLog = {
  log: BlockscoutLog;
  event: ManagerEvent;
  /** Epoch seconds. 0 when timestamp could not be resolved. */
  timestamp: number;
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Blockscout pads `topics` to length 4 with nulls for unused indexed slots.
 * ethers' parseLog throws on those nulls — strip them before decoding.
 */
function cleanTopics(topics: BlockscoutLog['topics']): string[] {
  return topics.filter((t): t is string => typeof t === 'string' && t.length > 0);
}

/** ABI-decode a Blockscout log into a typed ManagerEvent. Returns null if unknown. */
export function parseBlockscoutLog(log: BlockscoutLog): ManagerEvent | null {
  let parsed: ethers.LogDescription | null;
  try {
    parsed = iface.parseLog({ topics: cleanTopics(log.topics), data: log.data });
  } catch {
    return null;
  }
  if (!parsed) return null;

  const common = {
    txHash: log.transaction_hash as `0x${string}`,
    blockNumber: BigInt(log.block_number),
    logIndex: log.index,
  };

  if (parsed.name === 'Deposited') {
    const [user, token, tokenAmount, pusdMinted, surplusAmount, recipient] = parsed.args;
    return {
      type: 'MINT',
      user: user as `0x${string}`,
      token: token as `0x${string}`,
      tokenAmount: BigInt(tokenAmount),
      pusdMinted: BigInt(pusdMinted),
      surplusAmount: BigInt(surplusAmount),
      recipient: recipient as `0x${string}`,
      ...common,
    };
  }
  if (parsed.name === 'Redeemed') {
    const [user, token, pusdBurned, tokenAmount, recipient] = parsed.args;
    return {
      type: 'REDEEM',
      user: user as `0x${string}`,
      token: token as `0x${string}`,
      pusdBurned: BigInt(pusdBurned),
      tokenAmount: BigInt(tokenAmount),
      recipient: recipient as `0x${string}`,
      ...common,
    };
  }
  if (parsed.name === 'DepositedToPlus') {
    const [user, tokenIn, amountIn, plusOut, recipient] = parsed.args;
    return {
      type: 'MINT_PLUS',
      user: user as `0x${string}`,
      tokenIn: tokenIn as `0x${string}`,
      amountIn: BigInt(amountIn),
      plusOut: BigInt(plusOut),
      recipient: recipient as `0x${string}`,
      ...common,
    };
  }
  if (parsed.name === 'RedeemedFromPlus') {
    const [user, plusIn, preferredAsset, basket, recipient] = parsed.args;
    return {
      type: 'REDEEM_PLUS',
      user: user as `0x${string}`,
      plusIn: BigInt(plusIn),
      preferredAsset: preferredAsset as `0x${string}`,
      basket: Boolean(basket),
      recipient: recipient as `0x${string}`,
      ...common,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const KNOWN_TOPICS = new Set(
  [DEPOSITED_TOPIC, REDEEMED_TOPIC, DEPOSITED_TO_PLUS_TOPIC, REDEEMED_FROM_PLUS_TOPIC].map((t) =>
    t.toLowerCase(),
  ),
);

function isKnownEvent(log: BlockscoutLog): boolean {
  const t0 = log.topics[0]?.toLowerCase();
  return !!t0 && KNOWN_TOPICS.has(t0);
}

const KNOWN_VAULT_TOPICS = new Set(
  [REBALANCED_TOPIC, BURNED_PLUS_TOPIC, QUEUE_CLAIM_FILLED_TOPIC].map((t) => t.toLowerCase()),
);

function isKnownVaultEvent(log: BlockscoutLog): boolean {
  const t0 = log.topics[0]?.toLowerCase();
  return !!t0 && KNOWN_VAULT_TOPICS.has(t0);
}

export function parseBlockscoutVaultLog(log: BlockscoutLog): VaultEvent | null {
  let parsed: ethers.LogDescription | null;
  try {
    parsed = vaultIface.parseLog({ topics: cleanTopics(log.topics), data: log.data });
  } catch {
    return null;
  }
  if (!parsed) return null;

  const common = {
    txHash: log.transaction_hash as `0x${string}`,
    blockNumber: BigInt(log.block_number),
    logIndex: log.index,
  };

  if (parsed.name === 'Rebalanced') {
    const [timestamp, navE18] = parsed.args;
    return { type: 'REBALANCED', timestamp: BigInt(timestamp), navE18: BigInt(navE18), ...common };
  }
  if (parsed.name === 'BurnedPlus') {
    const [from, plusIn, pusdOwed, pusdReturned, queueId] = parsed.args;
    return {
      type: 'BURNED_PLUS',
      from: from as `0x${string}`,
      plusIn: BigInt(plusIn),
      pusdOwed: BigInt(pusdOwed),
      pusdReturned: BigInt(pusdReturned),
      queueId: BigInt(queueId),
      ...common,
    };
  }
  if (parsed.name === 'QueueClaimFilled') {
    const [queueId, recipient, pusdAmount, asset] = parsed.args;
    return {
      type: 'QUEUE_CLAIM_FILLED',
      queueId: BigInt(queueId),
      recipient: recipient as `0x${string}`,
      pusdAmount: BigInt(pusdAmount),
      asset: asset as `0x${string}`,
      ...common,
    };
  }
  return null;
}

/**
 * Batch-fetch block timestamps from Blockscout for a set of block numbers.
 * Falls back gracefully (timestamp = 0) on per-block errors.
 */
async function fetchBlockTimestamps(blockNumbers: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  await Promise.allSettled(
    blockNumbers.map(async (bn) => {
      const res = await fetch(`${BLOCKSCOUT_BASE}/blocks/${bn}`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.timestamp) {
        const ms = Date.parse(data.timestamp as string);
        if (!isNaN(ms)) map.set(bn, Math.floor(ms / 1000));
      }
    }),
  );
  return map;
}

function buildLogsUrl(pageParams?: NextPageParams): string {
  const base = `${BLOCKSCOUT_BASE}/addresses/${PUSD_MANAGER_ADDRESS}/logs`;
  if (!pageParams) return base;
  const qs = new URLSearchParams(
    Object.entries(pageParams).map(([k, v]) => [k, String(v)]),
  ).toString();
  return `${base}?${qs}`;
}

function buildVaultLogsUrl(pageParams?: NextPageParams): string {
  if (!PUSD_PLUS_ADDRESS) return '';
  const base = `${BLOCKSCOUT_BASE}/addresses/${PUSD_PLUS_ADDRESS}/logs`;
  if (!pageParams) return base;
  const qs = new URLSearchParams(
    Object.entries(pageParams).map(([k, v]) => [k, String(v)]),
  ).toString();
  return `${base}?${qs}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch and parse PUSDManager events from Blockscout.
 *
 * Blockscout returns logs newest-first. Pagination continues until the
 * optional `limit` is satisfied or the history is exhausted.
 *
 * @param options.limit    Stop once we have this many matching logs (dispatch feed).
 * @param options.account  If set, only return logs where account is user (topic1)
 *                         or recipient (topic3) — client-side filter.
 * @param options.maxPages Hard cap on page fetches (default 5 ≈ ~250 raw logs).
 */
export async function fetchManagerLogs(options: {
  limit?: number;
  account?: `0x${string}` | null;
  maxPages?: number;
} = {}): Promise<FetchedLog[]> {
  const { limit, account, maxPages = 5 } = options;

  // EVM indexed address topics are zero-padded to 32 bytes:
  // 0x + 24 zero-chars + 40-char lowercase address
  const paddedAccount = account
    ? `0x${'0'.repeat(24)}${account.slice(2).toLowerCase()}`
    : null;

  const collected: { log: BlockscoutLog; event: ManagerEvent }[] = [];
  let nextPage: NextPageParams = null;
  let page = 0;

  while (page < maxPages) {
    const res = await fetch(buildLogsUrl(nextPage), {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`Blockscout API error ${res.status}`);
    const data: LogsResponse = await res.json();
    page++;

    for (const log of data.items) {
      if (!isKnownEvent(log)) continue;

      if (paddedAccount) {
        const t1 = log.topics[1]?.toLowerCase();
        const t3 = log.topics[3]?.toLowerCase();
        if (t1 !== paddedAccount && t3 !== paddedAccount) continue;
      }

      const event = parseBlockscoutLog(log);
      if (!event) continue;
      collected.push({ log, event });
    }

    if (limit !== undefined && collected.length >= limit) break;
    if (!data.next_page_params) break;
    nextPage = data.next_page_params;
  }

  const sliced = limit !== undefined ? collected.slice(0, limit) : collected;

  // Resolve timestamps — prefer inline log.timestamp (Blockscout v6+),
  // batch-fetch the block for any logs that don't include it.
  const needsBlock = sliced.filter((x) => !x.log.timestamp);
  const blockMap =
    needsBlock.length > 0
      ? await fetchBlockTimestamps([...new Set(needsBlock.map((x) => x.log.block_number))])
      : new Map<number, number>();

  return sliced.map(({ log, event }) => {
    let timestamp = 0;
    if (log.timestamp) {
      const ms = Date.parse(log.timestamp);
      timestamp = isNaN(ms) ? 0 : Math.floor(ms / 1000);
    } else {
      timestamp = blockMap.get(log.block_number) ?? 0;
    }
    return { log, event, timestamp };
  });
}

export type FetchedVaultLog = {
  log: BlockscoutLog;
  event: VaultEvent;
  /** Epoch seconds. Pulled from log.timestamp or the block. */
  timestamp: number;
};

/**
 * Fetch and parse PUSDPlusVault events from Blockscout. Returns no-op when
 * the vault address isn't configured (pre-V2 environments).
 */
export async function fetchVaultLogs(options: {
  limit?: number;
  maxPages?: number;
} = {}): Promise<FetchedVaultLog[]> {
  if (!PUSD_PLUS_ADDRESS) return [];
  const { limit, maxPages = 5 } = options;

  const collected: { log: BlockscoutLog; event: VaultEvent }[] = [];
  let nextPage: NextPageParams = null;
  let page = 0;

  while (page < maxPages) {
    const res = await fetch(buildVaultLogsUrl(nextPage), {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`Blockscout API error ${res.status}`);
    const data: LogsResponse = await res.json();
    page++;

    for (const log of data.items) {
      if (!isKnownVaultEvent(log)) continue;
      const event = parseBlockscoutVaultLog(log);
      if (!event) continue;
      collected.push({ log, event });
    }

    if (limit !== undefined && collected.length >= limit) break;
    if (!data.next_page_params) break;
    nextPage = data.next_page_params;
  }

  const sliced = limit !== undefined ? collected.slice(0, limit) : collected;

  const needsBlock = sliced.filter((x) => !x.log.timestamp);
  const blockMap =
    needsBlock.length > 0
      ? await fetchBlockTimestamps([...new Set(needsBlock.map((x) => x.log.block_number))])
      : new Map<number, number>();

  return sliced.map(({ log, event }) => {
    let timestamp = 0;
    if (log.timestamp) {
      const ms = Date.parse(log.timestamp);
      timestamp = isNaN(ms) ? 0 : Math.floor(ms / 1000);
    } else {
      timestamp = blockMap.get(log.block_number) ?? 0;
    }
    return { log, event, timestamp };
  });
}

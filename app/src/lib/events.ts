/**
 * Event log helpers for PUSDManager.
 *
 * Deployment 2 event signatures:
 *   event Deposited(address indexed user, address indexed token,
 *                   uint256 tokenAmount, uint256 pusdMinted,
 *                   uint256 surplusAmount, address indexed recipient);
 *   event Redeemed (address indexed user, address indexed token,
 *                   uint256 pusdBurned, uint256 tokenAmount,
 *                   address indexed recipient);
 *
 * Note: `recipient` is the 3rd indexed topic on Redeemed (5 fields total,
 * 3 indexed). `recipient` is also indexed on Deposited (6 fields total,
 * 3 indexed: user, token, recipient). This lets us filter by either
 * `user` or `recipient` to build a user-centric tx history.
 */

import { ethers } from 'ethers';

export const DEPOSITED_TOPIC = ethers.id(
  'Deposited(address,address,uint256,uint256,uint256,address)',
);
export const REDEEMED_TOPIC = ethers.id(
  'Redeemed(address,address,uint256,uint256,address)',
);
export const DEPOSITED_TO_PLUS_TOPIC = ethers.id(
  'DepositedToPlus(address,address,uint256,uint256,address)',
);
export const REDEEMED_FROM_PLUS_TOPIC = ethers.id(
  'RedeemedFromPlus(address,uint256,address,bool,address)',
);

// PUSDPlusVault events — emitted by the vault, not the manager.
export const REBALANCED_TOPIC = ethers.id('Rebalanced(uint256,uint256)');
export const BURNED_PLUS_TOPIC = ethers.id(
  'BurnedPlus(address,uint256,uint256,uint256,uint256)',
);
export const QUEUE_CLAIM_FILLED_TOPIC = ethers.id(
  'QueueClaimFilled(uint256,address,uint256,address)',
);

export type DepositedEvent = {
  type: 'MINT';
  user: `0x${string}`;
  token: `0x${string}`;
  tokenAmount: bigint;
  pusdMinted: bigint;
  surplusAmount: bigint;
  recipient: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
};

export type RedeemedEvent = {
  type: 'REDEEM';
  user: `0x${string}`;
  token: `0x${string}`;
  pusdBurned: bigint;
  tokenAmount: bigint;
  recipient: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
};

export type DepositedToPlusEvent = {
  type: 'MINT_PLUS';
  user: `0x${string}`;
  tokenIn: `0x${string}`;
  amountIn: bigint;
  plusOut: bigint;
  recipient: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
};

export type RedeemedFromPlusEvent = {
  type: 'REDEEM_PLUS';
  user: `0x${string}`;
  plusIn: bigint;
  preferredAsset: `0x${string}`;
  basket: boolean;
  recipient: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
};

export type ManagerEvent =
  | DepositedEvent
  | RedeemedEvent
  | DepositedToPlusEvent
  | RedeemedFromPlusEvent;

/** Parse a raw ethers log emitted by PUSDManager. Returns null if unknown. */
export function parseManagerLog(
  log: ethers.Log,
  iface: ethers.Interface,
): ManagerEvent | null {
  let parsed: ethers.LogDescription | null;
  try {
    parsed = iface.parseLog({ topics: Array.from(log.topics), data: log.data });
  } catch {
    return null;
  }
  if (!parsed) return null;

  const common = {
    txHash: log.transactionHash as `0x${string}`,
    blockNumber: BigInt(log.blockNumber),
    logIndex: log.index,
  };

  if (parsed.name === 'Deposited') {
    const [user, token, tokenAmount, pusdMinted, surplusAmount, recipient] = parsed.args;
    return {
      type: 'MINT',
      user,
      token,
      tokenAmount: BigInt(tokenAmount),
      pusdMinted: BigInt(pusdMinted),
      surplusAmount: BigInt(surplusAmount),
      recipient,
      ...common,
    };
  }
  if (parsed.name === 'Redeemed') {
    const [user, token, pusdBurned, tokenAmount, recipient] = parsed.args;
    return {
      type: 'REDEEM',
      user,
      token,
      pusdBurned: BigInt(pusdBurned),
      tokenAmount: BigInt(tokenAmount),
      recipient,
      ...common,
    };
  }
  if (parsed.name === 'DepositedToPlus') {
    const [user, tokenIn, amountIn, plusOut, recipient] = parsed.args;
    return {
      type: 'MINT_PLUS',
      user,
      tokenIn,
      amountIn: BigInt(amountIn),
      plusOut: BigInt(plusOut),
      recipient,
      ...common,
    };
  }
  if (parsed.name === 'RedeemedFromPlus') {
    const [user, plusIn, preferredAsset, basket, recipient] = parsed.args;
    return {
      type: 'REDEEM_PLUS',
      user,
      plusIn: BigInt(plusIn),
      preferredAsset,
      basket: Boolean(basket),
      recipient,
      ...common,
    };
  }
  return null;
}

// =====================================================================
// PUSDPlusVault events — emitted by the vault address.
// =====================================================================

export type RebalancedVaultEvent = {
  type: 'REBALANCED';
  timestamp: bigint;       // contract-emitted timestamp (seconds)
  navE18: bigint;          // 1e18 fixed-point NAV at this rebalance
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
};

export type BurnedPlusEvent = {
  type: 'BURNED_PLUS';
  from: `0x${string}`;
  plusIn: bigint;
  pusdOwed: bigint;
  pusdReturned: bigint;
  queueId: bigint;         // 0 if fully filled at burn time
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
};

export type QueueClaimFilledEvent = {
  type: 'QUEUE_CLAIM_FILLED';
  queueId: bigint;
  recipient: `0x${string}`;
  pusdAmount: bigint;
  asset: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
};

export type VaultEvent = RebalancedVaultEvent | BurnedPlusEvent | QueueClaimFilledEvent;

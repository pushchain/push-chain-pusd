/**
 * Transaction cascade helpers.
 *
 * Every mutation on PUSD/PUSDManager is a two-step cascade: approve the
 * ERC-20 spender, then call the mutator. We encode both legs with
 * `PushChain.utils.helpers.encodeTxData` and submit them in a single
 * `sendTransaction` call via its `data: [{...}, {...}]` cascade form.
 *
 * V2 entrypoints (PUSD+) live on PUSDManager:
 *   depositToPlus(address tokenIn, uint256 amount, address recipient)
 *   redeemFromPlus(uint256 plusAmount, address preferredAsset, bool allowBasket, address recipient)
 *
 * Queue claim fulfilment lives on PUSDPlusVault:
 *   fulfillQueueClaim(uint256 queueId)
 */

export const APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export const DEPOSIT_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
  },
] as const;

export const REDEEM_ABI = [
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pusdAmount', type: 'uint256' },
      { name: 'preferredAsset', type: 'address' },
      { name: 'allowBasket', type: 'bool' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
  },
] as const;

export const DEPOSIT_TO_PLUS_ABI = [
  {
    type: 'function',
    name: 'depositToPlus',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
  },
] as const;

export const REDEEM_FROM_PLUS_ABI = [
  {
    type: 'function',
    name: 'redeemFromPlus',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'plusAmount', type: 'uint256' },
      { name: 'preferredAsset', type: 'address' },
      { name: 'allowBasket', type: 'bool' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
  },
] as const;

export const FULFILL_QUEUE_CLAIM_ABI = [
  {
    type: 'function',
    name: 'fulfillQueueClaim',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'queueId', type: 'uint256' }],
    outputs: [],
  },
] as const;

/**
 * Minimal subset of the PushChain helpers we use. Kept generic so this file
 * doesn't have to import the concrete PushChain namespace type.
 */
export type HelpersLike = {
  encodeTxData: (args: { abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) => `0x${string}`;
  parseUnits: (value: string, decimals: number) => bigint;
};

export type CascadeLeg = {
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
};

export function buildApproveLeg(
  helpers: HelpersLike,
  tokenAddress: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
): CascadeLeg {
  const data = helpers.encodeTxData({
    abi: APPROVE_ABI,
    functionName: 'approve',
    args: [spender, amount],
  });
  return { to: tokenAddress, value: 0n, data };
}

export function buildDepositLeg(
  helpers: HelpersLike,
  managerAddress: `0x${string}`,
  tokenAddress: `0x${string}`,
  amount: bigint,
  recipient: `0x${string}`,
): CascadeLeg {
  const data = helpers.encodeTxData({
    abi: DEPOSIT_ABI,
    functionName: 'deposit',
    args: [tokenAddress, amount, recipient],
  });
  return { to: managerAddress, value: 0n, data };
}

export function buildRedeemLeg(
  helpers: HelpersLike,
  managerAddress: `0x${string}`,
  pusdAmount: bigint,
  preferredAsset: `0x${string}`,
  allowBasket: boolean,
  recipient: `0x${string}`,
): CascadeLeg {
  const data = helpers.encodeTxData({
    abi: REDEEM_ABI,
    functionName: 'redeem',
    args: [pusdAmount, preferredAsset, allowBasket, recipient],
  });
  return { to: managerAddress, value: 0n, data };
}

export function buildDepositToPlusLeg(
  helpers: HelpersLike,
  managerAddress: `0x${string}`,
  tokenIn: `0x${string}`,
  amount: bigint,
  recipient: `0x${string}`,
): CascadeLeg {
  const data = helpers.encodeTxData({
    abi: DEPOSIT_TO_PLUS_ABI,
    functionName: 'depositToPlus',
    args: [tokenIn, amount, recipient],
  });
  return { to: managerAddress, value: 0n, data };
}

export function buildRedeemFromPlusLeg(
  helpers: HelpersLike,
  managerAddress: `0x${string}`,
  plusAmount: bigint,
  preferredAsset: `0x${string}`,
  allowBasket: boolean,
  recipient: `0x${string}`,
): CascadeLeg {
  const data = helpers.encodeTxData({
    abi: REDEEM_FROM_PLUS_ABI,
    functionName: 'redeemFromPlus',
    args: [plusAmount, preferredAsset, allowBasket, recipient],
  });
  return { to: managerAddress, value: 0n, data };
}

export function buildFulfillQueueClaimLeg(
  helpers: HelpersLike,
  vaultAddress: `0x${string}`,
  queueId: bigint,
): CascadeLeg {
  const data = helpers.encodeTxData({
    abi: FULFILL_QUEUE_CLAIM_ABI,
    functionName: 'fulfillQueueClaim',
    args: [queueId],
  });
  return { to: vaultAddress, value: 0n, data };
}

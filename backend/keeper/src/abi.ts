// Minimal ABI subsets — only what the keeper calls.

export const VAULT_ABI = [
  {
    type: 'function',
    name: 'rebalance',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'rebalanceBatch',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'startIdx', type: 'uint256' },
      { name: 'count', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'fulfillQueueClaim',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'queueId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'positionIds',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nextQueueId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'queue',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'recipient', type: 'address' },
      { name: 'preferredAsset', type: 'address' },
      { name: 'allowBasket', type: 'bool' },
      { name: 'pusdOwed', type: 'uint128' },
      { name: 'queuedAt', type: 'uint64' },
    ],
  },
  {
    type: 'function',
    name: 'totalAssets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalQueuedPusd',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nav',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'paused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

---
name: push-pusd
description: Integrate with PUSD — the cross-chain par-backed stablecoin on Push Chain Donut Testnet. Mint PUSD by depositing USDC/USDT from any supported chain, redeem PUSD for any reserve token, read protocol state, or call the contracts on-chain from another smart contract. Two integration paths from off-chain (external-chain wallet via multicall, or native Push EOA) and a Solidity interface for on-chain integrations.
version: 2.0.0
network: testnet
chain_id: 42101
rpc: https://evm.donut.rpc.push.org/
explorer: https://donut.push.network
contracts:
  pusd: '0x488d080e16386379561a47A4955D22001d8A9D89'
  pusd_manager: '0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46'
packages:
  frontend: '@pushchain/ui-kit'
  backend: '@pushchain/core'
  onchain: 'solidity ^0.8.20'
resources:
  - https://pusd.push.org/agents/skill/push-pusd/SKILL.md
  - https://pusd.push.org/llms.txt
  - https://pusd.push.org/docs
---

# Skill: PUSD Integration

**Intent**: Mint and redeem PUSD — the cross-chain par-backed stablecoin on Push Chain — from any frontend, backend, or on-chain context.

PUSD is a 6-decimal ERC-20 stablecoin pegged 1:1 to reserve stablecoins (USDC / USDT bridged from Ethereum, Base, Arbitrum, Solana, BNB). It lives entirely on Push Chain Donut Testnet (chain ID 42101). All accounting is at 6 decimals across PUSD and every reserve token.

Integration choices:

- **Off-chain SDK** — `@pushchain/ui-kit` (React) or `@pushchain/core` (Node). Goes through Push Chain's universal transaction layer. Handles cross-chain wallet identity, payload encoding, and optional bridging. Recommended for new integrations.
- **On-chain Solidity** — Another contract on Donut imports the PUSD / PUSDManager interfaces and calls them directly. Used when your protocol holds PUSD or mints / burns PUSD on behalf of users.

---

## Architecture

Two upgradeable contracts on Donut. PUSD is a minimal ERC-20; PUSDManager owns all reserve logic.

```
PUSD.sol ─ ERC-20, 6 decimals, UUPS proxy
  mint(to, amount)            ← MINTER_ROLE only  → held by PUSDManager
  burn(from, amount)          ← BURNER_ROLE only  → held by PUSDManager

PUSDManager.sol ─ reserve orchestrator, UUPS proxy
  deposit(token, amount, recipient)                            → mints PUSD
  redeem(pusdAmount, preferredAsset, allowBasket, recipient)   → burns PUSD
```

### Live addresses — Donut Testnet (chain 42101)

| Contract    | Proxy                                        |
| ----------- | -------------------------------------------- |
| PUSD        | `0x488d080e16386379561a47A4955D22001d8A9D89` |
| PUSDManager | `0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46` |

RPC: `https://evm.donut.rpc.push.org/` — Explorer: `https://donut.push.network`

### Reserve tokens (9 total, 5 chains, all 6 decimals on Donut)

| Symbol | Origin chain     | Donut address                                |
| ------ | ---------------- | -------------------------------------------- |
| USDT   | Ethereum Sepolia | `0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3` |
| USDC   | Ethereum Sepolia | `0x7A58048036206bB898008b5bBDA85697DB1e5d66` |
| USDT   | Solana Devnet    | `0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34` |
| USDC   | Solana Devnet    | `0xCd6e2e7A43E0Cfd0Df83dCb0EdB5c5EC4F27Ce8f` |
| USDT   | Base Sepolia     | `0x9f475519ac7bdbEC65F00E2f6A6CB26c20B5Ff52` |
| USDC   | Base Sepolia     | `0x2fCC0Ef4F0b0Ffb5Ee93F48B48F50Ef5e66c0b5b` |
| USDT   | Arbitrum Sepolia | `0x3A3c8aFC2e7BCBe3d79Af9dD4cA4CD7C1eEDD23c` |
| USDC   | Arbitrum Sepolia | `0x9fa527Fe5e16b9e1bfa72Cb9C01d40aaab11EBC2` |
| USDT   | BNB Testnet      | `0xEc9E90Dc88D86dB0e9E1f4aA59a61Df5f7A5E3b1` |

---

## Fee model

| Fee                    | When               | Default       | Max             | Effect                                                   |
| ---------------------- | ------------------ | ------------- | --------------- | -------------------------------------------------------- |
| Deposit haircut        | On mint            | 0 bps (0%)    | 4000 bps (40%)  | Stays in reserve as surplus, used to deprecate risky tokens |
| Base redemption fee    | On every redeem    | 5 bps (0.05%) | 100 bps (1%)    | Accrued per-token, swept to treasury                     |
| Preferred asset premium | Single-token redeem | preferredFeeMin–Max | 200 bps (2%) | Interpolated by token liquidity                          |

```
Net PUSD minted  = amount − floor(amount × haircutBps / 10000)
Net token out    = pusdAmount − floor(pusdAmount × (baseFee + preferredFee) / 10000)
```

---

## Redemption routing

Three paths, picked automatically by PUSDManager based on preferred-asset liquidity and token status:

| Route           | Condition                                         | Fee                      |
| --------------- | ------------------------------------------------- | ------------------------ |
| Preferred asset | preferredAsset ENABLED + sufficient liquidity     | baseFee + preferredFee   |
| Basket          | preferred unavailable, allowBasket = true         | baseFee only             |
| Emergency       | any token in EMERGENCY_REDEEM status              | forced proportional drain |

> Always pass `allowBasket = true` in production. If the preferred token runs dry the basket route activates and the call won't revert.

---

## Off-chain SDK — two write paths

Every PUSD mutation (mint, redeem) goes through `pushChainClient.universal.sendTransaction(...)`. The **shape of the payload** depends on which wallet signed in.

**Path A — External-chain wallet** (MetaMask on Sepolia, Phantom on Solana, Coinbase Wallet, etc.) — the user gets a relay-managed account on Donut that supports multicall. Approve + deposit ride in **one signature**, batched as a multicall. Outer `to` is the zero address — the marker the relay reads as "walk each leg against its own `to`".

**Path B — Native Push EOA** (Push Wallet, or any private key signing directly against the Donut RPC) — a regular EVM externally-owned account, no multicall. Mint takes **two separate signatures** (approve, then deposit). **Redeem is one signature on either path** — `PUSDManager` holds `BURNER_ROLE` on PUSD and burns `msg.sender` directly, so no PUSD approval is required.

**Bridging.** If the reserve token lives on the user's origin chain (USDT on Sepolia, etc.) instead of already sitting on Donut, attach a `funds` param to the same call. The relay moves the tokens over to your Push Chain account before the legs execute. Bridging applies to path A only; path B assumes the token is already on Donut.

---

## Deposit (Mint PUSD)

### React — `@pushchain/ui-kit`

```bash
npm install @pushchain/ui-kit@latest
```

Wrap your app root once with the provider:

```tsx
import { PushUniversalWalletProvider, PushUI } from '@pushchain/ui-kit';

// main.tsx
<PushUniversalWalletProvider
  config={{
    network: PushUI.CONSTANTS.PUSH_NETWORK.TESTNET,
    app: { title: 'My PUSD App' },
    login: { email: true, google: true, wallet: true },
  }}
>
  <App />
</PushUniversalWalletProvider>;
```

**Path A — multicall in one signature, funds already on Donut:**

```tsx
import { usePushChainClient, usePushChain } from '@pushchain/ui-kit';

const ZERO = '0x0000000000000000000000000000000000000000' as const;

function MintButton() {
  const { pushChainClient, isInitialized, error } = usePushChainClient();
  const { PushChain } = usePushChain();

  if (error) return <div role="alert">{error.message}</div>;
  if (!isInitialized) return <div>Loading…</div>;
  if (!pushChainClient) return null;

  const mint = async () => {
    const h = PushChain.utils.helpers;
    const amount = h.parseUnits('100', 6);
    const recipient = pushChainClient.universal.account.address as `0x${string}`;
    const TOKEN = '0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3' as const; // USDT-Sepolia on Donut
    const MANAGER = '0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46' as const;

    const multicall = [
      { to: TOKEN, value: 0n, data: h.encodeTxData({ abi: APPROVE_ABI, functionName: 'approve', args: [MANAGER, amount] }) },
      { to: MANAGER, value: 0n, data: h.encodeTxData({ abi: DEPOSIT_ABI, functionName: 'deposit', args: [TOKEN, amount, recipient] }) },
    ];

    // Outer 'to' is the zero sentinel -> the relay treats this as a multicall.
    const tx = await pushChainClient.universal.sendTransaction({
      to: ZERO,
      value: 0n,
      data: multicall,
    });
    await tx.wait();
  };

  return <button onClick={mint}>Mint 100 PUSD</button>;
}
```

**Path A — with bridging** — user holds USDT on Ethereum Sepolia, the relay bridges into the user's Push Chain account before the multicall runs:

```tsx
const tx = await pushChainClient.universal.sendTransaction({
  to: ZERO,
  value: 0n,
  data: multicall, // approve + deposit, as above
  funds: {
    amount, // 100 USDT (6 dec)
    token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDT,
  },
});
await tx.wait();
```

**Path B — native Push EOA — two signed transactions:**

```tsx
const mintFromPushEoa = async () => {
  const h = PushChain.utils.helpers;
  const amount = h.parseUnits('100', 6);
  const recipient = pushChainClient.universal.account.address as `0x${string}`;

  // Tx 1 (signature 1 of 2): approve PUSDManager to spend the reserve token.
  await (await pushChainClient.universal.sendTransaction({
    to: TOKEN,
    value: 0n,
    data: h.encodeTxData({ abi: APPROVE_ABI, functionName: 'approve', args: [MANAGER, amount] }),
  })).wait();

  // Tx 2 (signature 2 of 2): deposit, mint PUSD to recipient.
  await (await pushChainClient.universal.sendTransaction({
    to: MANAGER,
    value: 0n,
    data: h.encodeTxData({ abi: DEPOSIT_ABI, functionName: 'deposit', args: [TOKEN, amount, recipient] }),
  })).wait();
};
```

### Node.js — `@pushchain/core`

```bash
npm install @pushchain/core ethers
```

**Path A — server signing on behalf of an external-chain user (multicall):**

```ts
import { PushChain } from '@pushchain/core';
import { ethers } from 'ethers';

const wallet = new ethers.Wallet(
  process.env.PRIVATE_KEY!,
  new ethers.JsonRpcProvider('https://sepolia.infura.io/v3/<KEY>'),
);
const signer = PushChain.utils.signer.toUniversalFromEthersSigner(wallet);
const pc = await PushChain.initialize(signer, {
  network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
});

const ZERO = '0x0000000000000000000000000000000000000000';
const h = pc.utils.helpers;
const amount = h.parseUnits('100', 6);
const owner = pc.universal.account.address;

await (await pc.universal.sendTransaction({
  to: ZERO,
  value: 0n,
  data: [
    { to: TOKEN, value: 0n, data: h.encodeTxData({ abi: APPROVE_ABI, functionName: 'approve', args: [MANAGER, amount] }) },
    { to: MANAGER, value: 0n, data: h.encodeTxData({ abi: DEPOSIT_ABI, functionName: 'deposit', args: [TOKEN, amount, owner] }) },
  ],
})).wait();
```

**Path B — native Push EOA, two signed transactions:**

```ts
const wallet = new ethers.Wallet(
  process.env.PRIVATE_KEY!,
  new ethers.JsonRpcProvider('https://evm.donut.rpc.push.org/'),
);
const signer = PushChain.utils.signer.toUniversalFromEthersSigner(wallet);
const pc = await PushChain.initialize(signer, {
  network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
});

const h = pc.utils.helpers;
const amount = h.parseUnits('100', 6);
const owner = await wallet.getAddress();

// Tx 1: approve PUSDManager to spend the reserve token.
await (await pc.universal.sendTransaction({
  to: TOKEN,
  value: 0n,
  data: h.encodeTxData({ abi: APPROVE_ABI, functionName: 'approve', args: [MANAGER, amount] }),
})).wait();

// Tx 2: deposit, mint PUSD to owner.
await (await pc.universal.sendTransaction({
  to: MANAGER,
  value: 0n,
  data: h.encodeTxData({ abi: DEPOSIT_ABI, functionName: 'deposit', args: [TOKEN, amount, owner] }),
})).wait();
```

---

## Redeem (Burn PUSD)

> Same shape on both paths. `PUSDManager` holds `BURNER_ROLE` on PUSD and burns `msg.sender` directly — **no PUSD approval is required**. Path A and path B issue the exact same call; the only difference is who holds the signing key.

### React — single call

```tsx
const MANAGER = '0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46' as const;
const TOKEN = '0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3' as const; // the asset you want back

const redeem = async () => {
  const h = PushChain.utils.helpers;
  const pusdAmount = h.parseUnits('99', 6);
  const recipient = pushChainClient.universal.account.address as `0x${string}`;

  const tx = await pushChainClient.universal.sendTransaction({
    to: MANAGER,
    value: 0n,
    data: h.encodeTxData({
      abi: REDEEM_ABI,
      functionName: 'redeem',
      args: [pusdAmount, TOKEN, true, recipient],
    }),
  });
  await tx.wait();
};
```

### Cross-chain payout — burn on Push Chain, bridge out to an external chain

Two real top-level transactions. `prepareTransaction` + `executeTransactions`. The second hop carries `to: { address, chain }` so the relay knows where to send the tokens.

```tsx
const redeemAndPayout = async () => {
  const h = PushChain.utils.helpers;
  const pusdAmount = h.parseUnits('99', 6);
  const pushAccount = pushChainClient.universal.account.address as `0x${string}`;
  const externalWallet = '0xUserOnSepolia' as const;

  // Hop 1: burn PUSD on Push Chain. Single call, no approve.
  const burnHop = await pushChainClient.universal.prepareTransaction({
    to: MANAGER,
    value: 0n,
    data: h.encodeTxData({
      abi: REDEEM_ABI,
      functionName: 'redeem',
      args: [pusdAmount, TOKEN, true, pushAccount],
    }),
  });

  // Hop 2: forward the received USDT to the user's wallet on Sepolia.
  const payoutHop = await pushChainClient.universal.prepareTransaction({
    to: { address: externalWallet, chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA },
    value: 0n,
    data: '0x',
    funds: { amount: pusdAmount, token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDT },
  });

  const result = await pushChainClient.universal.executeTransactions(
    [burnHop, payoutHop],
    { progressHook: (p) => console.log(p.id, p.message) },
  );
  if (!result.success) throw new Error('Cross-chain redeem failed');
};
```

### Node.js — single call

```ts
// Works for both path A and path B -- same RPC, same call.
const pusdAmount = h.parseUnits('99', 6);
const owner = pc.universal.account.address;

await (await pc.universal.sendTransaction({
  to: MANAGER,
  value: 0n,
  data: h.encodeTxData({
    abi: REDEEM_ABI,
    functionName: 'redeem',
    args: [pusdAmount, TOKEN, true, owner],
  }),
})).wait();
```

---

## On-chain Solidity (calling PUSD / PUSDManager from another contract)

When your protocol on Donut wants to mint PUSD on behalf of users, hold PUSD as a treasury asset, or read PUSDManager state mid-transaction — import the interfaces below.

### Minimal interfaces

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPUSD {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amt) external returns (bool);
    function transferFrom(address from, address to, uint256 amt) external returns (bool);
    function approve(address spender, uint256 amt) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IPUSDManager {
    enum TokenStatus { REMOVED, ENABLED, REDEEM_ONLY, EMERGENCY_REDEEM }

    struct TokenInfo {
        bool    exists;
        uint8   status;
        uint8   decimals;
        uint16  surplusHaircutBps;
        string  name;
        string  chainNamespace;
    }

    // Mutators -- called by the integrating contract.
    function deposit(address token, uint256 amount, address recipient) external;
    function redeem(uint256 pusdAmount, address preferredAsset, bool allowBasket, address recipient) external;

    // Reads -- safe to call from any context.
    function baseFee() external view returns (uint256);
    function preferredFeeMin() external view returns (uint256);
    function preferredFeeMax() external view returns (uint256);
    function getSupportedTokensCount() external view returns (uint256);
    function getTokenStatus(address token) external view returns (uint8);
    function getTokenInfo(address token) external view returns (TokenInfo memory);
    function getAccruedSurplus(address token) external view returns (uint256);
}
```

### Deposit — mint PUSD from another contract

Pull reserve from caller, approve PUSDManager, call `deposit`. `safeTransferFrom` inside the manager pulls from `address(this)`, so the allowance is from your contract, not from the user.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPUSD, IPUSDManager} from "./IPUSD.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PUSDMinter {
    IPUSDManager public constant MANAGER =
        IPUSDManager(0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46);

    /// @notice Pull `amount` of `token` from caller, deposit it into
    ///         PUSDManager, mint PUSD straight to `recipient`.
    function mintFor(address token, uint256 amount, address recipient) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        IERC20(token).approve(address(MANAGER), amount);
        MANAGER.deposit(token, amount, recipient);
    }
}
```

### Redeem — burn PUSD from another contract

Pull PUSD into your contract, then call `redeem`. **No approval needed** — `PUSDManager` burns from `msg.sender` directly via `BURNER_ROLE` on PUSD.

```solidity
contract PUSDRedeemer {
    IPUSD        public constant PUSD =
        IPUSD(0x488d080e16386379561A47A4955d22001D8a9D89);
    IPUSDManager public constant MANAGER =
        IPUSDManager(0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46);

    function redeemFor(
        uint256 pusdAmount,
        address preferredAsset,
        bool    allowBasket,
        address recipient
    ) external {
        PUSD.transferFrom(msg.sender, address(this), pusdAmount);
        // No approve. PUSDManager calls pusd.burn(msg.sender, ...) under BURNER_ROLE.
        MANAGER.redeem(pusdAmount, preferredAsset, allowBasket, recipient);
    }
}
```

### Read — quote and inspect protocol state

All read helpers are `view`, so any contract can call them in the same transaction it's executing in.

```solidity
contract PUSDReader {
    IPUSD        public constant PUSD =
        IPUSD(0x488d080e16386379561A47A4955d22001D8a9D89);
    IPUSDManager public constant MANAGER =
        IPUSDManager(0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46);

    /// Quote how much PUSD a user would get from depositing `amount` of `token`,
    /// accounting for the manager's base fee in basis points. 6-dec math.
    function quoteMint(address token, uint256 amount)
        external view returns (uint256 expectedPUSD, IPUSDManager.TokenStatus status)
    {
        IPUSDManager.TokenInfo memory info = MANAGER.getTokenInfo(token);
        require(info.exists, "PUSDReader: unsupported token");

        uint256 baseFeeBps = MANAGER.baseFee();
        uint256 fee = (amount * baseFeeBps) / 10_000;
        expectedPUSD = amount - fee;
        status = IPUSDManager.TokenStatus(info.status);
    }

    function reserveOf(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(MANAGER));
    }

    function circulating() external view returns (uint256) {
        return PUSD.totalSupply();
    }
}
```

---

## ABI fragments (for SDK `encodeTxData` and ethers.js `Interface`)

```ts
const APPROVE_ABI = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

const DEPOSIT_ABI = [{
  type: 'function', name: 'deposit', stateMutability: 'nonpayable',
  inputs: [
    { name: 'token',     type: 'address' },
    { name: 'amount',    type: 'uint256' },
    { name: 'recipient', type: 'address' },
  ],
  outputs: [],
}] as const;

const REDEEM_ABI = [{
  type: 'function', name: 'redeem', stateMutability: 'nonpayable',
  inputs: [
    { name: 'pusdAmount',     type: 'uint256' },
    { name: 'preferredAsset', type: 'address' },
    { name: 'allowBasket',    type: 'bool'    },
    { name: 'recipient',      type: 'address' },
  ],
  outputs: [],
}] as const;
```

---

## Common mistakes

| Mistake                                          | Fix                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `sendTransaction([leg1, leg2])` — bare array     | Cascade rides in `data`: `sendTransaction({ to: ZERO, value: 0n, data: legs })`      |
| Adding an approve before redeem                  | Redeem doesn't need it — `PUSDManager` burns `msg.sender` directly via `BURNER_ROLE` |
| `parseUnits(value, 18)`                          | PUSD + every reserve uses 6 decimals — `parseUnits(value, 6)`                        |
| `recipient = address(0)`                         | Both `deposit` and `redeem` revert on zero address                                   |
| Preferred redeem always expected to succeed      | Pass `allowBasket = true`; basket route activates if preferred is short              |
| `npm install @pushchain/core` in a UI Kit app    | `@pushchain/core` is bundled in `@pushchain/ui-kit` — use `usePushChain()` instead   |
| Path-B mint as a single multicall                | Native Push EOAs have no multicall; mint is **two sequential** transactions          |

---

## Quick reference

| Operation       | Contract       | Function                                                  |
| --------------- | -------------- | --------------------------------------------------------- |
| Mint PUSD       | PUSDManager    | `deposit(token, amount, recipient)`                       |
| Redeem PUSD     | PUSDManager    | `redeem(pusdAmount, preferredAsset, allowBasket, recipient)` |
| PUSD balance    | PUSD           | `balanceOf(address)`                                      |
| Total supply    | PUSD           | `totalSupply()`                                           |
| Token info      | PUSDManager    | `getTokenInfo(token)`                                     |
| Fee config      | PUSDManager    | `baseFee()`, `preferredFeeMin()`, `preferredFeeMax()`     |
| Reserve balance | reserve token  | `balanceOf(PUSDManager)`                                  |
| Accrued surplus | PUSDManager    | `getAccruedSurplus(token)`                                |

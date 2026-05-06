---
name: push-pusd
description: Integrate with PUSD and PUSD+ — the cross-chain par-backed stablecoin and yield-bearing companion on Push Chain Donut Testnet. Mint PUSD by depositing USDC/USDT from any supported chain, redeem PUSD for any reserve token, mint/redeem PUSD+ in one call, read protocol state, or call the contracts on-chain from another smart contract. Two integration paths from off-chain (external-chain wallet via multicall, or native Push EOA) and a Solidity interface for on-chain integrations.
version: 3.1.0
network: testnet
chain_id: 42101
rpc: https://evm.donut.rpc.push.org/
explorer: https://donut.push.network
contracts:
  pusd: '0x488d080e16386379561a47A4955D22001d8A9D89'
  pusd_manager: '0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46'
  pusd_plus_vault: '0xb55a5B36d82D3B7f18Afe42F390De565080A49a1'
  insurance_fund: '0xFF7E741621ad5d39015759E3d606A631Fa319a62'
packages:
  frontend: '@pushchain/ui-kit'
  backend: '@pushchain/core'
  onchain: 'solidity ^0.8.20'
resources:
  - https://pusd.push.org/agents/skill/push-pusd/SKILL.md
  - https://pusd.push.org/llms.txt
  - https://pusd.push.org/docs
---

# Skill: PUSD + PUSD+ Integration

**Intent**: Mint and redeem PUSD (par-backed) and PUSD+ (yield-bearing) on Push Chain — from any frontend, backend, or on-chain context.

PUSD is a 6-decimal ERC-20 stablecoin pegged 1:1 to reserve stablecoins (USDC / USDT bridged from Ethereum, Base, Arbitrum, Solana, BNB). PUSD+ is a 6-decimal yield-bearing companion whose NAV grows monotonically as the vault collects LP fees from Uniswap V3 stable/stable pools on Push Chain. Both live on Push Chain Donut Testnet (chain ID 42101). All accounting is at 6 decimals.

Integration choices:

- **Off-chain SDK** — `@pushchain/ui-kit` (React) or `@pushchain/core` (Node). Goes through Push Chain's universal transaction layer. Handles cross-chain wallet identity, payload encoding, and optional bridging. Recommended for new integrations.
- **On-chain Solidity** — Another contract on Donut imports the PUSD / PUSDManager / PUSDPlusVault interfaces and calls them directly. Used when your protocol holds PUSD/PUSD+ or mints / burns on behalf of users.

---

## Architecture

Three contracts plus a passive sidecar on Donut. All UUPS proxies.

```
PUSD.sol              ─ ERC-20, 6 decimals
  mint(to, amount)            ← MINTER_ROLE only  → held by PUSDManager
  burn(from, amount)          ← BURNER_ROLE only  → held by PUSDManager

PUSDManager.sol       ─ reserve orchestrator (v2)
  // par-backed entrypoints (v1, unchanged)
  deposit(token, amount, recipient)                            → mints PUSD
  redeem(pusdAmount, preferredAsset, allowBasket, recipient)   → burns PUSD
  // yield-product entrypoints (v2)
  depositToPlus(tokenIn, amount, recipient)                    → mints PUSD+
  redeemFromPlus(plusAmount, preferredAsset, allowBasket, recipient)  → burns PUSD+

PUSDPlusVault.sol     ─ NAV-bearing custom ERC-20 (PUSD+, 6 decimals)
  // user-facing reads
  nav() / totalAssets() / previewMintPlus() / previewBurnPlus()
  // user-facing claim path (queued redeems)
  fulfillQueueClaim(queueId)

InsuranceFund.sol     ─ passive sidecar; receives the LP-fee haircut
```

> PUSD+ is a **custom 6-decimal ERC-20 with NAV-per-share**, not ERC-4626. Use `previewMintPlus` / `previewBurnPlus` to quote.

### Live addresses — Donut Testnet (chain 42101)

| Contract       | Proxy                                        |
| -------------- | -------------------------------------------- |
| PUSD           | `0x488d080e16386379561a47A4955D22001d8A9D89` |
| PUSDManager    | `0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46` |
| PUSDPlusVault  | `0xb55a5B36d82D3B7f18Afe42F390De565080A49a1` |
| InsuranceFund  | `0xFF7E741621ad5d39015759E3d606A631Fa319a62` |

RPC: `https://evm.donut.rpc.push.org/` — Explorer: `https://donut.push.network`

Always interact with the **proxy** addresses. Implementations change on upgrade; the proxies do not.

### Reserve tokens (9 total, 5 chains, all 6 decimals on Donut)

| Symbol | Origin chain     | Donut address                                |
| ------ | ---------------- | -------------------------------------------- |
| USDT   | Ethereum Sepolia | `0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3` |
| USDC   | Ethereum Sepolia | `0x7A58048036206bB898008b5bBDA85697DB1e5d66` |
| USDT   | Solana Devnet    | `0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34` |
| USDC   | Solana Devnet    | `0x04B8F634ABC7C879763F623e0f0550a4b5c4426F` |
| USDT   | Base Sepolia     | `0x2C455189D2af6643B924A981a9080CcC63d5a567` |
| USDC   | Base Sepolia     | `0xD7C6cA1e2c0CE260BE0c0AD39C1540de460e3Be1` |
| USDT   | Arbitrum Sepolia | `0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9` |
| USDC   | Arbitrum Sepolia | `0x1091cCBA2FF8d2A131AE4B35e34cf3308C48572C` |
| USDT   | BNB Testnet      | `0x2f98B4235FD2BA0173a2B056D722879360B12E7b` |

> Source of truth: this list ≡ on-chain enumeration via `PUSDManager.getSupportedTokenAt(i)` ≡ [`app/src/contracts/tokens.ts`](https://github.com/pushchain/push-chain-pusd/blob/main/app/src/contracts/tokens.ts). On-chain `chainNamespace` strings are `Ethereum_Sepolia`, `Solana_Devnet`, `Base_Testnet`, `Arbitrum_Sepolia`, `BNB_Testnet`.

> `setPlusVault`, `setFeeExempt`, `depositForVault` on PUSDManager are **vault-only** — gated by a two-key check (`msg.sender == plusVault && feeExempt[plusVault]`). Don't call them from integrator code.

---

## Fee model

| Fee                     | When               | Default       | Max             | Effect                                                   |
| ----------------------- | ------------------ | ------------- | --------------- | -------------------------------------------------------- |
| Deposit haircut         | On mint            | 0 bps (0%)    | 1000 bps (10%)  | Stays in reserve as surplus, used to deprecate risky tokens |
| Base redemption fee     | On every redeem    | 5 bps (0.05%) | 100 bps (1%)    | Accrued per-token, swept to treasury                     |
| Preferred asset premium | Single-token redeem | preferredFeeMin–Max | 200 bps (2%) | Interpolated by token liquidity                          |
| PUSD+ mint              | depositToPlus      | 0 bps         | —               | Wrap leg charges no fee; mint leg still applies haircut on the token |
| PUSD+ redeem            | redeemFromPlus     | 0 bps         | —               | Protocol-internal compose; reserve payout charges no base or preferred fee |

```
Net PUSD minted  = amount − floor(amount × haircutBps / 10000)
Net token out    = pusdAmount − floor(pusdAmount × (baseFee + preferredFee) / 10000)
```

---

## Redemption routing (PUSDManager.redeem)

Three paths, picked automatically based on preferred-asset liquidity and token status:

| Route           | Condition                                         | Fee                      |
| --------------- | ------------------------------------------------- | ------------------------ |
| Preferred asset | preferredAsset ENABLED + sufficient liquidity     | baseFee + preferredFee   |
| Basket          | preferred unavailable, allowBasket = true         | baseFee only             |
| Emergency       | any token in EMERGENCY_REDEEM status              | forced proportional drain |

> Always pass `allowBasket = true` in production. If the preferred token runs dry the basket route activates and the call won't revert.

---

## PUSD+ redemption — three-tier fulfilment

`redeemFromPlus` first burns PUSD+ from the caller (committing them to current NAV), then sources PUSD via:

1. **Instant** — vault has idle PUSD ≥ pusdOwed → ship now.
2. **Convert** — idle PUSD short, vault converts idle non-PUSD basket tokens via fee-exempt manager path. Still no peg risk.
3. **Queue** — residual is enqueued. PUSD+ is already burned, NAV is fixed at the burn block. Keeper fills on the next rebalance; anyone can call `fulfillQueueClaim(queueId)` once the vault has PUSD on hand.

If your call returns and `pusdReturned == 0`, the entire amount was queued — listen for the `QueueClaimFilled` event from the vault to know when it settles.

---

## Off-chain SDK — two write paths

Every PUSD/PUSD+ mutation goes through `pushChainClient.universal.sendTransaction(...)`. The **shape of the payload** depends on which wallet signed in.

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

## Mint PUSD+ (depositToPlus)

`depositToPlus(tokenIn, amount, recipient)` accepts **either** PUSD or any reserve token. User-facing API unchanged across v2 → v2.1.

> **v2.1 (2026-05-06)** — direct path (`tokenIn` = USDC.eth, USDT.eth, etc.) sends reserves **directly to the vault**, no intermediate PUSD mint. Wrap path (`tokenIn` = PUSD) basket-redeems caller's PUSD into vault inventory. Surplus haircut on the reserve still applies; wrap leg charges no fee. Same caller-visible behavior; the vault now accumulates diverse reserve inventory organically — better LP support.

**Path A — multicall, reserve → PUSD+ in one signature:**

```tsx
const VAULT = '0xb55a5B36d82D3B7f18Afe42F390De565080A49a1' as const;

const mintPlus = async () => {
  const h = PushChain.utils.helpers;
  const amount = h.parseUnits('100', 6);
  const recipient = pushChainClient.universal.account.address as `0x${string}`;

  const multicall = [
    { to: TOKEN, value: 0n, data: h.encodeTxData({ abi: APPROVE_ABI, functionName: 'approve', args: [MANAGER, amount] }) },
    { to: MANAGER, value: 0n, data: h.encodeTxData({ abi: DEPOSIT_TO_PLUS_ABI, functionName: 'depositToPlus', args: [TOKEN, amount, recipient] }) },
  ];

  await (await pushChainClient.universal.sendTransaction({
    to: ZERO, value: 0n, data: multicall,
  })).wait();
};
```

**Wrap path — already hold PUSD, want PUSD+:**

```tsx
const wrapPusd = async () => {
  const h = PushChain.utils.helpers;
  const amount = h.parseUnits('100', 6);
  const recipient = pushChainClient.universal.account.address as `0x${string}`;
  const PUSD = '0x488d080e16386379561a47A4955D22001d8A9D89' as const;

  const multicall = [
    { to: PUSD, value: 0n, data: h.encodeTxData({ abi: APPROVE_ABI, functionName: 'approve', args: [MANAGER, amount] }) },
    { to: MANAGER, value: 0n, data: h.encodeTxData({ abi: DEPOSIT_TO_PLUS_ABI, functionName: 'depositToPlus', args: [PUSD, amount, recipient] }) },
  ];

  await (await pushChainClient.universal.sendTransaction({
    to: ZERO, value: 0n, data: multicall,
  })).wait();
};
```

> The amount of PUSD+ minted is determined by **pre-deposit NAV**: `plusOut = pusdIn × supply / (totalAssets − pusdIn)`. Quote off-chain with `vault.previewMintPlus(pusdIn)`.

---

## Redeem PUSD+ (redeemFromPlus)

`redeemFromPlus(plusAmount, preferredAsset, allowBasket, recipient)` — burns PUSD+ from the caller, computes pusdOwed at current NAV, and either pays out instantly, queues for keeper fulfilment, or both. **PUSD+ approval is not required** — the vault burns `from = msg.sender` directly via the manager (manager holds `MANAGER_ROLE` on the vault).

```tsx
const redeemPlus = async () => {
  const h = PushChain.utils.helpers;
  const plusAmount = h.parseUnits('99', 6);
  const recipient = pushChainClient.universal.account.address as `0x${string}`;
  // Pass PUSD address as preferredAsset to receive PUSD directly (unwrap path).
  const PUSD = '0x488d080e16386379561a47A4955D22001d8A9D89' as const;

  await (await pushChainClient.universal.sendTransaction({
    to: MANAGER, value: 0n,
    data: h.encodeTxData({
      abi: REDEEM_FROM_PLUS_ABI,
      functionName: 'redeemFromPlus',
      args: [plusAmount, PUSD, true, recipient],
    }),
  })).wait();
};
```

If you want a reserve token back (e.g. USDC.eth), pass that as `preferredAsset`. The compose path runs the same preferred → basket cascade as `redeem`, but with **zero fees** (this is a protocol-internal compose, not a fresh user redeem). If the vault can't fulfil instantly, the residual is queued — your tx returns successfully but the user receives funds when `vault.fulfillQueueClaim(queueId)` runs.

---

## On-chain Solidity (calling the contracts from another contract)

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

    // Mutators -- v1 par-backed.
    function deposit(address token, uint256 amount, address recipient) external;
    function redeem(uint256 pusdAmount, address preferredAsset, bool allowBasket, address recipient) external;

    // Mutators -- v2 yield product.
    function depositToPlus(address tokenIn, uint256 amount, address recipient) external;
    function redeemFromPlus(uint256 plusAmount, address preferredAsset, bool allowBasket, address recipient) external;

    // Reads -- safe to call from any context.
    function baseFee() external view returns (uint256);
    function preferredFeeMin() external view returns (uint256);
    function preferredFeeMax() external view returns (uint256);
    function getSupportedTokensCount() external view returns (uint256);
    function getSupportedTokenAt(uint256 index) external view returns (address);
    function getTokenStatus(address token) external view returns (uint8);
    function getTokenInfo(address token) external view returns (TokenInfo memory);
    function getAccruedSurplus(address token) external view returns (uint256);
    function plusVault() external view returns (address);
}

interface IPUSDPlusVault {
    // ERC-20 surface (PUSD+ is a 6-decimal ERC-20)
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);

    // NAV-style reads
    function nav() external view returns (uint256);                    // 1e18 fixed-point
    function totalAssets() external view returns (uint256);            // 6-dec PUSD-equiv
    function previewMintPlus(uint256 pusdIn) external view returns (uint256);
    function previewBurnPlus(uint256 plusIn) external view returns (uint256);

    // Queue
    function fulfillQueueClaim(uint256 queueId) external;
    function nextQueueId() external view returns (uint256);
    function totalQueuedPusd() external view returns (uint256);
}
```

### Deposit — mint PUSD from another contract

```solidity
import {IPUSD, IPUSDManager} from "./IPUSD.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PUSDMinter {
    IPUSDManager public constant MANAGER =
        IPUSDManager(0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46);

    /// @notice Pull `amount` of `token` from caller, deposit into PUSDManager,
    ///         mint PUSD straight to `recipient`.
    function mintFor(address token, uint256 amount, address recipient) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        IERC20(token).approve(address(MANAGER), amount);
        MANAGER.deposit(token, amount, recipient);
    }
}
```

### Mint PUSD+ from another contract

```solidity
contract PUSDPlusMinter {
    IPUSDManager public constant MANAGER =
        IPUSDManager(0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46);

    function mintPlusFor(address token, uint256 amount, address recipient) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        IERC20(token).approve(address(MANAGER), amount);
        MANAGER.depositToPlus(token, amount, recipient);
    }
}
```

### Redeem PUSD+ from another contract

```solidity
contract PUSDPlusRedeemer {
    IPUSDManager   public constant MANAGER =
        IPUSDManager(0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46);
    IPUSDPlusVault public constant VAULT =
        IPUSDPlusVault(0xb55a5B36d82D3B7f18Afe42F390De565080A49a1);

    /// @notice Burn caller's PUSD+ and pay out into a reserve token. PUSD+
    ///         approval not required — vault burns msg.sender via the manager.
    function redeemFor(uint256 plusAmount, address preferredAsset, address recipient) external {
        // forward msg.sender semantics: this contract is the caller into the manager,
        // so it must hold the PUSD+ that gets burned. Pull first.
        IERC20(address(VAULT)).transferFrom(msg.sender, address(this), plusAmount);
        MANAGER.redeemFromPlus(plusAmount, preferredAsset, true, recipient);
    }
}
```

### Read — quote and inspect protocol state

```solidity
contract PUSDReader {
    IPUSDManager   public constant MANAGER =
        IPUSDManager(0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46);
    IPUSDPlusVault public constant VAULT =
        IPUSDPlusVault(0xb55a5B36d82D3B7f18Afe42F390De565080A49a1);

    function quoteMint(address token, uint256 amount)
        external view returns (uint256 expectedPUSD)
    {
        IPUSDManager.TokenInfo memory info = MANAGER.getTokenInfo(token);
        require(info.exists, "PUSDReader: unsupported token");
        uint256 baseFeeBps = MANAGER.baseFee();
        expectedPUSD = amount - (amount * baseFeeBps) / 10_000;
    }

    function quoteMintPlus(uint256 pusdIn) external view returns (uint256) {
        return VAULT.previewMintPlus(pusdIn);
    }

    function plusNav() external view returns (uint256) { return VAULT.nav(); }
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

const DEPOSIT_TO_PLUS_ABI = [{
  type: 'function', name: 'depositToPlus', stateMutability: 'nonpayable',
  inputs: [
    { name: 'tokenIn',   type: 'address' },
    { name: 'amount',    type: 'uint256' },
    { name: 'recipient', type: 'address' },
  ],
  outputs: [],
}] as const;

const REDEEM_FROM_PLUS_ABI = [{
  type: 'function', name: 'redeemFromPlus', stateMutability: 'nonpayable',
  inputs: [
    { name: 'plusAmount',     type: 'uint256' },
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
| Adding an approve before redeem / redeemFromPlus | Neither needs it — `PUSDManager` burns `msg.sender` directly via `BURNER_ROLE`/vault-`MANAGER_ROLE` |
| `parseUnits(value, 18)`                          | PUSD, PUSD+, and every reserve use 6 decimals — `parseUnits(value, 6)`               |
| `recipient = address(0)`                         | Every entrypoint reverts on zero address                                             |
| Treating PUSD+ as ERC-4626                       | PUSD+ is a custom ERC-20 with `nav() / totalAssets() / previewMint/Burn`, no `convertToShares` |
| Expecting `redeemFromPlus` to always pay instantly | If the vault is short on PUSD, residual is queued; `pusdReturned == 0` means fully queued |
| Calling `mintPlus` / `burnPlus` / `depositForVault` from app code | Vault-only — only PUSDManager (with MANAGER_ROLE) calls into the vault, and only the vault calls back into `depositForVault` |
| `npm install @pushchain/core` in a UI Kit app    | `@pushchain/core` is bundled in `@pushchain/ui-kit` — use `usePushChain()` instead   |
| Path-B mint as a single multicall                | Native Push EOAs have no multicall; mint is **two sequential** transactions          |

---

## Quick reference

| Operation         | Contract       | Function                                                  |
| ----------------- | -------------- | --------------------------------------------------------- |
| Mint PUSD         | PUSDManager    | `deposit(token, amount, recipient)`                       |
| Redeem PUSD       | PUSDManager    | `redeem(pusdAmount, preferredAsset, allowBasket, recipient)` |
| Mint PUSD+        | PUSDManager    | `depositToPlus(tokenIn, amount, recipient)`               |
| Redeem PUSD+      | PUSDManager    | `redeemFromPlus(plusAmount, preferredAsset, allowBasket, recipient)` |
| Settle queued PUSD+ redeem | PUSDPlusVault | `fulfillQueueClaim(queueId)`                          |
| PUSD balance      | PUSD           | `balanceOf(address)`                                      |
| PUSD+ balance     | PUSDPlusVault  | `balanceOf(address)`                                      |
| PUSD+ NAV (1e18)  | PUSDPlusVault  | `nav()`                                                   |
| Quote mint PUSD+  | PUSDPlusVault  | `previewMintPlus(pusdIn)`                                 |
| Quote burn PUSD+  | PUSDPlusVault  | `previewBurnPlus(plusIn)`                                 |
| Token info        | PUSDManager    | `getTokenInfo(token)`                                     |
| Fee config        | PUSDManager    | `baseFee()`, `preferredFeeMin()`, `preferredFeeMax()`     |
| Reserve balance   | reserve token  | `balanceOf(PUSDManager)`                                  |
| Accrued surplus   | PUSDManager    | `getAccruedSurplus(token)`                                |

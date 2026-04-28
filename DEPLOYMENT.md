# PUSD v2 — Deployment Runbook

> **Status:** v1 is sunsetted (see `contracts/deployed.txt` for the address freeze).
> **Live addresses:** filled into `contracts/deployed.txt` after each fresh deploy. This
> document is the *procedure*, not the address ledger.

## 0. Architecture overview

PUSD v2 introduces four contracts on Push Chain Donut testnet (chain id `42101`):

| Contract        | Role                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `PUSD`          | ERC-20 stablecoin. Mint/burn restricted to `PUSDManager`.            |
| `PUSDManager`   | Reserve accounting. `parReserve` / `yieldShareReserve` slicing, plus haircut/fee buckets. Plain mint+redeem here. |
| `PUSDPlus`      | ERC-4626 yield wrapper. Users deposit a stable → mint shares → claim yield. |
| `PUSDLiquidity` | Uniswap V3 LP engine. Holds idle stable, opens concentrated positions, tracks deployed principal so NAV is yield-only. |

The cap on Liquidity deployment is `maxDeployableBps` of `PUSDPlus.totalAssets`. Launch
default is `3000` (30%); the absolute hard ceiling is `5000` (50%).

## 1. Pre-deploy checklist

```
contracts/
  forge install            # OZ contracts + UniV3 mocks/peripherals
  forge build              # solc 0.8.28, via_ir
  forge test --summary     # must show 106/106 across 6 suites
```

Everything must be green. The invariant suite at `test/invariants/Invariants.t.sol` runs
4,096 random sequences per invariant and is non-negotiable for launch.

## 2. Environment

Copy `contracts/.env.example` → `contracts/.env` and fill:

```
PRIVATE_KEY=...                # deployer EOA
ADMIN_ADDRESS=...              # final governance owner (can equal deployer for testnet)
DEPLOYER_ADDRESS=...           # echoes the deployer pubkey, used by VerifyRoles
FEE_RECIPIENT=...              # PUSDPlus fee bucket — usually a treasury multisig

RPC_URL=https://evm.donut.rpc.push.org/
CHAIN_ID=42101
```

Uniswap V3 Donut addresses (already filled in `.env.example`):

```
UNIV3_FACTORY=0x81b8Bca02580C7d6b636051FDb7baAC436bFb454
UNIV3_NPM=0xf9b3ac66aed14A2C7D9AA7696841aB6B27a6231e
UNIV3_ROUTER=0x5D548bB9E305AAe0d6dc6e6fdc3ab419f6aC0037
```

## 3. Deploy

```bash
cd contracts
forge script script/DeployAndConfigure.s.sol \
  --rpc-url   $RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --slow
```

`DeployAndConfigure.s.sol` performs a **fresh** v2 deploy in a single broadcast:

1. Deploys `PUSD`, `PUSDManager`, `PUSDPlus`, `PUSDLiquidity` behind ERC-1967 proxies.
2. Wires `MINTER_ROLE` / `BURNER_ROLE` on PUSD → PUSDManager.
3. Wires `setPUSDPlus` and `setPUSDLiquidity` on PUSDManager.
4. Wires `setPUSDLiquidity` on PUSDPlus, `setPUSDPlus` on PUSDLiquidity.
5. Grants `REBALANCER_ROLE` to deployer + final admin (operational from t=0).
6. Sets the launch tariff: `baseFeeBps = 5` (0.05%), `vaultHaircutBps = 5` (0.05%).
7. Renounces deployer's `DEFAULT_ADMIN_ROLE` once the final admin is wired (skipped when admin == deployer).

Expect the broadcast log to print four `created → 0x…` lines; copy them into
`contracts/deployed.txt` under a fresh `## Deployment N — v2 fresh deploy` block.

## 4. Add supported tokens

```bash
forge script script/AddSupportedTokens.s.sol \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

This script registers the canonical Donut stable set:

| Symbol     | Origin chain        |
| ---------- | ------------------- |
| USDC.eth   | Ethereum Sepolia    |
| USDT.eth   | Ethereum Sepolia    |
| USDC.sol   | Solana Devnet       |
| USDT.sol   | Solana Devnet       |
| USDC.base  | Base Sepolia        |
| USDT.base  | Base Sepolia        |
| USDC.arb   | Arbitrum Sepolia    |
| USDT.arb   | Arbitrum Sepolia    |
| USDT.bnb   | BNB Testnet         |

Token addresses are pinned in the script; if Push add cross-chain rails for additional
tokens, append to the script's `_pairs()` array.

## 5. Spin up an LP pool

For each pair you want to LP, run `CreatePool.s.sol` once (idempotent — re-uses an
existing pool if `factory.getPool(...)` is non-zero) then `AddPool.s.sol` to register
it with `PUSDLiquidity`:

```bash
TOKEN_A=0x...  TOKEN_B=0x...  POOL_FEE=100  \
forge script script/CreatePool.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast

POOL_ADDRESS=0x...  \
forge script script/AddPool.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
```

Then push capital from PUSDManager into Liquidity and open the initial concentrated
position:

```bash
POOL=0x... AMOUNT_A=... AMOUNT_B=... TICK_LOWER=-50 TICK_UPPER=50 \
forge script script/OpenInitialPosition.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
```

Reminder: total Liquidity holdings (idle + position-implied) must remain ≤
`maxDeployableBps` of PUSDPlus.totalAssets at the moment of the push. The deploy script
sets the launch cap to `3000` (30%).

## 6. Verify

```bash
forge script script/VerifyRoles.s.sol --rpc-url $RPC_URL
```

Asserts the post-deploy role matrix:

- `PUSD`: `MINTER_ROLE` + `BURNER_ROLE` held only by `PUSDManager`.
- `PUSDManager`: `VAULT_ROLE` held only by `PUSDPlus`.
- `PUSDLiquidity`: `VAULT_ROLE` held only by `PUSDPlus`; `REBALANCER_ROLE` held by admin.
- `DEFAULT_ADMIN_ROLE` held by admin on every contract; not held by deployer.

## 7. Frontend

Frontend lives in `app/` (Vite + React + ethers + `@pushchain/ui-kit`).

```
app/.env.local

VITE_PUSD_ADDRESS=0x...
VITE_PUSD_MANAGER_ADDRESS=0x...
VITE_PUSD_PLUS_ADDRESS=0x...
VITE_PUSD_LIQUIDITY_ADDRESS=0x...
VITE_CHAIN_ID=42101
VITE_RPC_URL=https://evm.donut.rpc.push.org/
```

Then:

```bash
cd app
yarn install
yarn dev
```

Routes:

| Path                | Component         | Purpose                                          |
| ------------------- | ----------------- | ------------------------------------------------ |
| `/`                 | `HomePage`        | Editorial landing                                |
| `/convert/mint`     | `ConvertPanel`    | Plain mint (1:1, base fee on redeem)             |
| `/convert/redeem`   | `ConvertPanel`    | Plain redeem with optional cross-chain payout    |
| `/save`             | `SavePanel`       | PUSD+ vault: deposit-stable / redeem-to-stable   |
| `/reserves`         | `ReservesDetailPage` | Per-token reserve health                       |
| `/history`          | `HistoryPage`     | User activity log                                |
| `/docs`             | `DocsPage`        | Designed index of `docs/`                        |

The plain-mint flow is the `ConvertPanel` component — there is **no `MintTab.tsx`** in
the v2 codebase (any docs that mention it are stale and have been superseded by this
runbook).

## 8. Post-deploy — record the addresses

Append a fresh block to `contracts/deployed.txt`:

```
## Deployment N — v2 fresh deploy
Date: YYYY-MM-DD
Chain: Push Chain Testnet (42101)
Admin:    0x...
Deployer: 0x...

Implementation / Proxy:
  PUSD impl:           0x...
  PUSD proxy:          0x...   (← VITE_PUSD_ADDRESS)
  PUSDManager impl:    0x...
  PUSDManager proxy:   0x...   (← VITE_PUSD_MANAGER_ADDRESS)
  PUSDPlus impl:       0x...
  PUSDPlus proxy:      0x...   (← VITE_PUSD_PLUS_ADDRESS)
  PUSDLiquidity impl:  0x...
  PUSDLiquidity proxy: 0x...   (← VITE_PUSD_LIQUIDITY_ADDRESS)

UniV3 Pools registered:
  USDC.eth/USDC.sol   0x...
  ...
```

That block becomes the public source of truth — frontend env, agent skills, and llms.txt
all read from there.

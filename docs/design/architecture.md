# Architecture — Shipped V2.1 (2026-05-06)

This is the current architecture reference (deposit-side amended by
[ADR 0006](decisions/0006-direct-vault-deposit.md) on 2026-05-06; redemption-side
fee-exempt-flag isolation from [ADR 0004](decisions/0004-shipped-v2-architecture.md)
preserved). For the scrapped 4-contract plan, see ADR 0004 for the narrative
diff against ADR 0003 — the original prose is in git history only.

## Components

```
                  ┌──────────────────────┐
   user           │   PUSDManager (UUPS) │   role-gated reserve orchestrator
  ─ deposit ─────►│   v2 in-place upgrade│
  ─ redeem  ─────►│                      │   storage append-only (__gap_v2[48])
  ─ depositToPlus►│                      │
  ─ redeemFromPlus│                      │
                  └──┬─────────────┬─────┘
                     │             │
              MINTER │             │ MANAGER_ROLE
              BURNER │             │
                     ▼             ▼
              ┌──────────┐   ┌──────────────────────────┐
              │  PUSD    │   │  PUSDPlusVault (UUPS)    │   custom 6-dec ERC-20
              │  (UUPS)  │   │  ─ mintPlus / burnPlus   │   NAV-per-share
              │  ERC-20  │   │  ─ rebalance (keeper)    │
              └──────────┘   │  ─ openPool/closePool    │
                             │  ─ fulfillQueueClaim     │
                             └────────────┬─────────────┘
                                          │ haircut on harvest
                                          ▼
                                  ┌──────────────────┐
                                  │  InsuranceFund   │   passive sidecar
                                  │  (UUPS)          │   balanceOf is truth
                                  └──────────────────┘
```

## Two products, one entrypoint

| Product | Mint                                | Redeem                              | Token shape                   |
| ------- | ----------------------------------- | ----------------------------------- | ----------------------------- |
| PUSD    | `PUSDManager.deposit`               | `PUSDManager.redeem`                | Plain ERC-20, 6 dec, 1:1 backed |
| PUSD+   | `PUSDManager.depositToPlus`         | `PUSDManager.redeemFromPlus`        | Custom ERC-20, 6 dec, NAV-per-share |

Users interact with `PUSDManager` for both products. The vault is exposed
publicly only for reads (`nav`, `previewMintPlus`, etc.) and for the
keeper-callable `fulfillQueueClaim` when a queued redeem is settled.

## Contract responsibilities

### PUSD.sol
Plain UUPS ERC-20, 6 decimals. Holds `MINTER_ROLE` / `BURNER_ROLE` granted
to PUSDManager only. Does not know about reserves, fees, or the yield layer.
Unchanged from v1.

### PUSDManager.sol (v2.1)
- Reserve token registry (`supportedTokens`, `tokenList`, status lifecycle)
- Fee config (baseFee ≤ 100, preferredFeeMin/Max ≤ 200, surplusHaircutBps ≤ 1000)
- v1 entrypoints: `deposit`, `redeem`
- v2 entrypoints: `depositToPlus`, `redeemFromPlus`, `setPlusVault`, `setFeeExempt`, `depositForVault`
- **v2.1 (ADR 0006): `depositToPlus` rewrite — direct path forwards reserves to vault (no PUSD minted); wrap path basket-redeems through manager**
- Defensive `inBasket` check on direct path to prevent silent stranding of forwarded reserves
- Two-key gate on `depositForVault` — `msg.sender == plusVault && feeExempt[plusVault]`. Bypasses `nonReentrant` and surplus haircut by design (necessary for vault to convert idle reserves without manager-lock deadlock)
- Surplus accounting (`accruedFees`, `accruedHaircut`) and treasury sweeps
- Storage append-only — `__gap_v2[48]` reserves runway; v2.1 is function-body-only

### PUSDPlusVault.sol (v2.1)
- Custom 6-decimal ERC-20 (PUSD+); NAV math via `nav() / totalAssets() / previewMintPlus / previewBurnPlus`
- 5 roles: `MANAGER_ROLE` (manager only), `KEEPER_ROLE`, `POOL_ADMIN_ROLE`, `VAULT_ADMIN_ROLE`, `GUARDIAN_ROLE`
- Hard caps revert in setter bodies — `MAX_HAIRCUT_BPS=500`, `MAX_DEPLOYMENT_CAP_BPS=8500`, `MIN_UNWIND_CAP_BPS=100`, `MAX_UNWIND_CAP_BPS=5000`, `MAX_REBALANCE_COOLDOWN=24h`
- Three-tier redemption fulfilment: idle PUSD → convert basket → enqueue
- **v2.1: `_convertIdleReservesToPusd(target, preferred)` drains the user's preferred asset first; `burnPlus` and `fulfillQueueClaim` thread `preferredAsset` through**
- **v2.1: `rebalance()` and `rebalanceBatch()` are permissionless-with-cooldown — KEEPER bypasses, public callers must wait `publicRebalanceCooldown` (default 1h, max 24h)**
- Burn-and-fill queue: PUSD+ burned at queue time, NAV fixed at burn block, residual paid later by `fulfillQueueClaim`
- Inlines Uniswap V3 LP engine (open / top-up / close / harvest); vendors `libraries/V3Math.sol` (mulDiv, sqrtRatio, getAmounts) as public lib functions to fit under EIP-170
- Pause asymmetry: `GUARDIAN_ROLE` pauses; only `DEFAULT_ADMIN_ROLE` (timelock) unpauses
- Storage append-only — v2.1 consumes 1 slot from `__gap[40] → __gap[39]` for `(lastRebalanceAt, publicRebalanceCooldown)` packed
- `via_ir = true` + `evm_version = "shanghai"` in foundry.toml are required for deploy

### InsuranceFund.sol
- Passive — receives haircut transferred by `PUSDPlusVault._haircut`
- `balanceOf(token)` is source-of-truth; `cumulativeDeposited` is informational
- `notifyDeposit` is wrapped in `try/catch` at the vault — paused IF cannot brick rebalance
- `withdraw` is `VAULT_ADMIN_ROLE` only; design-doc review marks (1% TVL → fee tier 2; 5% TVL → haircut review) gate when governance pulls

## Key flows

### Mint PUSD
```
user → manager.deposit(token, amount, recipient)
       ├─ pull token from msg.sender
       ├─ apply surplusHaircutBps (cap 1000 bps)
       ├─ accruedHaircut[token] += haircutAmount
       ├─ pusd.mint(recipient, normalize(netAmount))
       └─ event Deposited
```

### Redeem PUSD
```
user → manager.redeem(pusdAmount, preferredAsset, allowBasket, recipient)
       ├─ try preferred branch     (baseFee + preferredFee)
       ├─ try basket branch        (baseFee only)
       └─ try emergency branch     (proportional drain on EMERGENCY_REDEEM tokens)
       PUSD.burn(msg.sender, pusdAmount) happens first or in same call frame.
```

### Mint PUSD+ (v2.1)
```
user → manager.depositToPlus(tokenIn, amount, recipient)
       ├─ direct path (tokenIn != PUSD):
       │     pull token to manager → apply haircut → forward NET to vault
       │     vault.mintPlus(pusdValueOfNet, recipient)
       │     [no PUSD minted; pusd.totalSupply unchanged]
       └─ wrap path (tokenIn == PUSD):
             _executeBasketRedeemFrom(amount, plusVault, msg.sender, fee=0)
             [burns PUSD from caller, pays proportional basket reserves to vault]
             vault.mintPlus(amount, recipient)
       Both paths require tokenIn ∈ vault.basket (defensive check on direct).
       PUSD+ minted at pre-deposit NAV — `(pusdIn × supply) / (totalAssets − pusdIn)`.
```

### Redeem PUSD+ (three-tier, v2.1 preferred-first)
```
user → manager.redeemFromPlus(plusAmount, preferredAsset, allowBasket, recipient)
       └─ vault.burnPlus(plusAmount, msg.sender, manager, preferredAsset, allowBasket)
              ├─ vault burns PUSD+ from msg.sender at current NAV
              ├─ tier 1: idle PUSD ≥ pusdOwed → transfer PUSD to manager (rare under v2.1)
              ├─ tier 2: idle short → _convertIdleReservesToPusd(target, preferredAsset)
              │           drains preferredAsset first, then basket order, via manager.depositForVault
              └─ tier 3: residual queued (`from = msg.sender`, NAV fixed at burn block)
       └─ if pusdReturned > 0:
              ├─ preferredAsset == pusd: forward PUSD to recipient
              └─ else: _payoutToUser (preferred → basket → emergency, fees=0)

Later: anyone calls vault.fulfillQueueClaim(queueId) once vault has PUSD on hand.
       Queue uses the entry's preferredAsset for tier-2 conversion.
```

### Daily rebalance (v2.1 permissionless-with-cooldown)
```
KEEPER (no cooldown) OR anyone (after publicRebalanceCooldown elapsed)
  → vault.rebalance() / vault.rebalanceBatch(start, count)
         For each owned positionId:
           ├─ npm.collect(...) into vault
           ├─ emit Harvested
           └─ for each leg: _haircut(token, amount) → IF
                            (try/catch on notifyDeposit; balances move regardless)
         lastRebalanceAt = block.timestamp
         emit Rebalanced
```

## Trust boundaries

| Boundary                                  | Trust level                                                |
| ----------------------------------------- | ---------------------------------------------------------- |
| User → PUSDManager                        | Untrusted; nonReentrant + zero-address + role-gated config |
| PUSDManager → PUSDPlusVault               | Trusted via `MANAGER_ROLE`; `mintPlus / burnPlus` only     |
| PUSDPlusVault → PUSDManager (`depositForVault`) | Trusted via two-key gate; bypasses nonReentrant deliberately |
| PUSDPlusVault → InsuranceFund             | Trusted-but-fail-soft; notifyDeposit wrapped in try/catch  |
| Keeper bot → PUSDPlusVault                | Operational role (`KEEPER_ROLE`); no economic admin powers |
| POOL_ADMIN multisig → PUSDPlusVault       | Pool ops only — open/close, basket add/remove, fee tiers   |
| VAULT_ADMIN multisig → PUSDPlusVault      | Knob setters; bounded by hard caps                         |
| GUARDIAN multisig → vault/IF              | Pause-only; cannot unpause                                 |
| DEFAULT_ADMIN timelock (mainnet target; testnet today: admin EOA) | Upgrade authority + role rotation + unpause                |

> **Governance posture today (Deployment 4 testnet)**: DEFAULT_ADMIN, UPGRADER, and the multisig roles are all currently held by the admin EOA `0xA1c1AF949C5752E9714cFE54f444cE80f078069A`. No `TimelockController` is deployed. Upgrades execute on a single signature. The multisig/timelock language above describes the **mainnet target** per [ADR 0002](decisions/0002-access-control-model.md) — bringup happens before mainnet launch.

## Storage discipline

- All four contracts use UUPS proxies with explicit `__gap` arrays.
- PUSDManager v2 added `plusVault` + `feeExempt` and reserves `__gap_v2[48]`. New v3+ state must come after that gap.
- PUSDPlusVault originally had `__gap[40]`; v2.1 consumed 1 slot for `(lastRebalanceAt, publicRebalanceCooldown)` packed → `__gap[39]`. InsuranceFund has `__gap[40]` unchanged.
- v2.1 was **function-body-only on PUSDManager** — storage layout below `__gap_v2` byte-identical to v2.
- Verification: `forge inspect <Contract> storage-layout` before and after every upgrade.

## Deployed addresses (Donut Testnet, chain 42101)

| Contract       | Proxy                                        |
| -------------- | -------------------------------------------- |
| PUSD           | `0x488d080e16386379561a47A4955D22001d8A9D89` |
| PUSDManager    | `0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46` |
| PUSDPlusVault  | `0xb55a5B36d82D3B7f18Afe42F390De565080A49a1` |
| InsuranceFund  | `0xFF7E741621ad5d39015759E3d606A631Fa319a62` |

Source of truth: [`contracts/deployed.txt`](../../contracts/deployed.txt).

## Related docs

- [`docs/research/pusdplusvault.md`](../research/pusdplusvault.md) — full PUSD+ mechanics + design rationale (encrypted at rest)
- [`docs/design/decisions/0004-shipped-v2-architecture.md`](decisions/0004-shipped-v2-architecture.md) — ADR superseding 0003
- [`docs/research/`](../research/) — internal contributor context (encrypted at rest). Cross-cutting in [`agents.md`](../research/agents.md); per-contract files (`pusd.md` / `pusdmanager.md` / `pusdplusvault.md` / `insurancefund.md`); also `frontend.md` (React app) and `backend.md` (keeper / indexer design)
- [`app/public/agents/skill/push-pusd/SKILL.md`](../../app/public/agents/skill/push-pusd/SKILL.md) — integrator-facing guide

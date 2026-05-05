# Architecture — Shipped V2 (2026-05-04)

This is the current architecture reference. For the scrapped 4-contract
plan, see [ADR 0004](decisions/0004-shipped-v2-architecture.md) for the
narrative diff against ADR 0003 — the original prose is in git history
only.

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

### PUSDManager.sol (v2)
- Reserve token registry (`supportedTokens`, `tokenList`, status lifecycle)
- Fee config (baseFee ≤ 100, preferredFeeMin/Max ≤ 200, surplusHaircutBps ≤ 1000)
- v1 entrypoints: `deposit`, `redeem`
- v2 entrypoints: `depositToPlus`, `redeemFromPlus`, `setPlusVault`, `setFeeExempt`, `depositForVault`
- Two-key gate on `depositForVault` — `msg.sender == plusVault && feeExempt[plusVault]`. Bypasses `nonReentrant` and surplus haircut by design (necessary for vault to convert idle reserves without manager-lock deadlock)
- Surplus accounting (`accruedFees`, `accruedHaircut`) and treasury sweeps
- Storage append-only — `__gap_v2[48]` reserves runway

### PUSDPlusVault.sol
- Custom 6-decimal ERC-20 (PUSD+); NAV math via `nav() / totalAssets() / previewMintPlus / previewBurnPlus`
- 5 roles: `MANAGER_ROLE` (manager only), `KEEPER_ROLE`, `POOL_ADMIN_ROLE`, `VAULT_ADMIN_ROLE`, `GUARDIAN_ROLE`
- Hard caps revert in setter bodies — `MAX_HAIRCUT_BPS=500`, `MAX_DEPLOYMENT_CAP_BPS=8500`, `MIN_UNWIND_CAP_BPS=100`, `MAX_UNWIND_CAP_BPS=5000`
- Three-tier redemption fulfilment: idle PUSD → convert basket → enqueue
- Burn-and-fill queue: PUSD+ burned at queue time, NAV fixed at burn block, residual paid later by `fulfillQueueClaim`
- Inlines Uniswap V3 LP engine (open / top-up / close / harvest); vendors `libraries/V3Math.sol` (mulDiv, sqrtRatio, getAmounts) as public lib functions to fit under EIP-170
- Pause asymmetry: `GUARDIAN_ROLE` pauses; only `DEFAULT_ADMIN_ROLE` (timelock) unpauses
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

### Mint PUSD+
```
user → manager.depositToPlus(tokenIn, amount, recipient)
       ├─ if tokenIn == pusd: transfer PUSD to vault, vault.mintPlus(amount, recipient)
       └─ else: pull token, apply haircut, pusd.mint(plusVault, netAmount), vault.mintPlus(netAmount, recipient)
       Wrap leg charges no fee.
       PUSD+ minted at pre-deposit NAV — `(pusdIn × supply) / (totalAssets − pusdIn)`.
```

### Redeem PUSD+ (three-tier)
```
user → manager.redeemFromPlus(plusAmount, preferredAsset, allowBasket, recipient)
       └─ vault.burnPlus(plusAmount, msg.sender, manager, preferredAsset, allowBasket)
              ├─ vault burns PUSD+ from msg.sender at current NAV
              ├─ tier 1: idle PUSD ≥ pusdOwed → transfer PUSD to manager
              ├─ tier 2: idle short → _convertIdleReservesToPusd via manager.depositForVault
              └─ tier 3: residual queued (`from = msg.sender`, NAV fixed at burn block)
       └─ if pusdReturned > 0:
              ├─ preferredAsset == pusd: forward PUSD to recipient
              └─ else: _payoutToUser (preferred → basket → emergency, fees=0)

Later: anyone calls vault.fulfillQueueClaim(queueId) once vault has PUSD on hand.
```

### Daily keeper rebalance
```
keeper → vault.rebalance()
         For each owned positionId:
           ├─ npm.collect(...) into vault
           ├─ emit Harvested
           └─ for each leg: _haircut(token, amount) → IF
                            (try/catch on notifyDeposit; balances move regardless)
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
| DEFAULT_ADMIN timelock                    | Upgrade authority + role rotation + unpause                |

## Storage discipline

- All four contracts use UUPS proxies with explicit `__gap` arrays.
- PUSDManager v2 added `plusVault` + `feeExempt` and reserves `__gap_v2[48]`. New v3+ state must come after that gap.
- PUSDPlusVault and InsuranceFund have `__gap[40]` each.
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

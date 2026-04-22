# v2 Contracts — Engineering Plan

Blueprint for implementing the four-contract PUSD v2 architecture defined by [ADR 0003](decisions/0003-product-architecture.md). This document is the engineering brief — no code here, just the shape of the work.

> **Scope.** Implementation-ready spec for `PUSD.sol` (carry-over), `PUSDManager.sol` (v2 extension), `PUSDPlus.sol` (new), `PUSDLiquidity.sol` (new), launch adapters, deploy scripts, and the test plan.
>
> **Non-goals.** ERC-7540 async queue (ADR 0005 follow-up). Cross-chain shares (future work). Governance token (not part of PUSD).

---

## 1. File tree

```
contracts/
├── src/
│   ├── PUSD.sol                    CARRY-OVER from v1. Unchanged.
│   ├── PUSDManager.sol             v2 EXTENSION. Two-slice reserve, mintForVault/redeemForVault.
│   ├── PUSDPlus.sol                NEW. ERC-4626 wrapper over PUSD.
│   ├── PUSDLiquidity.sol           NEW. Strategy engine owned by PUSD+.
│   │
│   ├── adapters/
│   │   ├── AaveV3SupplyAdapter.sol NEW. Supplies USDC/USDT to Aave v3.
│   │   ├── Curve3poolLPAdapter.sol NEW. LPs into Curve 3pool, harvests CRV.
│   │   ├── MorphoSupplyAdapter.sol NEW. Supplies to a whitelisted Morpho market.
│   │   └── BaseAdapter.sol         NEW. Shared scaffolding: role gate, decimal helpers, SafeERC20.
│   │
│   ├── wrappers/
│   │   ├── ISDAIAdapter.sol        NEW. Wrap/unwrap DAI <-> sDAI for PUSDManager rate-bearing slice.
│   │   ├── ISUSDSAdapter.sol       NEW. Wrap/unwrap USDS <-> sUSDS.
│   │   └── IERC4626Adapter.sol     NEW. Generic ERC-4626 wrap adapter (reused above).
│   │
│   ├── interfaces/
│   │   ├── IPUSD.sol               CARRY-OVER.
│   │   ├── IPUSDManager.sol        v2 EXTENSION: mintForVault, redeemForVault, slice views.
│   │   ├── IPUSDPlus.sol           NEW.
│   │   ├── IPUSDLiquidity.sol      NEW.
│   │   ├── IStrategyAdapter.sol    NEW.
│   │   └── IRateBearingAdapter.sol NEW.
│   │
│   └── libs/
│       └── DecimalLib.sol          NEW (optional extract of v1 inline helpers).
│
├── script/
│   ├── DeployPUSD.s.sol            CARRY-OVER. Reused for PUSD deploy only.
│   ├── DeployManager.s.sol         NEW (split from v1 DeployAndConfigure).
│   ├── DeployPlus.s.sol            NEW.
│   ├── DeployLiquidity.s.sol       NEW.
│   ├── DeployAndConfigure.s.sol    REWRITE. Orchestrates all four, grants roles, rotates UPGRADER_ROLE to 48h timelock.
│   ├── AddSupportedTokens.s.sol    EXTEND. Configures rateBearingWrapper per token.
│   ├── AddStrategies.s.sol         NEW. Adds launch adapters with per-strategy sub-caps.
│   └── VerifyRoles.s.sol           NEW. Assert the full post-deploy role matrix.
│
├── test/
│   ├── unit/
│   │   ├── PUSD.t.sol              CARRY-OVER.
│   │   ├── PUSDManager.v2.t.sol    REWRITE. Covers plain + vault paths, slice accounting.
│   │   ├── PUSDPlus.t.sol          NEW. ERC-4626 compliance + HWM fee model.
│   │   ├── PUSDLiquidity.t.sol     NEW. Cap enforcement, adapter lifecycle.
│   │   └── adapters/*.t.sol        NEW. Per-adapter unit tests.
│   │
│   ├── integration/
│   │   ├── FourContractFlow.t.sol  NEW. End-to-end: user → Plus → Manager → Liquidity.
│   │   ├── PlainRedeemUnderStress.t.sol  NEW. Basket + emergency paths, parReserve only.
│   │   └── VaultRedeemWithUnwind.t.sol   NEW. PUSD+ redeem when yieldShareReserve < need.
│   │
│   ├── invariant/
│   │   ├── Handler.sol             Full-call-surface handler over all four contracts.
│   │   ├── invariants.t.sol        I-01, I-01b, I-02, I-05, I-07, I-10, I-11, I-12.
│   │   └── ghostBook.sol           Cumulative mint/burn/deploy/harvest trackers.
│   │
│   └── fork/
│       ├── AaveV3.fork.t.sol       NEW. Mainnet fork test of Aave adapter.
│       ├── Curve3pool.fork.t.sol   NEW.
│       └── Morpho.fork.t.sol       NEW.
│
├── foundry.toml                    UPDATE. Enable invariant depth 128 / runs 2048.
├── remappings.txt                  UPDATE. Add @aave, @curve, @morpho.
└── deployed.txt                    UPDATE. Add PUSDPlus, PUSDLiquidity, adapter addresses.
```

---

## 2. Contract-by-contract plan

### 2.1 PUSD.sol — carry-over

No changes. Already audited; already deployed-shape stable. Re-audit only if the upgrade mechanics change.

### 2.2 PUSDManager.sol — v2 extension

**New state (append-only):**
```solidity
mapping(address => uint256) public parReserve;
mapping(address => uint256) public yieldShareReserve;
address public pusdPlus;          // VAULT_ROLE holder
uint16  public vaultHaircutBps;   // default 0, max 500
// TokenInfo gains rateBearingWrapper + unwrapAdapter
```

**New entrypoints:**
```solidity
function mintForVault(address token, uint256 amount, address recipient)
    external onlyRole(VAULT_ROLE) nonReentrant returns (uint256 pusdMinted);

function redeemForVault(uint256 pusdAmount, address preferredAsset, address recipient)
    external onlyRole(VAULT_ROLE) nonReentrant returns (uint256 tokenOut);

function setPUSDPlus(address newVault) external onlyRole(ADMIN_ROLE);
function setVaultHaircutBps(uint16 bps) external onlyRole(ADMIN_ROLE);
function setRateBearingWrapper(address base, address wrapper, address adapter) external onlyRole(ADMIN_ROLE);
function rebalanceReserveToRateBearing(address base, uint256 amount) external onlyRole(ADMIN_ROLE) nonReentrant;
function rebalanceRateBearingToReserve(address base, uint256 amount) external onlyRole(ADMIN_ROLE) nonReentrant;
```

**Modified internals:**
- `_executeRedeem` gains a `fromSlice` parameter (`PAR` or `YIELD`).
- `_executeBasketRedeem` and `_executeEmergencyRedeem` operate on `parReserve` only (unchanged behaviour from a plain-PUSD holder's perspective).
- `_getAvailableLiquidity(token)` renamed to `_availableForParRedeem(token)`; a new `_availableForVaultRedeem(token)` consults `yieldShareReserve` plus `PUSDLiquidity.idleBalance`.
- All deposit paths also credit either `parReserve` (plain) or `yieldShareReserve` (vault).
- `rebalance()` now takes an additional `slice` parameter: it rebalances **within** a single slice only. Cross-slice value transfer is a separate function, `reclassify(token, fromSlice, toSlice, amount)`, `onlyRole(ADMIN_ROLE)`.

**Storage safety:**
- All v2 slots appended after the existing v1 slots.
- Pre-flight: `forge inspect PUSDManager storageLayout > layout.before.json` before any upgrade; diff after.
- CI check: storage layout hash captured per release tag.

### 2.3 PUSDPlus.sol — new

**Shape:** `ERC4626Upgradeable` + `AccessControlUpgradeable` + `PausableUpgradeable` + `UUPSUpgradeable`.

**Key design choices:**
- Underlying asset is `PUSD` (6 decimals). Shares are 18 decimals (ERC-4626 convention).
- Virtual-shares protection via `_decimalsOffset() = 6` to kill the inflation attack.
- `totalAssets()` sums the vault's direct PUSD balance + `PUSDLiquidity.netAssetsInPUSD()`.
- HWM-based performance fee (default 10%, max 20%), crystallised into fee-shares minted at current `pps`.
- High-level entrypoints `depositStable(token, amount, receiver)` and `redeemToStable(shares, token, receiver)` wrap the ERC-4626 flow with `PUSDManager.mintForVault` / `redeemForVault` atomically. Users do not need to hold PUSD at any point.
- Pure ERC-4626 `deposit`/`withdraw`/`mint`/`redeem` remain available for PUSD-already-holders.

**Pause:** `ADMIN_ROLE.pause()` blocks `depositStable`, `redeemToStable`, and the four ERC-4626 entrypoints. Fast crisis tool, not timelocked.

**Upgrades:** `UPGRADER_ROLE` held by 48h Timelock.

### 2.4 PUSDLiquidity.sol — new

**Shape:** `AccessControlUpgradeable` + `PausableUpgradeable` + `UUPSUpgradeable`.

**Storage:** `maxDeployableBps` (≤ 3500), `strategies[]`, `strategyEnabled`, `strategyCapBps`, `strategyDeployedPUSD`, `paused`.

**Invariant enforcement (I-12):**
- `deployToStrategy` checks post-deploy totals against `maxDeployableBps * PUSDPlus.totalAssets() / 10_000` and against per-strategy sub-caps.
- `setMaxDeployableBps` reverts if `> HARD_CAP_BPS (3500)`.

**Vault pull algorithm:** `pullForWithdraw(token, amount, recipient)` —
1. Satisfy from idle balance first.
2. Rank enabled strategies by instant-unwind cost; unwind cheapest-first until covered.
3. If still short, revert `InsufficientLiquidity(requested, delivered)` at launch.
4. Future: route the shortfall to an ERC-7540 queue (ADR 0005 candidate).

**Adapter ABI:**
```solidity
interface IStrategyAdapter {
    function deposit(address token, uint256 amount) external returns (uint256 sharesOrLP);
    function withdraw(uint256 amount) external returns (address token, uint256 delivered);
    function balanceInPUSD() external view returns (uint256);
    function harvest() external returns (uint256 rewardsInPUSD);
    function underlyingTokens() external view returns (address[] memory);
    function instantUnwindCapacity(address token) external view returns (uint256);
}
```

### 2.5 Launch adapters

Each adapter inherits `BaseAdapter` (shared role gate to `PUSDLiquidity` + decimal helpers).

**`AaveV3SupplyAdapter`**
- Holds `aUSDC` / `aUSDT` directly (aTokens are interest-bearing by balance delta).
- `deposit` → `pool.supply(token, amount, self, 0)`.
- `withdraw` → `pool.withdraw(token, amount, self)` — then transfer to caller.
- `balanceInPUSD` → `IERC20(aToken).balanceOf(self)` normalised to PUSD 6 decimals.
- `harvest` → no-op (interest accrues passively; rebase is implicit).
- `instantUnwindCapacity(token)` → `min(aToken.balanceOf(self), IERC20(token).balanceOf(aaveATokenContract))`.

**`Curve3poolLPAdapter`**
- Holds 3pool LP.
- `deposit` → zap via `add_liquidity([0, USDCamt, 0], minLP)`.
- `withdraw(amt)` → compute LP-to-burn from current virtual price, `remove_liquidity_one_coin(lp, 1, minUSDC)`.
- Harvest CRV → swap via 1inch or Curve router to USDC → call `deposit(USDC, swapped)` to recompound.
- `balanceInPUSD` → LP balance × virtual price, normalised.
- Slippage guard: deploy revertsif `actualLPOut < minLP(deploySlippageBps)`.

**`MorphoSupplyAdapter`**
- One adapter instance per whitelisted market (keyed by `marketId`).
- `deposit` → `morpho.supply(marketParams, amount, 0, self, "")`.
- `withdraw` → `morpho.withdraw(marketParams, amount, 0, self, self)`.
- `balanceInPUSD` → `morpho.expectedSupplyAssets(marketId, self)`.
- `harvest` → no-op at launch (Morpho rewards are external; handled off-chain then deposited via `rebalance`).

### 2.6 Rate-bearing wrappers (reserve composition, Lever 1)

Managed inside `PUSDManager`, **not** `PUSDLiquidity`.

Launch pair:
- `ISDAIAdapter` — wraps DAI ↔ sDAI via MakerDAO DSR. `rebalanceReserveToRateBearing(DAI, amt)` calls through.
- `ISUSDSAdapter` — wraps USDS ↔ sUSDS.

Each is a thin adapter that exposes `wrap(base, amount) → wrappedOut` and `unwrap(wrapped, amount) → baseOut`. The rebalance functions on PUSDManager are atomic: balance check, wrap/unwrap, update internal accounting so that `balance - surplus == parReserve + yieldShareReserve` continues to hold after the slice token changes.

> **Open question (OQ-10):** sUSDe and USDY adapters land after 30 days live, behind a dedicated ADR.

### 2.7 Deploy scripts

**`DeployAndConfigure.s.sol` (rewrite):**
```
1. Deploy PUSD proxy (initialize with multisig).
2. Deploy PUSDManager proxy (initialize with PUSD + multisig).
   → PUSD.grantRole(MINTER_ROLE, Manager)
   → PUSD.grantRole(BURNER_ROLE, Manager)
3. Deploy PUSDPlus proxy (initialize with PUSD + Manager + multisig).
   → PUSDManager.grantRole(VAULT_ROLE, PUSDPlus)
   → PUSDManager.setPUSDPlus(PUSDPlus)
4. Deploy PUSDLiquidity proxy (initialize with PUSDPlus + Manager + multisig).
   → PUSDPlus.grantRole(LIQUIDITY_ROLE, PUSDLiquidity)
   → PUSDPlus: set PUSDLiquidity address
5. Deploy TimelockController (48h).
6. Rotate UPGRADER_ROLE on all four contracts to the Timelock.
7. Run VerifyRoles.s.sol — asserts the full matrix.
```

**`AddSupportedTokens.s.sol` (extend):** initial tokens `USDC`, `USDT`, `DAI`, `USDS`, `crvUSD`. Configure `rateBearingWrapper` for DAI→sDAI and USDS→sUSDS.

**`AddStrategies.s.sol` (new):** launch adapters with sub-caps: Aave-USDC 1500, Aave-USDT 1000, Morpho-USDC-WBTC 500, Curve-3pool 500. Sum matches the 3500 hard cap; launch `maxDeployableBps` = 2500.

### 2.8 Test plan

Three tiers.

**Unit (PUSD.t / PUSDManager.v2.t / PUSDPlus.t / PUSDLiquidity.t / adapters/*.t):**
- Every external function exercised in isolation with mock dependencies.
- Role-gate tests: every role-guarded function rejects the wrong caller.
- Revert-path tests: every `require` / custom error path hit.
- Storage layout captured per contract; changes require explicit upgrade test.

**Integration (test/integration/):**
- `FourContractFlow` — end-to-end user journey: mint PUSD+, wait for strategy yield, redeem — with Aave + Curve + Morpho mocked to deterministic return rates.
- `PlainRedeemUnderStress` — set several tokens to `REDEEM_ONLY` / `EMERGENCY_REDEEM`; verify basket and emergency paths still honour `parReserve` exclusively.
- `VaultRedeemWithUnwind` — deploy near cap, trigger a large PUSD+ redeem; confirm cheapest-first unwind, confirm `InsufficientLiquidity` revert path under extreme stress.

**Invariant (test/invariant/):**
- Handler exposes all state-mutating calls with bounded random inputs: user deposits, user redeems, admin role actions, rebalances, wrap/unwrap, strategy deploys/withdrawals, harvests, time-warps.
- Assertions checked after every call:
  - I-01: balance == parReserve + yieldShareReserve + fees + haircut.
  - I-01b: `pps >= 1e18` whenever `totalSupply > 0`.
  - I-05: all fee bounds respected.
  - I-12: `totalDeployedInPUSD <= maxDeployableBps * totalAssets / 10_000`.
- Ghost variables: cumulative mint vs burn, net vault deposits per token, strategy deploys minus withdraws.
- Target: 2048 runs, 128-deep sequences, zero failures.

**Fork (test/fork/):**
- Mainnet fork at a pinned block for each launch chain deployment target.
- Replay Aave / Curve / Morpho market behaviour with real contracts; verify `balanceInPUSD` matches actual withdrawable.
- Gas snapshot each integration path; fail CI if >15% regression.

**Differential:**
- Compare `previewDeposit` / `previewRedeem` against on-chain state transitions for ERC-4626 compliance (OZ invariants + a fork of tob-sec's ERC-4626 suite).

### 2.9 Audit plan

- **Internal:** full review pass at each contract boundary before integration.
- **External:** target two independent firms. Scope:
  - Firm A: full protocol (PUSD/Manager/Plus/Liquidity) + flow-level invariants.
  - Firm B: adapters + rate-bearing wrapper integrations (narrower but deeper).
- Launch gate: zero critical findings, all highs resolved or formally accepted in an ADR, invariant suite green.

### 2.10 Deployment gates

Before mainnet genesis (all must hold):
- [ ] All three test tiers (unit + integration + invariant) green on CI.
- [ ] Storage layouts locked; upgrade-dry-run from a v1-style Manager to the v2 extension passes without collision.
- [ ] `UPGRADER_ROLE` held only by the 48h Timelock on all four contracts.
- [ ] `MAX_TOKENS = 25`, `HARD_CAP_BPS = 3500`, `MAX_PERFORMANCE_FEE_BPS = 2000` verified in-bytecode.
- [ ] Pre-launch ADRs landed: OQ-06 (default fees), OQ-08 (performance fee cadence), OQ-09 (launch strategy mix), OQ-10 (rate-bearing wrappers).
- [ ] Deploy script run on testnet (Donut) + full flow exercised + role matrix verified.
- [ ] Audit reports published alongside deploy.

---

## 3. Delivery phasing

A suggested sequence that respects dependency order and gets value on-testnet early.

**Phase 1 — Extension (2 weeks)**
Extend `PUSDManager` to support slicing. Ship `parReserve`, `yieldShareReserve`, `mintForVault`, `redeemForVault`, `setPUSDPlus`, `setVaultHaircutBps`. **PUSD+ and PUSDLiquidity not yet deployed, but the wiring is in place.** Tests green for slice accounting.

**Phase 2 — Plus (2 weeks)**
Implement `PUSDPlus.sol` + HWM fee + pause. Test against Phase-1 Manager with PUSDLiquidity stubbed to `netAssetsInPUSD() == 0`. `pps == 1.0` baseline works end-to-end.

**Phase 3 — Liquidity engine (2 weeks)**
Implement `PUSDLiquidity.sol` + BaseAdapter + AaveV3SupplyAdapter only. Cap + sub-cap enforcement. Integration test `FourContractFlow` green against Aave adapter.

**Phase 4 — Multi-adapter (1 week)**
Add Curve + Morpho adapters. Fork tests. Test coverage ≥ 95% line, ≥ 90% branch on adapters.

**Phase 5 — Rate-bearing reserve (1 week)**
sDAI and sUSDS adapters + `rebalanceReserveToRateBearing` flow tested end-to-end.

**Phase 6 — Deploy + audit (4 weeks elapsed)**
Audit opens end of Phase 3; findings addressed through Phase 5. Deploy to testnet end of Phase 4; mainnet after audit clearance.

**Total**: ~12 weeks engineering + audit. Narrow the path by cutting adapters to Aave-only at launch if needed, and adding Curve/Morpho as a v2.1.

---

## 4. Risks to the plan

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ERC-4626 rounding surprises (inflation attack, dust) | Medium | High | Virtual shares + OZ audited base + differential fork tests |
| Curve LP slippage during volatile markets | Medium | Medium | Slippage guards + small sub-cap at launch; adjustable by admin |
| Aave market pauses leaving capital stuck | Low | Medium | `emergencyUnwind(adapter)`; per-adapter sub-cap limits exposure |
| Manager storage layout collision on upgrade | Low | Critical | Pre-upgrade `forge inspect` diff + CI check; defer any v1 live upgrade until slice additions verified on testnet |
| Timelock misconfiguration locking upgrades | Low | High | Role-matrix verification script run post-deploy; dry-run timelock queue on testnet before mainnet |
| Invariant suite too shallow to catch cross-tier bugs | Medium | High | Run 2048+ iterations; seed with known pathological states; spot-check cases in integration tests |

---

## 5. Hand-off checklist for implementation

When implementation begins, the first PR should land:
- [ ] `interfaces/IPUSDPlus.sol`, `IPUSDLiquidity.sol`, `IStrategyAdapter.sol`, `IRateBearingAdapter.sol` — signatures only.
- [ ] Foundry remappings for `@aave`, `@curve`, `@morpho`.
- [ ] `test/invariant/Handler.sol` with stubs that compile but revert — so the invariant scaffolding exists from day one.

This unblocks parallel work on Manager, Plus, and Liquidity.

---

*End of plan.*

# v2 Contracts — Engineering Plan

Blueprint for implementing the four-contract PUSD v2 architecture defined by [ADR 0003](decisions/0003-product-architecture.md). This document is the engineering brief — no code here, just the shape of the work.

> **Scope.** Implementation-ready spec for `PUSD.sol` (carry-over), `PUSDManager.sol` (v2 extension), `PUSDPlus.sol` (new), `PUSDLiquidity.sol` (new, Uniswap V3 LP manager), deploy scripts, and the test plan.
>
> **Liquidity primitive.** Uniswap V3 only. PUSDLiquidity manages one USDC/USDT pool on Push Chain Donut Testnet at launch. No Aave, no Compound, no Morpho, no Curve — PUSD treats Uniswap V3 as its execution layer because we also need the *routing and swap depth* it provides, not just yield.
>
> **Non-goals for v2.** Rate-bearing wrappers (sDAI, sUSDe, USDY). Cross-chain LP (same-chain only at launch). ERC-7540 async queue. Governance token.

---

## 0. Why only Uniswap V3 (decision context)

The v2 brief rewrote the earlier multi-strategy plan. The operating thesis:

1. **PUSD is a routing product, not a yield product.** The primary job of deployed capital is to create swap depth for USDC ↔ USDT on Push Chain (and, later, across chains). Yield is a by-product of LP fees.
2. **Uniswap V3 is the deepest available stable primitive.** It gives concentrated liquidity (capital efficiency), an already-assumed routing target for aggregators, and organic fee income on every swap that touches our range.
3. **Fewer moving parts is a feature.** One venue → one adapter → one risk surface. Simpler invariants, simpler audits, simpler upgrade story.
4. **Real yield only.** Fee APR on USDC/USDT ranges is modest (estimate 3–5% gross) but it is trading revenue, not rented emissions. It aligns with PUSD's posture as boring collateral.

Capital allocation (target):

- **50% idle** — sits in `PUSDManager.parReserve + yieldShareReserve idle buffer` to guarantee redemption.
- **50% deployed** — in Uniswap V3 USDC/USDT LP positions owned by `PUSDLiquidity`.
- **Re-balance bands:** idle > 60 % triggers admin deploy; idle < 30 % triggers admin unwind.

Hard caps (enforced in code):

| Parameter              | Launch  | Hard cap | Notes                                     |
| ---------------------- | ------- | -------- | ----------------------------------------- |
| `maxDeployableBps`     | 3000    | 5000     | % of `PUSDPlus.totalAssets` deployable    |
| `emergencyLiquidityBps`| 3000    | —        | Floor below which admin must unwind       |
| `perfFeeBps`           | 1000    | 2000     | PUSD+ performance fee on realized gain    |
| `maxTokens` on Manager | 25      | 25       | Carry-over from v1                        |

`maxDeployableBps = 3000` means at most 30% of `PUSDPlus.totalAssets()` can live in LP positions at any moment. The user's 50/50 target is the *steady-state policy*, but the code limits us to 30 % max at launch so early bugs cannot blow up the redemption path.

---

## 1. File tree

```
contracts/
├── src/
│   ├── PUSD.sol                    CARRY-OVER from v1. Unchanged.
│   ├── PUSDManager.sol             v2 EXTENSION. Slice accounting (parReserve + yieldShareReserve), mintForVault/redeemForVault, Pausable.
│   ├── PUSDPlus.sol                NEW. ERC-4626 wrapper over PUSD with HWM perf fee.
│   ├── PUSDLiquidity.sol           NEW. Uniswap V3 LP manager owned by PUSDPlus.
│   │
│   ├── univ3/
│   │   ├── UniV3PositionManager.sol  NEW. Thin wrapper over NonfungiblePositionManager: mint, increase, decrease, collect.
│   │   └── UniV3Router.sol           NEW. Swap helper used during rebalance unwinds (USDC↔USDT rounding).
│   │
│   ├── interfaces/
│   │   ├── IPUSD.sol               CARRY-OVER.
│   │   ├── IPUSDManager.sol        v2 EXTENSION: mintForVault, redeemForVault, slice views, pause.
│   │   ├── IPUSDPlus.sol           NEW.
│   │   ├── IPUSDLiquidity.sol      NEW.
│   │   ├── INonfungiblePositionManager.sol  Uniswap V3 NPM interface (vendored).
│   │   ├── ISwapRouter.sol         Uniswap V3 SwapRouter interface.
│   │   ├── IUniswapV3Pool.sol      pool view interface (slot0, liquidity, ticks).
│   │   └── IUniswapV3Factory.sol   factory view interface.
│   │
│   └── libs/
│       ├── DecimalLib.sol          NEW (extract of v1 inline helpers).
│       └── TickMath.sol            CARRY-OVER from Uniswap V3 periphery (MIT).
│
├── script/
│   ├── DeployPUSD.s.sol            CARRY-OVER. Reused for PUSD deploy only.
│   ├── DeployManager.s.sol         NEW (v2 extension).
│   ├── DeployPlus.s.sol            NEW.
│   ├── DeployLiquidity.s.sol       NEW. Wires PUSDLiquidity to the on-Push-Chain Uniswap V3 NPM + SwapRouter.
│   ├── DeployAndConfigure.s.sol    REWRITE. Orchestrates all four, grants roles, rotates UPGRADER_ROLE to 48h timelock.
│   ├── AddSupportedTokens.s.sol    EXTEND. Same 9 USDC/USDT tokens as v1 (no DAI/USDS/etc.).
│   ├── OpenInitialPosition.s.sol   NEW. Opens the first USDC/USDT LP position in a concentrated range.
│   └── VerifyRoles.s.sol           NEW. Asserts the full post-deploy role matrix.
│
├── test/
│   ├── unit/
│   │   ├── PUSD.t.sol              CARRY-OVER.
│   │   ├── PUSDManager.v2.t.sol    REWRITE. Plain + vault paths, slice accounting, Pausable.
│   │   ├── PUSDPlus.t.sol          NEW. ERC-4626 compliance + HWM fee model.
│   │   ├── PUSDLiquidity.t.sol     NEW. Cap enforcement, LP lifecycle, unwind priority.
│   │   └── univ3/*.t.sol           NEW. Position wrapper + router unit tests.
│   │
│   ├── integration/
│   │   ├── FourContractFlow.t.sol        NEW. End-to-end: user → Plus → Manager → Liquidity → UniV3.
│   │   ├── PlainRedeemUnderStress.t.sol  NEW. Basket + emergency paths, parReserve only (LP untouched).
│   │   ├── VaultRedeemWithUnwind.t.sol   NEW. Large PUSD+ redeem forces LP decrease + swap.
│   │   ├── LPDrift.t.sol                 NEW. Simulate USDC:USDT price moving 1.005 / 0.995; confirm no stuck capital.
│   │   └── OutOfRange.t.sol              NEW. Price moves outside LP range; LP earns zero fees but can still unwind to USDC.
│   │
│   ├── invariant/
│   │   ├── Handler.sol             Full-call-surface handler: deposits, redeems, LP deploy/unwind, price moves, harvests.
│   │   ├── invariants.t.sol        I-01, I-01b, I-02, I-05, I-07, I-10, I-11, I-12.
│   │   └── ghostBook.sol           Cumulative mint/burn/deploy/collect trackers.
│   │
│   └── fork/
│       ├── UniV3Mainnet.fork.t.sol       NEW. Mainnet Ethereum fork — verifies NPM + Router integration against real Uniswap V3 bytecode.
│       └── UniV3PushChain.fork.t.sol     NEW. Donut-testnet fork — verifies the actual deployed pool behaviour we target at launch.
│
├── foundry.toml                    UPDATE. Invariant depth 128 / runs 2048. `via_ir = true` for heavy tests.
├── remappings.txt                  UPDATE. Add `@uniswap/v3-core`, `@uniswap/v3-periphery`.
└── deployed.txt                    UPDATE. Add PUSDPlus, PUSDLiquidity, UniV3 pool + position IDs.
```

---

## 2. Contract-by-contract plan

### 2.1 PUSD.sol — carry-over

No changes. Already audited; already live on Donut. Re-audit only if the upgrade mechanics change.

### 2.2 PUSDManager.sol — v2 extension

**New state (append-only — no collisions with v1 layout):**

```solidity
mapping(address => uint256) public parReserve;         // backs plain PUSD
mapping(address => uint256) public yieldShareReserve;  // backs PUSD+
address public pusdPlus;                                // VAULT_ROLE holder
uint16  public vaultHaircutBps;                         // default 0, max 500
bool    public paused;                                  // hard stop on mint + redeem
```

**New roles:**

| Role         | Purpose                                                     |
| ------------ | ----------------------------------------------------------- |
| `VAULT_ROLE` | Granted to `PUSDPlus`; gates `mintForVault` / `redeemForVault`. |
| `PAUSER_ROLE`| Granted to a fast-emergency multisig; can flip `paused`.   |

**New entrypoints:**

```solidity
function mintForVault(address token, uint256 amount, address recipient)
    external onlyRole(VAULT_ROLE) whenNotPaused nonReentrant returns (uint256 pusdMinted);

function redeemForVault(uint256 pusdAmount, address preferredAsset, address recipient)
    external onlyRole(VAULT_ROLE) whenNotPaused nonReentrant returns (uint256 tokenOut);

function setPUSDPlus(address newVault) external onlyRole(ADMIN_ROLE);
function setVaultHaircutBps(uint16 bps) external onlyRole(ADMIN_ROLE);
function setPaused(bool value) external onlyRole(PAUSER_ROLE);
function reclassify(address token, bool fromParToYield, uint256 amount)
    external onlyRole(ADMIN_ROLE) nonReentrant;
```

**Modified internals:**

- Every `deposit` path credits `parReserve[token]`. Every `mintForVault` path credits `yieldShareReserve[token]`.
- `_executeRedeem` takes a `fromSlice` parameter (`PAR` or `YIELD`). Plain `redeem` reads from par only; `redeemForVault` reads from yield only.
- `_executeBasketRedeem` / `_executeEmergencyRedeem` untouched — plain-PUSD holders are unaware of the yield slice.
- `rebalance()` gains a `slice` parameter and only moves balance within a single slice.
- New invariant `_sliceSum(token) == parReserve[token] + yieldShareReserve[token] + accruedFees[token] + accruedHaircut[token] <= IERC20(token).balanceOf(this)` — asserted in a view getter and in the invariant handler.

**Storage safety:**

- All v2 slots appended after existing v1 slots — no reordering.
- Pre-flight: `forge inspect PUSDManager storageLayout > layout.before.json` before any upgrade; diff after.
- CI gate: storage layout hash captured per release tag.

### 2.3 PUSDPlus.sol — new

**Shape:** `ERC4626Upgradeable` + `AccessControlUpgradeable` + `PausableUpgradeable` + `UUPSUpgradeable`.

**Key design choices:**

- Underlying asset: `PUSD` (6 decimals).
- Shares: 18 decimals (ERC-4626 convention).
- Virtual-shares protection via `_decimalsOffset() = 6` to kill the inflation attack.
- `totalAssets() = PUSD.balanceOf(self) + PUSDLiquidity.netAssetsInPUSD()` where `netAssetsInPUSD` values the LP position at current pool state plus uncollected fees.
- HWM-based performance fee, default 10 %, max 20 %. Crystallised into fee-shares minted at current `pps` to the treasury, not charged in PUSD.
- High-level entrypoints `depositStable(token, amount, receiver)` and `redeemToStable(shares, token, receiver)` wrap the ERC-4626 flow with `PUSDManager.mintForVault` / `redeemForVault` atomically — users never need to hold bare PUSD.
- Pure ERC-4626 `deposit` / `withdraw` / `mint` / `redeem` remain available for already-PUSD holders.

**Roles:**

| Role             | Purpose                                    | Held by           |
| ---------------- | ------------------------------------------ | ----------------- |
| `ADMIN_ROLE`     | Set fee params, set Liquidity address      | Multisig          |
| `PAUSER_ROLE`    | Pause deposits + redemptions               | Fast multisig     |
| `UPGRADER_ROLE`  | Authorise UUPS upgrades                    | 48 h Timelock     |
| `LIQUIDITY_ROLE` | Reserved — allows PUSDLiquidity callbacks  | `PUSDLiquidity`   |

**Pause:** `PAUSER_ROLE.pause()` blocks `depositStable`, `redeemToStable`, and the four ERC-4626 entrypoints. Fast crisis tool, not timelocked.

### 2.4 PUSDLiquidity.sol — new (the Uniswap V3 manager)

**Shape:** `AccessControlUpgradeable` + `PausableUpgradeable` + `UUPSUpgradeable`.

**Responsibility:** own all Uniswap V3 positions that back the yield slice. Deploy USDC ↔ USDT liquidity into a concentrated range, collect fees, unwind on demand when PUSDPlus needs to satisfy a redemption.

**Storage:**

```solidity
INonfungiblePositionManager public npm;      // Uniswap V3 NPM on Push Chain
ISwapRouter public router;                   // Uniswap V3 SwapRouter
IUniswapV3Factory public factory;
address public pusdPlus;                     // only this address can call pull/push

uint16 public maxDeployableBps;              // ≤ 5000 hard cap; launch 3000
uint16 public emergencyLiquidityBps;         // idle floor; launch 3000

struct Position {
    uint256 tokenId;                         // NFT from NPM
    address pool;
    address token0;                          // USDC
    address token1;                          // USDT
    uint24  fee;                             // 100 / 500 / 3000 / 10000
    int24   tickLower;
    int24   tickUpper;
    bool    active;
}
Position[] public positions;
mapping(uint256 => uint256) public positionIndex;  // tokenId → positions[] index

uint256 public totalDeployedUSDC;            // tracked for idle/deployed ratio
uint256 public totalDeployedUSDT;
```

**Roles:**

| Role              | Purpose                                               |
| ----------------- | ----------------------------------------------------- |
| `ADMIN_ROLE`      | Configure pool, ranges, caps                          |
| `REBALANCER_ROLE` | Routine deploy / collect / rebalance operations       |
| `PAUSER_ROLE`     | Halt new deployments (collection + unwind still work) |
| `UPGRADER_ROLE`   | UUPS upgrades (48 h Timelock)                         |

**Core entrypoints:**

```solidity
// Open a new concentrated-range position.
function mintPosition(
    address pool,
    int24 tickLower,
    int24 tickUpper,
    uint256 amount0,
    uint256 amount1,
    uint256 minAmount0,
    uint256 minAmount1
) external onlyRole(REBALANCER_ROLE) whenNotPaused returns (uint256 tokenId);

// Add to an existing position.
function increasePosition(uint256 tokenId, uint256 amount0, uint256 amount1, uint256 min0, uint256 min1)
    external onlyRole(REBALANCER_ROLE) whenNotPaused;

// Remove liquidity from a position (burns LP share, returns tokens).
function decreasePosition(uint256 tokenId, uint128 liquidity, uint256 min0, uint256 min1)
    external onlyRole(REBALANCER_ROLE);

// Collect accrued fees from a position into the contract.
function collectFees(uint256 tokenId) external returns (uint256 amount0, uint256 amount1);

// Close a position entirely (decrease to zero, collect, mark inactive).
function closePosition(uint256 tokenId, uint256 min0, uint256 min1)
    external onlyRole(REBALANCER_ROLE);

// Called by PUSDPlus only. Satisfy `amount` of `token`; unwind positions as needed.
function pullForWithdraw(address token, uint256 amount, address recipient)
    external returns (uint256 delivered);

// Called by PUSDPlus only. Receive idle capital from the yield slice.
function pushForDeploy(address token, uint256 amount) external;

// Views
function netAssetsInPUSD() external view returns (uint256);
function idleBalance(address token) external view returns (uint256);
function positionValue(uint256 tokenId) external view returns (uint256 usdc, uint256 usdt, uint256 feesUsdc, uint256 feesUsdt);
function inRange(uint256 tokenId) external view returns (bool);
```

**Invariant enforcement (I-12):**

- `mintPosition` / `increasePosition` reverts if `(totalDeployedUSDC_after + totalDeployedUSDT_after) * PUSD_SCALE / PUSDPlus.totalAssets() > maxDeployableBps`.
- `setMaxDeployableBps` reverts if `newBps > HARD_CAP_BPS (5000)`.

**Unwind algorithm (`pullForWithdraw`):**

```
1. Satisfy as much as possible from idleBalance(token).
2. If more is still needed:
   a. Iterate positions sorted by (inRange DESC, fees accrued DESC) —
      prefer to harvest fees before burning principal, and prefer in-range positions first (deepest for swaps).
   b. For each position:
      - collectFees first (contributes to idle).
      - If still short, decreasePosition by `liquidityRequired`, taking care to match the requested token:
        if pool is token0:USDC / token1:USDT and we need USDT, compute the fraction such that amount1 out ≥ remaining need.
      - Swap any "wrong-token" delta via UniV3Router at an admin-set maxSlippage.
   c. Stop when amount delivered ≥ amount requested.
3. If exhausted, revert `InsufficientLiquidity(requested, delivered)`.
```

**Pause semantics:** when paused, `mintPosition`, `increasePosition`, `pushForDeploy` revert. `collectFees`, `decreasePosition`, `closePosition`, `pullForWithdraw` remain functional so PUSDPlus can always satisfy redemptions. This is the *emergency unwind* posture.

**Fee handling:** `collectFees` delivers token0 + token1 to this contract. Those amounts are immediately claimable by PUSDPlus via `pullForWithdraw` (they increase `idleBalance`), and are surfaced in `netAssetsInPUSD()` until they're collected. The PUSD+ performance fee is charged on the HWM growth, so the NAV lift from collected fees translates into share dilution to the treasury (not a direct token transfer from Liquidity).

### 2.5 UniV3PositionManager.sol — thin NPM wrapper

Why a wrapper rather than calling NPM directly from PUSDLiquidity? Two reasons:

1. **Upgrade surface.** PUSDLiquidity is our upgradeable contract; NPM is not. A thin wrapper keeps NPM calls in one place and makes interface-shape changes easier to handle.
2. **Test surface.** All NPM interactions can be mocked in a single stub for unit tests; only fork tests need the real NPM.

Wrapper responsibilities:

- Encode / decode `mint`, `increaseLiquidity`, `decreaseLiquidity`, `collect` params.
- Normalize return types to PUSDLiquidity-friendly shapes.
- Enforce minimum-out slippage guards as a last line of defence.
- Handle the corner case of NPM's `refund` returning leftover wei.

No privileged state; pure library-style contract. Deployed once, referenced by PUSDLiquidity.

### 2.6 UniV3Router.sol — swap helper

Used during `pullForWithdraw` when the requested token is not the one we have after a decrease. Tiny wrapper around `ISwapRouter.exactInputSingle`:

- Enforces `maxSlippageBps` passed by PUSDLiquidity.
- Records `totalSwappedIn` / `totalSwappedOut` for telemetry.
- No custody — funds flow through the call frame.

At launch, USDC/USDT on Donut should be tightly pegged and the swap route is a single hop on the same pool. Multi-hop swaps are a v2.1 concern (cross-chain).

### 2.7 Deploy scripts

**`DeployAndConfigure.s.sol` (rewrite):**

```
1. Deploy PUSD proxy (initialize with multisig).   ← can skip; v1 PUSD is already live
2. Deploy PUSDManager v2 proxy (initialize with PUSD + multisig).
   → PUSD.grantRole(MINTER_ROLE, Manager)
   → PUSD.grantRole(BURNER_ROLE, Manager)
3. Deploy PUSDPlus proxy (initialize with PUSD + Manager + multisig).
   → PUSDManager.grantRole(VAULT_ROLE, PUSDPlus)
   → PUSDManager.setPUSDPlus(PUSDPlus)
4. Deploy UniV3PositionManager + UniV3Router (stateless wrappers).
5. Deploy PUSDLiquidity proxy (initialize with PUSDPlus + Manager + NPM + Router + multisig).
   → PUSDPlus.grantRole(LIQUIDITY_ROLE, PUSDLiquidity)
   → PUSDPlus.setLiquidity(PUSDLiquidity)
6. Deploy TimelockController (48 h).
7. Rotate UPGRADER_ROLE on all four proxies to the Timelock.
8. Run VerifyRoles.s.sol — asserts the full matrix.
```

> **v1 → v2 migration note.** The live Donut PUSD at `0x5eb3…Cd00` and Manager at `0x809d…aC3D` (see `docs/design/v1-deployment.md`) are UUPS proxies. The Manager upgrade path is: `forge script UpgradeManagerToV2.s.sol --rpc-url donut --private-key $ADMIN` — but only after the storage-layout CI gate passes. PUSDPlus + PUSDLiquidity are fresh deploys.

**`AddSupportedTokens.s.sol` (extend):** same nine USDC/USDT tokens as v1. No new token classes — no DAI, no USDS, no rate-bearing wrappers.

**`OpenInitialPosition.s.sol` (new):**

```
Inputs:
  - Pool: USDC.eth / USDT.eth, fee tier 100 (0.01%)
  - Range: current tick ± 50 basis points (tight stable range)
  - Amount: 30% of current yieldShareReserve (seed — matches launch `maxDeployableBps`)

Steps:
  1. PUSDLiquidity.pushForDeploy(USDC, amount/2)    ← called by PUSDPlus admin
  2. PUSDLiquidity.pushForDeploy(USDT, amount/2)
  3. PUSDLiquidity.mintPosition(pool, tickLow, tickHigh, amountUSDC, amountUSDT, minUSDC, minUSDT)
  4. Emit InitialPositionOpened(tokenId, pool, tickLow, tickHigh).
```

Initial range width is admin-configurable. The default 50 bps range is tight enough to earn meaningful fees on stable swaps and wide enough to stay in range through normal peg wobble (USDC and USDT in practice float ±20 bps).

### 2.8 Test plan

**Unit (test/unit/):**

- Every external function exercised with mock dependencies.
- Role-gate tests: every role-guarded function rejects the wrong caller.
- Revert-path tests: every `require` / custom error path hit.
- Storage layout captured per contract; changes require explicit upgrade test.
- `PUSDLiquidity.t.sol` coverage: cap enforcement, pause behaviour, unwind priority, idle-first satisfaction, slippage revert, empty-position guards.

**Integration (test/integration/):**

- `FourContractFlow` — end-to-end user journey: `PUSDPlus.depositStable(USDC, 1000, alice)` → Manager slice credited → admin calls `PUSDLiquidity.pushForDeploy` + `mintPosition` → time warp + fake swaps → `alice.redeemToStable(shares, USDC)` succeeds.
- `PlainRedeemUnderStress` — set several tokens to `REDEEM_ONLY` / `EMERGENCY_REDEEM`; verify plain `redeem` paths still honour `parReserve` exclusively and LP positions are untouched.
- `VaultRedeemWithUnwind` — deploy 30 % of yield slice; trigger a PUSD+ redeem larger than idle; confirm `pullForWithdraw` unwinds positions correctly.
- `LPDrift` — simulate pool price moving between 1:1.005 and 1:0.995 (realistic peg wobble); confirm `netAssetsInPUSD` tracks and no stuck capital.
- `OutOfRange` — push price outside the position range; LP earns zero fees; confirm unwind still delivers USDC (or USDT, depending on which side is out-of-range) without loss beyond expected IL.

**Invariant (test/invariant/):**

- Handler exposes all state-mutating calls with bounded random inputs: user deposits, user redeems, admin role actions, rebalances, LP mint/increase/decrease/collect, pool-price moves, time warps.
- Assertions checked after every call:
  - **I-01:** `IERC20(t).balanceOf(Manager) == parReserve[t] + yieldShareReserve[t] + fees[t] + haircut[t]` for every supported `t`.
  - **I-01b:** `pps >= 1e18` whenever `PUSDPlus.totalSupply() > 0`.
  - **I-05:** all fee bounds respected.
  - **I-12:** `(totalDeployedUSDC + totalDeployedUSDT) * SCALE <= maxDeployableBps * PUSDPlus.totalAssets()`.
  - **I-13 (new):** `sum(positions.netAssetsInPUSD) + idleBalance ≈ (yieldShareReserve snapshot) - redemptions` within LP accounting drift tolerance (bounded by pool fee tier, e.g. 0.01 %).
- Ghost variables: cumulative mint vs burn, net vault deposits per token, LP deposits minus withdrawals, cumulative fees collected.
- Target: 2048 runs, 128-deep sequences, zero failures.

**Fork (test/fork/):**

- `UniV3Mainnet.fork.t.sol` — mainnet Ethereum fork at a pinned block. Proves NPM + Router integrations match real Uniswap V3 bytecode. Replays real pool behaviour.
- `UniV3PushChain.fork.t.sol` — Donut testnet fork. Proves the actual deployment target behaves as expected.
- Gas snapshots per integration path; fail CI if > 15 % regression.

**Differential:**

- Compare `previewDeposit` / `previewRedeem` against on-chain state transitions for ERC-4626 compliance (OZ invariants + a fork of tob-sec's ERC-4626 suite).

### 2.9 Audit plan

- **Internal:** full review pass at each contract boundary before integration.
- **External:** target two independent firms. Scope:
  - Firm A: full protocol (PUSD/Manager/Plus/Liquidity) + flow-level invariants.
  - Firm B: Uniswap V3 integration layer (NPM wrapper, Router wrapper, unwind math, slippage) — narrower but deeper.
- Launch gate: zero critical findings, all highs resolved or formally accepted in an ADR, invariant suite green.

### 2.10 Deployment gates

Before mainnet genesis (all must hold):

- [ ] All three test tiers (unit + integration + invariant) green on CI.
- [ ] Storage layouts locked; upgrade-dry-run from the live v1 Manager to the v2 extension passes without collision.
- [ ] `UPGRADER_ROLE` held only by the 48 h Timelock on all four contracts.
- [ ] `MAX_TOKENS = 25`, `HARD_CAP_BPS = 5000`, `MAX_PERFORMANCE_FEE_BPS = 2000` verified in-bytecode.
- [ ] Pre-launch ADRs landed: OQ-06 (default fees), OQ-08 (performance fee cadence), OQ-09 (initial LP range strategy).
- [ ] Deploy script run on testnet (Donut) + full flow exercised + role matrix verified.
- [ ] Initial LP position opened via `OpenInitialPosition.s.sol` and observed in-range for 48 hours with non-zero fee accrual.
- [ ] Audit reports published alongside deploy.

---

## 3. Delivery phasing

A sequence that respects dependency order and gets value on testnet early.

**Phase 1 — Extension (2 weeks)**
Extend `PUSDManager` to support slicing. Ship `parReserve`, `yieldShareReserve`, `mintForVault`, `redeemForVault`, `setPUSDPlus`, `setVaultHaircutBps`, `Pausable`. PUSD+ and PUSDLiquidity not yet deployed but the wiring is in place. Tests green for slice accounting.

**Phase 2 — Plus (2 weeks)**
Implement `PUSDPlus.sol` + HWM fee + pause. Test against Phase-1 Manager with PUSDLiquidity stubbed to `netAssetsInPUSD() == 0`. `pps == 1.0` baseline works end-to-end.

**Phase 3 — Liquidity engine (3 weeks)**
Implement `PUSDLiquidity.sol` + UniV3PositionManager + UniV3Router. Cap enforcement. Position lifecycle (mint / increase / decrease / collect / close). `FourContractFlow` integration test green. `LPDrift` and `OutOfRange` integration tests green. Fork tests against mainnet Uniswap V3 NPM.

**Phase 4 — Pull-for-withdraw polish (1 week)**
Unwind algorithm tuned, slippage guards calibrated, invariant suite expanded with I-13. 48-hour run on Donut testnet with live pool activity (simulated via scripted swaps).

**Phase 5 — Ops tooling (1 week)**
Off-chain rebalance bot (recommend idle > 60 % or < 30 % alerts), monitoring dashboards, runbooks. This is frontend/ops territory but blocks the launch.

**Phase 6 — Audit + launch (4 weeks elapsed, overlapping)**
Audit opens end of Phase 3; findings addressed through Phase 5. Mainnet after audit clearance.

**Total:** ~10 weeks engineering + audit, one venue, one strategy. The previous multi-adapter (Aave + Curve + Morpho) plan has been cut — expand back only if a future ADR makes the case.

---

## 4. Risks to the plan

| Risk                                                                 | Likelihood | Impact | Mitigation                                                                                          |
| -------------------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------- |
| ERC-4626 rounding surprises (inflation attack, dust)                 | Medium     | High   | Virtual shares + OZ audited base + differential fork tests                                          |
| LP range bust — price moves outside range, zero fees                 | Medium     | Medium | Tight initial range (±50 bps) with auto-widen if out-of-range > 48h; admin-triggered rebalance      |
| USDC or USDT depegs                                                  | Low        | Critical | `EMERGENCY_REDEEM` token status drains affected asset; LP positions unwind to the surviving asset; tight idle floor (`emergencyLiquidityBps >= 3000`) |
| Redemption crunch — all idle spent, LP unwind-too-slow                | Low        | High   | Hard cap `maxDeployableBps = 5000`; launch `3000`; unwind priority orders positions by instant capacity |
| Uniswap V3 contract bug / pause on Push Chain                         | Very Low   | Critical | Pre-launch verification NPM and pool are the canonical deployments; admin can manually closePosition and route redemptions through parReserve only |
| Manager storage layout collision on upgrade                           | Low        | Critical | Pre-upgrade `forge inspect` diff + CI check; defer any v1 live upgrade until slice additions verified on testnet |
| Timelock misconfiguration locking upgrades                            | Low        | High   | Role-matrix verification script run post-deploy; dry-run timelock queue on testnet before mainnet   |
| Swap slippage on unwind larger than estimated                         | Low        | Medium | `maxSlippageBps` configurable per call; PUSDPlus surfaces the observed slippage in tx logs          |

---

## 5. Hand-off checklist for implementation

When implementation begins, the first PR should land:

- [ ] `interfaces/IPUSDPlus.sol`, `IPUSDLiquidity.sol`, `INonfungiblePositionManager.sol`, `ISwapRouter.sol`, `IUniswapV3Pool.sol`, `IUniswapV3Factory.sol` — signatures only.
- [ ] Foundry remappings for `@uniswap/v3-core`, `@uniswap/v3-periphery`.
- [ ] `test/invariant/Handler.sol` with stubs that compile but revert — so the invariant scaffolding exists from day one.
- [ ] Storage-layout snapshot of the live v1 Manager at `deployed.txt` addresses committed to repo.

This unblocks parallel work on Manager v2, Plus, and Liquidity.

---

*End of plan.*

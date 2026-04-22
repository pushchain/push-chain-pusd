# ADR 0003 — Product Architecture (Two-Tier)

**Status:** Accepted
**Date:** 2026-04-22
**Supersedes:** the single-contract sketch described in the v1 research notes in `docs/research/`.

---

## TL;DR

PUSD ships as **two distinct ERC-20s**, not one:

| Token | Role | Mechanism | Always worth |
|---|---|---|---|
| **PUSD** | Boring stable, for payments + settlement | 1:1 par-backed by a reserve of stablecoins held in `PUSDManager` | Always $1, always instantly redeemable |
| **PUSD+** | Yield-bearing wrapper, for savers | ERC-4626 vault over PUSD, NAV-accruing via `PUSDLiquidity` | Monotonically increasing PUSD per share |

- PUSDManager's reserve is **internally partitioned** into a `parReserve` slice (backs PUSD 1:1) and a `yieldShareReserve` slice (owned by PUSD+).
- Only the `yieldShareReserve` slice feeds `PUSDLiquidity`, the protocol's Uniswap V3 LP engine. LP risk never contaminates `parReserve`.
- The UI defaults to minting PUSD+; plain PUSD is a one-toggle opt-out for integrators.

This ADR replaces the v1 design in which PUSD was the only token and all reserve capital was either idle or deployed indiscriminately.

---

## Context

Three product tensions drove this redesign:

1. **The yield-or-credibility fork.** In the v1 design we had to choose between issuing PUSD as a boring token (credible settlement, no yield, weak deposit story) or a yield-bearing token (strong deposit story, but $1.02 PUSD breaks settlement, integrations, and every user's mental model of "a dollar"). Neither is acceptable on its own.

2. **Idle capital.** Any reserve design that holds only plain USDC/USDT wastes capital. Competitive stablecoins either hold rate-bearing assets under the hood or expose a yield wrapper to end users. On Push Chain today there are no audited money-markets, no Curve deployments, and no Morpho markets to hold against. What exists — and what PUSD needs for its own redemption path — is Uniswap V3. The protocol puts the yield-tier slice of its reserve to work as concentrated USDC/USDT LP positions. Yield is real trading fees; the LP also doubles as the swap depth redemption needs when users ask for a basket asset the Manager is thin on.

3. **Integrator vs. saver audiences have different needs.**
   - **Integrators** (payments, settlement, DeFi protocols) need an instrument whose unit of account is exactly $1, whose supply is directly counted, and whose redemption is deterministic. Yield accrual breaks their assumptions.
   - **Savers** (retail users, treasuries holding idle cash) need yield. They do not care about unit-of-account purity; they care about `amountOutAtWithdraw / amountInAtDeposit > 1`.

A single token cannot serve both without pretending. Two tokens, each honest about its job, can.

---

## Decision

### §1 — Two tokens, one reserve

Ship two ERC-20s:

- **PUSD** (`PUSD.sol`) — plain ERC-20, 6 decimals, minted 1:1 by `PUSDManager` against stablecoin deposits. **Par-backed. Always $1. Always instantly redeemable.**
- **PUSD+** (`PUSDPlus.sol`) — ERC-4626 vault whose underlying asset is PUSD. **NAV-accruing. Exchange rate `pps` (PUSD-per-share) starts at 1.0 and only increases.**

Both share a single reserve held in `PUSDManager`, but the reserve is **logically partitioned** (§3).

### §2 — Four contracts, clean separation

```
┌──────────────────────────┐           ┌───────────────────────────┐
│       PUSD (ERC-20)      │           │     PUSD+ (ERC-4626)      │
│  minimal; mint/burn only │           │  underlying = PUSD        │
└──────────────────────────┘           │  NAV = PUSD held by vault │
             ▲                          │        + PUSDLiquidity    │
             │ mint/burn                │        net assets         │
             │                          └───────────────────────────┘
   ┌─────────┴─────────────────┐                    │
   │      PUSDManager          │◀───────────────────┘
   │  holds reserve; splits    │   deposit PUSD into
   │  into parReserve and      │   PUSD+ ⇒ PUSDManager
   │  yieldShareReserve slices │   moves the equivalent
   │                           │   reserve from parReserve
   │                           │   into yieldShareReserve
   └───────────────────────────┘
             │
             │ only yieldShareReserve funds it
             ▼
   ┌────────────────────────────────┐
   │        PUSDLiquidity           │
   │  owned by PUSD+ (not Manager)  │
   │  deploys up to maxDeployableBps│
   │  of yieldShareReserve into:    │
   │    - Uniswap V3 USDC/USDT LP   │
   │      (100 bps fee tier,        │
   │       ±50 bps around parity)   │
   └────────────────────────────────┘
```

Four contracts, not three. Each has exactly one job:

- `PUSD` — an accountable token. Mint, burn, role-guarded. 58 lines.
- `PUSDManager` — the reserve. Split into two slices. Mint/redeem logic for **plain PUSD**, plus the subset of mint/redeem needed to support PUSD+ wrap/unwrap.
- `PUSDPlus` — a standard ERC-4626 wrapper. Underlying is PUSD. `totalAssets()` reports the sum of (PUSD it holds directly) + (PUSD-equivalent net assets reported by `PUSDLiquidity`).
- `PUSDLiquidity` — protocol-owned LP engine, owned by PUSD+. It never holds PUSD (it holds the underlying stablecoins, a `Position[]` array of Uniswap V3 NFT positions, and uncollected fees). It reports `netAssetsInPUSD()` to PUSD+ so the NAV calculation is honest. There are no other strategy venues; Uniswap V3 is the sole execution layer.

### §3 — Reserve slicing

`PUSDManager` tracks two slices of the same pool of stablecoins:

```solidity
// per supported token
mapping(address => uint256) public parReserve;
mapping(address => uint256) public yieldShareReserve;
```

Invariant: `parReserve[token] + yieldShareReserve[token] == available balance for that token` (excluding `accruedFees` and `accruedHaircut`).

- **Plain PUSD deposit** → credits `parReserve[token]` by the deposit amount; mints PUSD to the user.
- **Plain PUSD redeem** → debits `parReserve[token]`; burns PUSD.
- **PUSD+ mint** → atomically: user deposits stablecoin → PUSDManager credits `yieldShareReserve[token]` (not parReserve) → PUSDPlus mints PUSD+ shares at the current `pps` → no PUSD ever touches the user.
- **PUSD+ burn (redeem)** → atomically: PUSDPlus burns shares → PUSDManager debits `yieldShareReserve[token]` (pulling from `PUSDLiquidity` if needed) → user receives stablecoin.

**Why this shape matters:** plain PUSD is backed only by `parReserve`. Strategy risk in `PUSDLiquidity` can only consume `yieldShareReserve`. A depeg, slashing, or smart-contract exploit in a deployed strategy cannot break `parReserve` (and therefore cannot break plain PUSD's 1:1 promise).

### §4 — One venue, capped deployment

Reserve composition is **plain USDC/USDT only**. Rate-bearing wrappers (sUSDS, sDAI, USDY, sUSDe, scrvUSD) are not available on Push Chain today and are explicitly out of scope for v2. When they appear on-chain they can be added via a follow-up ADR; until then the `yieldShareReserve` slice is held either as idle USDC/USDT inside `PUSDManager` or as a deployed LP position inside `PUSDLiquidity`.

There is one strategy venue: **Uniswap V3 USDC/USDT on Push Chain.** `PUSDLiquidity` can pull up to `maxDeployableBps` (cap: **5000**, launch: **3000**) of PUSD+ net assets and use them to open concentrated-liquidity positions.

| Parameter | Value | Why |
|---|---|---|
| Pool | USDC/USDT | only stable pair available, minimal peg-divergence risk |
| Fee tier | `100` (0.01%) | stablecoin-to-stablecoin competitive tier |
| Initial range | ±50 bps around $1 parity | tight enough to earn, wide enough to survive normal peg wobble |
| Out-of-range policy | admin may re-center; if abandoned, position behaves as a static basket |
| Max positions | `10` | hard cap on `Position[]` length to bound unwind gas |
| Swap slippage cap | `50` bps per rebalance | `UniV3Router` refuses a swap that moves the pool more than this |

The pool serves two jobs simultaneously. **Yield**: stablecoin LP on a 100-bps tier earns ~3–5% on deployed capital at modest volume. **Swap depth**: when a user redeems the preferred basket asset and the Manager is thin on it, the protocol can route through its own pool to convert the other reserve token into the one they asked for. The LP is the liquidity engine that backs both PUSD redemptions and PUSD+ unwinds.

Adding another strategy venue requires a new ADR. There are no Aave markets, no Curve pools, and no Morpho vaults on Push Chain to integrate against — this is not a preference, it is the chain's current reality. Nothing in the `PUSDLiquidity` interface precludes adding a second venue later, but v2 ships with one.

### §5 — Default UX: yield-bearing, one toggle away

The frontend's "Mint" tab mints **PUSD+ by default**. A visible toggle labeled "I want plain PUSD" switches the flow to PUSD. Both flows are a single transaction.

- The default appeals to savers — they get yield without thinking.
- The toggle serves integrators — they get the exact boring token they need.

Neither flow is hidden; both are named. The backend doesn't care which the user picked; `PUSDManager` just credits a different reserve slice.

### §6 — Redemption promise

**Plain PUSD.** The promise is:

1. Preferred asset, if `_getAvailableLiquidity(preferred) >= pusdAmount` in `parReserve`.
2. Otherwise, basket — proportional across all non-REMOVED tokens' `parReserve` slices.
3. Otherwise, emergency — preferred + all `EMERGENCY_REDEEM` tokens, pulling only from `parReserve`.

Plain PUSD **never touches `yieldShareReserve`** for redemption. If the yield tier is in crisis, plain PUSD is unaffected.

**PUSD+.** The promise is:

1. Burn shares → receive the PUSD-equivalent amount of the preferred stablecoin, at current `pps`.
2. Pulls liquidity from `yieldShareReserve` directly, then unwinds `PUSDLiquidity` positions if needed.
3. If a strategy cannot be unwound atomically, PUSD+ redemptions may be queued via a separate `requestRedeem` flow (ERC-7540-style). **Instant redeem of PUSD+ is best-effort, not guaranteed.**

This is the honest promise: yield requires deployed capital, which cannot always be instantly recalled.

### §7 — Upgrade governance

All four contracts are UUPS-upgradeable. `UPGRADER_ROLE` on each must be held by a 48-hour `TimelockController`. Launch-day role assignment is in ADR 0002.

### §8 — Hard limits at the code level

| Limit | Value | Where |
|---|---|---|
| `MAX_TOKENS` | `25` | `PUSDManager` compile-time constant |
| `maxDeployableBps` hard cap | `5000` (50%) | `PUSDLiquidity` storage ceiling |
| `maxDeployableBps` launch value | `3000` (30%) | `PUSDLiquidity` deploy-time default |
| `emergencyLiquidityBps` | `3000` (30%) | minimum `yieldShareReserve` kept idle in Manager |
| `maxPositions` | `10` | `PUSDLiquidity.Position[]` length cap |
| `lpSwapSlippageBps` max | `50` bps | `UniV3Router` per-rebalance swap slippage |
| `baseFee` max | `100` bps | `PUSDManager` |
| `preferredFeeMax` max | `200` bps | `PUSDManager` |
| `surplusHaircutBps` max | `4000` bps (40%) | `PUSDManager` per-token |
| PUSD+ performance fee (on realised yield) | `1000` bps (10%) launch, max `2000` | `PUSDPlus` |

### §9 — Par / yield-share accounting

This is the piece that makes the whole design honest. Two illustrative example.

**Initial state:** `parReserve[USDC] = 1_000_000`, `yieldShareReserve[USDC] = 0`, `PUSD.totalSupply() = 1_000_000`, `PUSD+.totalSupply() = 0`, `pps = 1.0`.

**Alice mints PUSD+ for $1,000 USDC.**
1. She sends 1,000 USDC to `PUSDManager`.
2. `PUSDManager` increments `yieldShareReserve[USDC]` by 1,000. It mints 1,000 PUSD **directly to `PUSDPlus`**, not to Alice. `parReserve[USDC]` is unchanged at 1,000,000.
3. Immediately, `PUSDPlus` receives 1,000 PUSD, calls `deposit(1,000, Alice)`, and mints `1,000 / pps = 1,000` PUSD+ shares to Alice.
4. Result: `PUSD.totalSupply() = 1,001,000` (the 1,000 new PUSD lives inside PUSDPlus), PUSD+ totalSupply = 1,000, pps unchanged.

**Time passes, the LP earns.** `PUSDLiquidity` deploys 30% of `yieldShareReserve` as a concentrated USDC/USDT position on the 100-bps fee tier. Swap fees accrue inside the Uniswap V3 NFT; the contract periodically collects them. `netAssetsInPUSD()` = idle stablecoins + `positionValue(tokenId)` + uncollected fees, all normalised to 6-decimal PUSD terms. After a period of pool volume this sums to 1,005 PUSD of claimable value against 1,000 PUSD+ shares outstanding. `pps = 1.005`. Alice's share is now worth $1,005.

**Bob mints plain PUSD for $1,000 USDC.**
1. Bob sends 1,000 USDC to `PUSDManager`.
2. `PUSDManager` increments `parReserve[USDC]` by 1,000. Bob receives 1,000 PUSD. **Always 1:1. Always $1.**
3. `yieldShareReserve` unchanged. `pps` unchanged. Alice's position unaffected.

The two deposits cost the same USDC, but each user gets the instrument that matches their need.

---

## Rationale

### Why not "make PUSD yield-bearing directly"?

We explored this. A rebasing PUSD (à la stETH) breaks payment integrations that assume conservation of supply across transfers. A non-rebasing yield-bearing PUSD (à la USDM, where `pps` drifts) breaks every integration that assumes PUSD is worth $1. Neither is acceptable for a settlement asset. The wrapper pattern exists precisely to keep these two concerns disjoint.

### Why not "skip PUSD+ and just hold rate-bearing reserves"?

We would earn yield on the reserve but have no way to return it to users. Either:
- Keep it on the balance sheet (the protocol becomes a net-income business; users earn nothing; no one deposits) — weak.
- Distribute via governance buybacks — distant, diluted, bad UX — weak.
- Surface to users via a yield-bearing token — this is the wrapper pattern. So we build it.

### Why is `PUSDLiquidity` owned by PUSD+ and not PUSDManager?

Because its risk should only touch yield-tier capital. If PUSDManager owned `PUSDLiquidity`, its losses would hit the shared reserve, and plain PUSD holders would pay for strategy mistakes they never consented to. By making PUSD+ the owner, the blast radius of any strategy exploit is strictly `yieldShareReserve`. Plain PUSD's 1:1 promise is not "insured" by yield-tier assets — it is mechanically isolated from them.

### Why not expose `PUSDLiquidity` directly to users as a separate LP token?

Because PUSD+ already plays that role, and a second token fragments liquidity. `PUSDLiquidity` is an internal engine; users only ever see PUSD or PUSD+. This matches the shape of every vault product — users hold `yvUSDC` or `aUSDC`, never the strategy shares underneath. The Uniswap V3 NFT positions are protocol-owned; their existence is a valuation input to `pps`, not a user-facing instrument.

### Why ERC-4626 specifically?

Zero ambiguity for integrators. Every yield-token aggregator, vault router, and portfolio tracker already speaks ERC-4626. The semantics of `deposit`/`withdraw`/`totalAssets`/`previewDeposit` are familiar and auditable. We pay a tiny complexity tax (async redemption may need ERC-7540 later) for enormous integration velocity.

### Why cap deployment at 50% and not higher?

Because redemption latency is the real product risk, not strategy fragility. The unwind path for a Uniswap V3 position is `decreaseLiquidity` → `collect` → optional `swap` to convert one leg into the asset the user asked for. Each leg is one transaction on the same chain. At 50%, the 30%+ slice that stays idle inside `PUSDManager` absorbs the steady-state redemption flow, and the LP only needs to be touched for large unwinds. Above 50% we start worrying about a large redeem coinciding with an out-of-range position — if both reserve legs are on the wrong side of the tick, the unwind forces a swap at unfavorable price. 50% is the ceiling where honest redemption still holds without assumptions about pool depth.

### Why launch at 30% if the cap is 50%?

Headroom for mistakes. Launch conservatively, raise only after live data shows the LP behaves as modelled — fees accrue at the projected rate, the position stays in range through normal volatility, unwind tests succeed under load. The cap is the ceiling the code permits; the launch value is the floor operations choose. Moving from 30% to 50% is a parameter change; moving the cap above 50% requires a new ADR.

### Why a 30% emergency-liquidity floor?

Independent of the deployment cap, `PUSDLiquidity` must refuse to pull the idle slice below 30% of `yieldShareReserve`. This is the buffer that survives an out-of-range LP position: if the pool has drifted so one leg is effectively static, the idle slice is what satisfies redemptions while governance decides whether to re-center or abandon the position. Without this floor, a worst-case drift could force a sale at pool-deep-end prices to meet a redeem. With it, we have a week of redemption coverage at steady-state flow even if the LP is frozen.

---

## Consequences

### What this enables

- A frontend that says "mint & earn" by default and still serves integrators who need unit-of-account stability.
- A reserve that's productive across the full stack (rate-bearing holdings, plus deployed strategies) without polluting the settlement token.
- Clean audit story: each contract has one job. Invariants decompose.

### What this costs

- Four upgradeable contracts to deploy, not two. More surface area, more wiring, more role management. Worth it, but not free.
- PUSD+ async redemption (when `PUSDLiquidity` can't instantly unwind) requires an ERC-7540-style queue, which is an independent audit object.
- Integrators who hold plain PUSD earn **zero yield**. This is correct — plain PUSD is par-backed by idle `parReserve`, no yield source — but must be communicated clearly. Integrators who want yield can hold PUSD+ instead.

### What changes in the codebase

- `PUSDManager.sol` gains `parReserve` and `yieldShareReserve` mappings, gains `mintForVault` and `redeemForVault` entrypoints callable only by PUSD+, and loses no existing functionality.
- New contract: `PUSDPlus.sol` (ERC-4626, ~300 lines).
- New contract: `PUSDLiquidity.sol` (UniV3 position manager, ~550 lines). Wraps `INonfungiblePositionManager` for mint/increase/decrease/collect, holds a bounded `Position[]` array, and exposes `netAssetsInPUSD()` derived from idle balances + live `positionValue(tokenId)` reads.
- New contract: `UniV3Router.sol` (~150 lines). Thin `ISwapRouter` wrapper with admin-settable slippage ceilings; used by `PUSDLiquidity` during rebalance and by `PUSDManager` during preferred-asset redemption when the requested reserve leg is thin.
- `PUSD.sol` is **unchanged**. PUSD+ does not have `MINTER_ROLE` on PUSD; PUSDManager remains the sole minter.

### What changes in the invariants

- **I-01** extends: `PUSDManager.parReserve[t] + PUSDManager.yieldShareReserve[t] + fees[t] + haircut[t] == IERC20(t).balanceOf(PUSDManager)` for every non-removed token.
- **I-01b (new)**: `PUSDPlus.totalAssets() >= PUSDPlus.totalSupply() * 1` in PUSD terms — that is, `pps >= 1.0` always. PUSD+ never goes below par.
- **I-10** extends: burning PUSD+ burns proportionate PUSD held by the vault.
- **I-12 (new)**: `PUSDLiquidity.totalDeployedInPUSD() <= maxDeployableBps * PUSDPlus.totalAssets() / BASIS_POINTS`.
- **I-13 (new)**: LP accounting drift bound — `|netAssetsInPUSD() - (idleBalances + Σ positionValue(tokenId) + uncollectedFees)| / netAssetsInPUSD() <= 10 bps`. A larger drift means the LP's self-reported NAV has diverged from what the chain actually owes the protocol, and PUSD+ should halt minting until reconciled.
- **R-07** retires: "Treasury Not Set" is no longer a contamination risk because plain-PUSD holders are not owed any portion of strategy yield.

### What moves to follow-up ADRs

- Adding a second strategy venue when one becomes available on Push Chain (Aave, Morpho, Curve, or equivalent). Each addition is one ADR.
- Rate-bearing reserve composition (sUSDS, sDAI, USDY, scrvUSD, sUSDe) when any of these assets are bridged to Push Chain with a trusted oracle.
- The PUSD+ performance-fee destination and frequency (ADR 0004 candidate).
- Full ERC-7540 async redemption semantics (ADR 0005 candidate; launch ships with best-effort sync redemption against `PUSDLiquidity`'s idle slice, and a simple rate-limit on claimable-from-positions).
- Cross-chain LP extensions — opening positions on Uniswap V3 on Ethereum, Base, Arbitrum via CEAs, with return-leg accounting through Route 3. Explicitly out of scope for v2.

---

## Status of Historical Research

The files in `docs/research/` predate this ADR and describe a single-contract design. They are retained for context and must be read with this header in mind. Where research and ADR conflict, the ADR governs.

---

*End of ADR 0003.*

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
- Only the `yieldShareReserve` slice feeds `PUSDLiquidity`, the protocol's LP and strategy engine. Strategy risk never contaminates `parReserve`.
- The UI defaults to minting PUSD+; plain PUSD is a one-toggle opt-out for integrators.

This ADR replaces the v1 design in which PUSD was the only token and all reserve capital was either idle or deployed indiscriminately.

---

## Context

Three product tensions drove this redesign:

1. **The yield-or-credibility fork.** In the v1 design we had to choose between issuing PUSD as a boring token (credible settlement, no yield, weak deposit story) or a yield-bearing token (strong deposit story, but $1.02 PUSD breaks settlement, integrations, and every user's mental model of "a dollar"). Neither is acceptable on its own.

2. **Idle capital.** Any reserve design that holds only plain USDC/USDT wastes capital. Every competitive stablecoin either (a) holds rate-bearing assets (sUSDS, sDAI, USDY) under the hood, or (b) exposes a yield wrapper to end users. We want both.

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
   │    - Aave supply               │
   │    - Curve LPs                 │
   │    - Morpho markets            │
   └────────────────────────────────┘
```

Four contracts, not three. Each has exactly one job:

- `PUSD` — an accountable token. Mint, burn, role-guarded. 58 lines.
- `PUSDManager` — the reserve. Split into two slices. Mint/redeem logic for **plain PUSD**, plus the subset of mint/redeem needed to support PUSD+ wrap/unwrap.
- `PUSDPlus` — a standard ERC-4626 wrapper. Underlying is PUSD. `totalAssets()` reports the sum of (PUSD it holds directly) + (PUSD-equivalent net assets reported by `PUSDLiquidity`).
- `PUSDLiquidity` — protocol-owned LP and strategy engine, owned by PUSD+. It never holds PUSD (it holds the underlying stablecoins and LP tokens). It reports `netAssetsInPUSD()` to PUSD+ so the NAV calculation is honest.

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

### §4 — Strategy deployment is capped; reserve composition is not

Two levers, with intentionally asymmetric policy:

**Lever 1 — Reserve composition (uncapped).** `PUSDManager` can hold the `yieldShareReserve` slice in rate-bearing forms of the underlying stablecoin:

| Held as | Source | Why |
|---|---|---|
| `sDAI` | MakerDAO DSR | risk-free DAI yield |
| `USDY` | Ondo Finance | tokenized US T-bill yield |
| `sUSDe` | Ethena | delta-neutral ETH funding |
| `scrvUSD` | Curve StableSwap NG | scrvUSD savings |
| `sUSDS` | Sky/MakerDAO | USDS savings rate |

Each rate-bearing wrapper is whitelisted per `TokenInfo` with its `unwrapAdapter` address. Composition is a governance decision, not a numerical cap. Holding rate-bearing forms is a passive, safe baseline — **all of `yieldShareReserve` can be rate-bearing without increasing blow-up risk**, because each wrapper is a stablecoin-denominated instrument with a public NAV.

**Lever 2 — Active strategies (capped).** `PUSDLiquidity` can pull up to `maxDeployableBps` (cap: **3500**, launch: **2500**) of PUSD+ net assets and deploy them into *non-trivial* strategies:

| Strategy | Role | Risk class |
|---|---|---|
| Aave v3 supply (USDC/USDT) | depth | audited lending |
| Curve 3pool / crvUSD LP | liquidity depth, trading fees | AMM IL + peg risk |
| Morpho blue markets | optimised lending | curator + oracle risk |

Every strategy is behind an `IStrategyAdapter` interface. Adding a strategy requires `ADMIN_ROLE` and is gated by `maxDeployableBps`. Raising the cap requires a new ADR.

The asymmetry is deliberate: *holding capital in a T-bill wrapper* is not the same risk class as *LPing into a volatile pool*. The cap should apply to the latter, not the former.

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
| `maxDeployableBps` hard cap | `3500` (35%) | `PUSDLiquidity` storage ceiling |
| `maxDeployableBps` launch value | `2500` (25%) | `PUSDLiquidity` deploy-time default |
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

**Time passes, strategies earn.** `PUSDLiquidity` deploys 25% of `yieldShareReserve` into Aave and earns. It reports `netAssetsInPUSD() = 1,005`, meaning the yield tier now has 1,005 PUSD of claimable value against 1,000 PUSD+ shares outstanding. `pps = 1.005`. Alice's share is now worth $1,005.

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

Because PUSD+ already plays that role, and a second token fragments liquidity. `PUSDLiquidity` is an internal engine; users only ever see PUSD or PUSD+. This matches the shape of Aave (users hold `aUSDC`, never see the reserve internals) and Yearn (users hold `yvUSDC`, never see strategy shares).

### Why ERC-4626 specifically?

Zero ambiguity for integrators. Every yield-token aggregator, vault router, and portfolio tracker already speaks ERC-4626. The semantics of `deposit`/`withdraw`/`totalAssets`/`previewDeposit` are familiar and auditable. We pay a tiny complexity tax (async redemption may need ERC-7540 later) for enormous integration velocity.

### Why cap strategies at 35% and not higher?

Because redemption latency is the real product risk, not strategy fragility. At 35%, we can always unwind the deployed slice within a few blocks of market time — Aave supply is instant, Curve/Morpho are one transaction. At 60% we start worrying about blockbusters — large redeem requests competing with our own unwind, cascading slippage, protocol-level contagion during stress. 35% is conservative by design. Raising it requires evidence, not optimism.

### Why launch at 25% if the cap is 35%?

Headroom for mistakes. Launch conservatively, raise only after live data shows strategies behave as modelled in stress. The cap is the ceiling the code permits; the launch value is the floor operations choose.

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
- New contract: `PUSDLiquidity.sol` (strategy engine, ~500 lines) plus one adapter per strategy.
- `PUSD.sol` is **unchanged**. PUSD+ does not have `MINTER_ROLE` on PUSD; PUSDManager remains the sole minter.

### What changes in the invariants

- **I-01** extends: `PUSDManager.parReserve[t] + PUSDManager.yieldShareReserve[t] + fees[t] + haircut[t] == IERC20(t).balanceOf(PUSDManager)` for every non-removed token.
- **I-01b (new)**: `PUSDPlus.totalAssets() >= PUSDPlus.totalSupply() * 1` in PUSD terms — that is, `pps >= 1.0` always. PUSD+ never goes below par.
- **I-10** extends: burning PUSD+ burns proportionate PUSD held by the vault.
- **I-12 (new)**: `PUSDLiquidity.totalDeployedInPUSD() <= maxDeployableBps * PUSDPlus.totalAssets() / BASIS_POINTS`.
- **R-07** retires: "Treasury Not Set" is no longer a contamination risk because plain-PUSD holders are not owed any portion of strategy yield.

### What moves to follow-up ADRs

- The specific list of strategy adapters and their parameter ranges (one ADR per adapter class).
- The PUSD+ performance-fee destination and frequency (ADR 0004 candidate).
- Full ERC-7540 async redemption semantics (ADR 0005 candidate; launch ships with best-effort sync redemption against `PUSDLiquidity`'s idle slice, and a simple rate-limit on claimable-from-strategies).

---

## Status of Historical Research

The files in `docs/research/` predate this ADR and describe a single-contract design. They are retained for context and must be read with this header in mind. Where research and ADR conflict, the ADR governs.

---

*End of ADR 0003.*

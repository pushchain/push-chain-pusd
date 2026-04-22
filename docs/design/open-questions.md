# Open Questions

Unresolved design questions that require a decision before v2 can be considered production-ready.

> **Resolved in [ADR 0003](decisions/0003-product-architecture.md):** OQ-01 (timelock on `UPGRADER_ROLE`) and OQ-02 (`MAX_TOKENS = 25`). They remain below for historical context.

---

## OQ-01 — Upgrade governance  *(resolved · [ADR 0003 §7](decisions/0003-product-architecture.md))*

**Resolution:** 48h `TimelockController` as sole holder of `UPGRADER_ROLE` on all four contracts before mainnet genesis.

---

## OQ-02 — Maximum token count  *(resolved · [ADR 0003 §8](decisions/0003-product-architecture.md))*

**Resolution:** `MAX_TOKENS = 25` compile-time constant in `PUSDManager`. Increasing the cap requires first reclaiming tombstone slots (OQ-03).

---

## OQ-03 — REMOVED token slot reclamation

**Question:** Should `tokenList` entries for REMOVED tokens be compacted, or left as tombstones?

**Status:** Not blocking for launch. Revisit when token count exceeds 15.

---

## OQ-04 — Haircut on vault path

**Question:** Should `PUSDManager.mintForVault` apply a haircut? Currently `vaultHaircutBps = 0`.

**Tradeoff:** A non-zero vault haircut builds `parReserve`-side buffer without hitting users on the NAV path. Pro: more plain-PUSD safety margin. Con: creates friction on the default UX, which we just spent two ADRs making frictionless.

**Recommendation pre-launch:** keep `vaultHaircutBps = 0`. Revisit if `parReserve`-side buffer proves insufficient under stress.

---

## OQ-05 — Emergency redeem triggers

**Question:** Should `EMERGENCY_REDEEM` status be triggerable automatically (oracle-based), or always manual?

**Status:** Manual at launch. Oracle-triggered emergency mode is an architecture decision for a future version.

---

## OQ-06 — Default preferred-fee values

**Question:** Should default `preferredFeeMin`/`preferredFeeMax` be non-zero at deploy, or must governance set them post-launch?

**Status:** Policy decision pending. Launch with range `0 / 0` (free) is not recommended; shipping at `10 / 150` bps is the operational default.

---

## OQ-07 — PUSD+ async redeem queue  *(new, v2)*

**Question:** When `PUSDLiquidity` cannot instantly satisfy a PUSD+ withdraw, how should the user flow degrade?

**Options:**
1. Revert with `InsufficientLiquidity()` and show a "try again soon" message (launch default).
2. Implement ERC-7540-style async request / claim queue with a keeper that unwinds.
3. Implement a withdrawal fee that slides with utilisation (exit queue priced by bonding).

**Recommendation:** Ship Option 1 at launch. Option 2 is a natural follow-up (ADR 0005 candidate). Option 3 adds mechanism complexity that is not justified until live redemption patterns observed.

**Blocking:** No. Launch-OK without a queue, because the 30% launch cap + 30% idle-liquidity floor means at least 70% of PUSD+ net assets are either idle in the Manager or recoverable via a single `decreaseLiquidity` transaction — enough to absorb realistic redeem flow without pausing.

---

## OQ-08 — Performance-fee cadence and destination  *(new, v2)*

**Question:** When does PUSD+ crystallise the performance fee, and who receives it?

**Options:**
1. Continuous (each interaction updates HWM and mints fee-shares).
2. Block-throttled (once per `feeCrystallisationInterval` seconds).
3. Manual-only (`ADMIN_ROLE.crystallise()`).

**Recommendation:** Option 1 with a 10 bp gas-budget short-circuit (skip if delta < threshold). Destination is the protocol treasury. Fee token is PUSD+ itself (minted fresh at current `pps`, so no dilution of existing holders at crystallisation time).

**Status:** Target for an ADR before launch (ADR 0004 candidate).

---

## OQ-09 — Launch LP parameters  *(new, v2)*

**Question:** What tick range, fee tier, and position size should the v2 LP open with?

**Baseline proposal:**
- Pool: USDC/USDT on Push Chain, fee tier `100` (0.01%).
- Initial range: ±50 bps around $1 parity.
- Initial deposit: 30% of PUSD+ total assets at launch, split 50/50 between USDC and USDT (re-split as the pool price dictates).
- Re-center trigger: keeper re-centers if `slot0.tick` moves > 30 bps from the position midpoint for more than `rebalanceCooldown` (default 6 hours).
- Swap-slippage ceiling on rebalance: 50 bps.

**Status:** Target for an ADR before launch (ADR 0006 candidate). Expect to iterate once live fee/volume data exists.

---

## OQ-10 — When to add rate-bearing reserve composition  *(deferred until assets are on-chain)*

**Question:** When sDAI, sUSDS, USDY, sUSDe, or scrvUSD are bridged to Push Chain, which should be whitelisted as `rateBearingWrapper` entries on `PUSDManager`?

**Status:** Parked. None of these assets exist on Push Chain Donut Testnet today. The Solidity storage slots (`rateBearingWrapper`, `unwrapAdapter`) are already reserved in `TokenInfo` but must remain `address(0)` at v2 launch. When any of them are bridged with a trusted oracle, an ADR revisits this question — likely sDAI and sUSDS first (both T-bill / MakerDAO collateralised).

---

## OQ-11 — When to add a second strategy venue  *(deferred)*

**Question:** Should PUSDLiquidity integrate a second venue (Aave, Morpho, Curve, or equivalent) once one is live on Push Chain?

**Status:** Parked. No lending markets or alternative DEXes exist on Push Chain Donut Testnet today. The `PUSDLiquidity` interface is a bespoke UniV3 manager rather than a generic adapter pattern — adding a second venue will require a follow-up ADR and either a second engine contract or an interface refactor. Revisit when the alternative is actually deployable.

---

## Summary

| ID | Status | Blocking launch? |
|---|---|---|
| OQ-01 | Resolved | — |
| OQ-02 | Resolved | — |
| OQ-03 | Pending | No |
| OQ-04 | Pending | No (launch = 0) |
| OQ-05 | Pending | No (manual ok) |
| OQ-06 | Pending | Yes (set values pre-launch) |
| OQ-07 | Pending | No |
| OQ-08 | Pending | Yes (ship ADR) |
| OQ-09 | Pending | Yes (ship ADR) |
| OQ-10 | Pending | Yes (ship ADR) |

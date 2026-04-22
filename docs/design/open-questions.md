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

**Blocking:** No. Launch-OK without a queue, because the 35% deploy cap + Aave-preferred adapter allocations imply almost all redeems can be served instantly.

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

## OQ-09 — Launch strategy mix  *(new, v2)*

**Question:** Which adapters ship at launch, and with what sub-caps?

**Baseline proposal:**
- `AaveV3SupplyAdapter(USDC)` — sub-cap 15% of PUSD+ TA
- `AaveV3SupplyAdapter(USDT)` — sub-cap 10%
- `MorphoSupplyAdapter(USDC-WBTC 90LTV)` — sub-cap 5%
- `Curve3poolLPAdapter` — sub-cap 5%

Sum: 35% (at the hard cap). Launch value of `maxDeployableBps` is 25%, so these sub-caps are ceilings, not the initial allocation.

**Status:** Target for an ADR before launch (ADR 0006 candidate).

---

## OQ-10 — Rate-bearing wrapper selection  *(new, v2)*

**Question:** Which rate-bearing wrappers hold `yieldShareReserve` at launch?

**Candidates:** sDAI, USDY (Ondo), sUSDe (Ethena), scrvUSD, sUSDS.

**Tradeoffs:** sDAI and sUSDS are maximally safe (collateralised by T-bills + MakerDAO equity). USDY is direct T-bill exposure but has a permissioning story that may not fit all deploy environments. sUSDe is higher-yield but delta-neutral ETH funding-based — policy decision whether to include.

**Recommendation:** Launch with sDAI + sUSDS only. Add sUSDe and USDY after 30 days live, behind a dedicated ADR. scrvUSD waits until Curve integration lands.

**Status:** Target for an ADR before launch (ADR 0007 candidate).

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

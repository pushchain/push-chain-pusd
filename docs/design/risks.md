# Risks

Known failure modes of the two-tier PUSD protocol and the mitigations that exist today.

This replaces the v1 risk register. R-07 retires under ADR 0003; R-09 is added for the Uniswap V3 LP engine.

---

## R-01 — Stablecoin depeg

**Scenario:** One of the two reserve stablecoins (USDC or USDT) loses peg. The Manager holds it at nominal value, and mass redemption of plain PUSD into the healthy asset drains the par slice asymmetrically. For PUSD+, a depegged leg inside the Uniswap V3 position is now the majority of the LP's composition (the pool is converted into the depegged side as arbitrageurs trade out of the healthy side).

**Affects:** Both PUSD and PUSD+, but with different blast radius.
- **Plain PUSD:** Only `parReserve` is exposed. If USDC depegs, `parReserve[USDC]` is worth less than par but `parReserve[USDT]` is still par. Redemption switches to basket or emergency mode.
- **PUSD+:** `yieldShareReserve[USDC]` and any USDC inside `PUSDLiquidity`'s LP position take the full hit. If the position is in range at peg and the pool re-prices, the position rebalances toward the depegged side — `positionValue()` reflects this. `pps` may drop toward but not below 1.0 (clamped by I-01b).

**Mitigations:**
- `TokenStatus` transitions: admin can move the depegged token to `REDEEM_ONLY` or `EMERGENCY_REDEEM` within minutes.
- `PUSDLiquidity.closePosition()` under `REBALANCER_ROLE` can unwind the LP into the healthy leg plus the (discounted) depegged leg, and pause new deployments via `PUSDLiquidity.pause()`.
- Basket redeem protects healthy-asset holders from adverse selection.
- `PUSDPlus.pause()` is available to freeze deposits/withdraws during an active depeg event.
- Future ADR: rate-bearing reserve wrappers (sDAI, sUSDS, etc.) would diversify across issuer trust assumptions — deferred until those assets are bridged to Push Chain.

---

## R-02 — Admin key compromise

**Scenario:** `ADMIN_ROLE` is compromised on any contract.

**Affects:** All four contracts, proportional to the role's scope.

**Mitigations:**
- `ADMIN_ROLE` held by a multisig with multi-party threshold.
- `UPGRADER_ROLE` rotated to a 48h `TimelockController` before mainnet — upgrades cannot be instant.
- `REBALANCER_ROLE` on PUSDLiquidity cannot add adapters, only shuffle within whitelist.
- Strategy whitelist is the single upgrade-gated surface for new risk.

**Residual risk:** A compromised multisig during the 48h window could still execute already-queued harmful governance actions (fee raises, haircut raises). Off-chain monitoring + social recovery is required.

---

## R-03 — Rounding and dust

**Scenario:** Decimal normalisation or basket-proportional math produces rounding errors that compound.

**Affects:** All slices; very small amounts.

**Mitigations:**
- I-08 (non-inflation) covers decimal round-trip.
- Basket redeem's remainder goes to the most-liquid token (bounded dust).
- ERC-4626 `convertToAssets` rounds down on withdraws by default — vault never pays out more than the underlying backs.
- Fuzz tests in the invariant suite pin cumulative dust over thousands of operations.

---

## R-04 — Reentrancy across contracts

**Scenario:** A malicious token or adapter calls back into PUSDManager / PUSDPlus / PUSDLiquidity mid-operation.

**Affects:** All state-mutating entrypoints.

**Mitigations:**
- `nonReentrant` on every external state-mutating function.
- Cross-contract call graph is a DAG: `PUSDPlus → PUSDManager → PUSDLiquidity`. No cycles.
- All token interactions use `SafeERC20`.
- Adapter reviews require reentrancy safety as a checklist item; a misbehaving adapter can only harm the portion of `yieldShareReserve` currently allocated to it (bounded by the per-strategy cap).

---

## R-05 — Unbounded loop gas

**Scenario:** Too many tokens, so `_executeBasketRedeem` or `sweepAllSurplus` exceeds the block gas limit.

**Affects:** PUSDManager.

**Mitigations:**
- `MAX_TOKENS = 25` compile-time constant (ADR 0003 §8).
- Per-token sweep function available as a fallback.
- Gas-cost fuzz tests check full-basket operations at 25 tokens.

**Residual:** If tokenCount grows near 25, consider compaction (OQ-03).

---

## R-06 — Preferred-fee gaming

**Scenario:** A sophisticated user deposits into an overrepresented token, waits, then redeems when it becomes preferred-underrepresented, extracting an arbitrage at protocol expense.

**Affects:** PUSDManager preferred-fee economics. **Plain PUSD only.**

**Mitigations:**
- Fee bounds (I-05) cap the worst case at 2% per leg.
- `surplusHaircutBps` provides a deposit-side disincentive.
- Admin can raise haircut or preferred-fee range to dampen profitable cycles.

Under ADR 0003 this risk is **bounded to plain PUSD**. PUSD+ mints at 1:1 regardless of pool composition (no sliding fee on vault path), so the arbitrage surface is smaller.

---

## R-07 — ~~Treasury not set~~ (retired)

Retired under ADR 0003. Plain PUSD holders are not owed any portion of strategy yield, so a missing treasury destination does not contaminate the settlement token. Surplus sweeps simply revert until a treasury is configured.

---

## R-08 — Upgrade introducing storage corruption

**Scenario:** An upgrade reorders or overwrites existing storage slots.

**Affects:** All upgradeable contracts.

**Mitigations:**
- `forge inspect <Contract> storageLayout` diffed before and after every upgrade.
- 48h timelock gives time for community review of the pending implementation.
- New variables are always appended.

---

## R-09 — LP fragility  *(new, v2)*

**Scenario:** The Uniswap V3 USDC/USDT position drifts out of range, the pool peg diverges, or a large PUSD+ redeem forces unwind at a disadvantaged tick. Loss hits `PUSDLiquidity.netAssetsInPUSD()` and reduces `pps`.

**Affects:** PUSD+ holders only. Plain PUSD is mechanically isolated by the reserve slicing (I-01).

**Failure modes:**
- **Out-of-range position.** The pool tick moves outside `[tickLower, tickUpper]`, so the position sits 100% in the wrong leg until rebalanced. Mitigated by: keeper re-centering within the `±50 bps` launch band; `emergencyLiquidityBps` (30% idle floor) absorbs redemptions while the position is off-range; admin can `closePosition` and re-open.
- **Peg divergence in the pool.** Arbitrageurs push the pool away from 1:1 during a depeg event. Mitigated by: the position value tracks the pool's pricing, so `pps` reflects the loss honestly; `R-01` mitigations for the depegged leg kick in at the Manager level.
- **Unwind slippage.** A user redeem triggers `decreaseLiquidity` + a cross-leg `swapExactInput` that crosses multiple ticks. Mitigated by: `lpSwapSlippageBps` (50 bps default, 100 bps hard ceiling) refuses disadvantaged swaps; the 50% cap bounds deployed size; future ADR 0005 introduces an async queue for oversized requests.
- **NPM / pool bug.** A bug in Uniswap V3 itself or in the Push Chain deployment. Mitigated by: using the audited canonical release; `PUSDLiquidity.pause()` blocks new deployments; `closePosition` works from the paused state.
- **Accounting drift.** `netAssetsInPUSD()` diverges from the true reconstructed NAV (I-13). Off-chain monitors compare reported vs. reconstructed NAV every block; a 10-bps drift triggers automatic pause.

**Residual risk:** Prolonged peg divergence that leaves the LP locked in the depegged leg. `pps` can drop toward 1.0 but is clamped above par by I-01b (loss below par requires governance action + social haircut, never silent).

---

## Summary

| ID | Title | Plain PUSD | PUSD+ |
|---|---|---|---|
| R-01 | Stablecoin depeg                    | ✔ (basket) | ✔ (slice + strategy) |
| R-02 | Admin key compromise                | ✔ | ✔ |
| R-03 | Rounding and dust                   | ✔ | ✔ |
| R-04 | Reentrancy                          | ✔ | ✔ |
| R-05 | Unbounded loop gas                  | ✔ | — |
| R-06 | Preferred-fee gaming                | ✔ | — |
| R-07 | ~~Treasury not set~~ (retired)      | — | — |
| R-08 | Upgrade storage corruption          | ✔ | ✔ |
| R-09 | LP fragility (new)                  | — (isolated) | ✔ |

Plain PUSD's risk surface stays small and static. PUSD+ takes on everything plain PUSD does, plus R-09. That is the honest tradeoff for its yield.

# Risks

Known failure modes of the two-tier PUSD protocol and the mitigations that exist today.

This replaces the v1 risk register. R-07 retires under ADR 0003; R-09 is added for the strategy engine.

---

## R-01 — Stablecoin depeg

**Scenario:** One of the underlying stablecoins (USDC, USDT, DAI, USDS, crvUSD, etc.) loses peg. The reserve holds it at nominal value, but mass redemption of plain PUSD into that asset drains the healthy ones.

**Affects:** Both PUSD and PUSD+, but with different blast radius.
- **Plain PUSD:** Only `parReserve` is exposed. If USDC depegs, `parReserve[USDC]` is worth less than par but the other slices (USDT, DAI, etc.) are still par. Redemption switches to basket or emergency mode.
- **PUSD+:** `yieldShareReserve[USDC]` and any USDC deployed in `PUSDLiquidity` take the full hit. `pps` may drop toward but not below 1.0 (clamped by I-01b).

**Mitigations:**
- `TokenStatus` transitions: admin can move the depegged token to `REDEEM_ONLY` or `EMERGENCY_REDEEM` within minutes.
- Rate-bearing wrappers (sDAI, sUSDe) diversify the reserve across multiple issuer trust assumptions.
- Basket redeem protects healthy-asset holders from adverse selection.
- `PUSDPlus.pause()` is available to freeze deposits/withdraws during an active depeg event.

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

## R-09 — Strategy failure  *(new, v2)*

**Scenario:** A deployed strategy (Aave market, Curve pool, Morpho market) is exploited, pauses, or suffers a correlated loss. Loss hits `PUSDLiquidity.netAssetsInPUSD()` and reduces `pps`.

**Affects:** PUSD+ holders only. Plain PUSD is mechanically isolated by the reserve slicing (I-01).

**Failure modes:**
- **Adapter bug** — a new adapter has a coding error. Mitigated by: adapter whitelist via `ADMIN_ROLE`, per-adapter cap (`strategyCapBps`), each adapter shipping with dedicated unit + fork tests + external review.
- **Strategy exploit** — the underlying protocol (Aave/Curve/Morpho) is exploited. Mitigated by: diversification across strategies; `emergencyUnwind(adapter)` path; `PUSDPlus.pause()`.
- **Slippage / stress** — a user redeem triggers a large unwind at bad price. Mitigated by: the 35% cap bounding deployed size; keeper proactively unwinds ahead of known redeem backlog; ERC-7540 queue path (future ADR 0005) for oversized requests.
- **Oracle manipulation** — an adapter relies on a manipulated oracle for `balanceInPUSD()`. Mitigated by: adapters MUST use the same pricing path as the underlying protocol's withdraw; no independent oracle assumptions.

**Residual risk:** Correlated failure across multiple strategies during a systemic event. PUSD+ `pps` can drop toward 1.0 but is clamped above par by I-01b (loss below par requires governance action + social haircut, never silent).

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
| R-09 | Strategy failure (new)              | — (isolated) | ✔ |

Plain PUSD's risk surface stays small and static. PUSD+ takes on everything plain PUSD does, plus R-09. That is the honest tradeoff for its yield.

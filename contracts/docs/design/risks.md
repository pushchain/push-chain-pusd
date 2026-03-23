# Risks & Mitigations

## R-01 – Stablecoin De-peg

**Risk:** A supported stablecoin (e.g. USDT) loses its USD peg, making the PUSD basket under-collateralised.

**Impact:** High. Holders cannot fully redeem 1:1 against healthy assets.

**Mitigations:**
- Admin can set the de-pegged token to `REDEEM_ONLY` immediately, stopping new deposit exposure.
- Admin can escalate to `EMERGENCY_REDEEM`, which forces proportional redemption against that token so its balance drains into user hands rather than accumulating risk.
- Rebalance function lets admin swap out at-risk tokens for healthier ones (1:1 PUSD value, admin supplies external liquidity).

**Residual risk:** Between the de-peg event and admin response, new depositors can still mint PUSD against the de-pegged token. Response latency is a key operational risk.

---

## R-02 – Admin Key Compromise

**Risk:** The `ADMIN_ROLE` private key is compromised, allowing an attacker to drain the treasury, manipulate fees, or misconfigure tokens.

**Impact:** Critical. `ADMIN_ROLE` can call `rebalance` to receive any token from the contract and set `treasuryReserve` to an attacker address before sweeping.

**Mitigations:**
- `ADMIN_ROLE` should be a multisig (e.g. Gnosis Safe) with a meaningful threshold.
- `rebalance` requires providing `amountIn` of `tokenIn` — the admin cannot receive tokens for free; they must supply equal value.
- Fee parameters are capped by setter guards, limiting fee-based extraction.

**Residual risk:** A multisig compromise is still possible. Timelocked upgrades are not currently implemented.

---

## R-03 – UUPS Upgrade Risk

**Risk:** An upgrade to either `PUSD` or `PUSDManager` introduces a vulnerability or changes storage layout incorrectly, corrupting state.

**Impact:** Critical.

**Mitigations:**
- `UPGRADER_ROLE` is separate from `ADMIN_ROLE` and should require a higher-security path (e.g. governance vote + timelock).
- OpenZeppelin's `UUPSUpgradeable` pattern requires the upgrade authorisation to be in the implementation, preventing a proxy admin from upgrading to an arbitrary address.

**Residual risk:** No timelock or governance is currently enforced on-chain. Relies entirely on key management.

---

## R-04 – Decimal Truncation

**Risk:** For tokens with fewer than 6 decimals, `_convertFromPUSD` uses integer division and truncates. Small PUSD amounts may round to 0 tokens sent to the user.

**Impact:** Low (user loses dust). The rounding always favours the protocol, never the user — consistent with invariant I-08.

**Mitigations:**
- Users are implicitly protected by the `require(amount > 0)` guard at the entry of `redeem`.
- Sub-unit amounts of low-decimal tokens are economically insignificant.

---

## R-05 – Basket Redemption Gas Cost

**Risk:** With many supported tokens, `_executeBasketRedeem` iterates the full `tokenList` twice. Gas cost scales linearly with `tokenCount`.

**Impact:** Medium. At a large number of tokens a basket redeem may become prohibitively expensive or exceed block gas limits.

**Mitigations:**
- Admin should keep `tokenCount` small and promptly `REMOVE` defunct tokens.
- `REMOVED` tokens are skipped in the loop (`continue` on `status == REMOVED`), but the array slot is not reclaimed — the index still consumes an iteration.

**Residual risk:** There is no maximum `tokenCount` enforced on-chain. A governance/documentation-level limit should be established.

---

## R-06 – Liquidity Fragmentation

**Risk:** If redemption is fragmented across many low-liquidity tokens (basket path), users receive multiple small token transfers in one transaction. Some tokens may have insufficient balance to cover rounding dust, causing the transaction to revert.

**Impact:** Low-medium. The rounding remainder logic allocates to the most-liquid token, but relies on that token having at least `remainingPUSD` in available liquidity after the proportional distribution.

**Mitigations:**
- Basket redemption verifies `totalLiquidityPUSD >= pusdAmount` upfront.
- The rounding remainder safety check `require(maxLiquidity >= remainingPUSD)` prevents silent loss.

---

## R-07 – Treasury Not Set

**Risk:** If `treasuryReserve` is never configured, fees and haircuts accumulate in the contract indefinitely and cannot be swept.

**Impact:** Low (no fund loss; revenue is locked, not lost).

**Mitigations:**
- `sweepAllSurplus` requires `treasuryReserve != address(0)` at the top.
- Deployment scripts should configure `treasuryReserve` as part of the setup sequence.

---

## R-08 – Front-Running Preferred Fee

**Risk:** The preferred fee is calculated dynamically based on live pool balances. A sophisticated user could observe a pending large redemption of the same token and front-run it to avoid the higher fee that would result from the reduced liquidity share.

**Impact:** Low (fee arbitrage; no fund loss).

**Mitigations:** Acceptable trade-off; fee impact is bounded by `preferredFeeMax` (≤ 2%).

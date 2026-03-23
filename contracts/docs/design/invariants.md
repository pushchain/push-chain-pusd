# Protocol Invariants

These properties must hold at all times across all reachable states. They are the ground truth for fuzz testing, formal verification, and code review.

---

## I-01 – Full Collateralisation

> For every supported token `t`, the contract's balance of `t` is at least equal to the PUSD-equivalent amount that could be redeemed against it plus the reserved surplus.

More precisely, at any point after a transaction completes:

```
∀ token t:
  IERC20(t).balanceOf(PUSDManager)
    >= accruedFees[t] + accruedHaircut[t]
```

The total PUSD supply is backed across all tokens collectively:

```
PUSD.totalSupply()
  <= Σ _normalizeDecimalsToPUSD(
       IERC20(t).balanceOf(PUSDManager) - accruedFees[t] - accruedHaircut[t],
       tokenInfo[t].decimals
     )
  for all t where status != REMOVED
```

---

## I-02 – Surplus Ring-Fence

> `accruedFees[t] + accruedHaircut[t]` is always ≤ `IERC20(t).balanceOf(PUSDManager)`.

This is enforced by:
- `deposit` pulling the full `amount` (including haircut) before recording haircut.
- `_executeRedeem` computing `feeAmount` from `tokenAmount` and only transferring `tokenAmount - feeAmount`.
- `rebalance` explicitly checking `tokenOutBalance >= amountOut + reservedSurplus` before proceeding.

---

## I-03 – Mint Only on Deposit

> PUSD can only be minted by `PUSDManager` via `deposit()`. No other path calls `PUSD.mint()`.

Enforced by `MINTER_ROLE` being held exclusively by `PUSDManager`.

---

## I-04 – Burn Before (or with) Transfer

> In every redemption path, `PUSD.burn()` is called before or atomically with the outbound token transfer. The user cannot receive tokens without their PUSD being burned.

- Single-token redeem: `_executeRedeem` is called with `shouldBurn=true`; burn happens before `safeTransfer`.
- Basket / emergency redeem: `PUSD.burn()` called once upfront; individual `_executeRedeem` calls use `shouldBurn=false`.

---

## I-05 – Fee Bounds

> Fee parameters are bounded by admin setter guards:

| Parameter | Max |
|---|---|
| `baseFee` | 100 bps (1%) |
| `preferredFeeMax` | 200 bps (2%) |
| `surplusHaircutBps` | 4000 bps (40%) |
| `preferredFeeMin` | must be ≤ `preferredFeeMax` |

---

## I-06 – No Self-Rebalance

> `rebalance(tokenIn, amountIn, tokenOut, amountOut)` requires `tokenIn != tokenOut`.

---

## I-07 – Value Conservation on Rebalance

> `rebalance` requires `_normalizeDecimalsToPUSD(amountIn, decimalsIn) == _normalizeDecimalsToPUSD(amountOut, decimalsOut)`.

No PUSD is minted or burned during rebalance; total supply is unchanged.

---

## I-08 – Decimal Normalisation Consistency

> `_normalizeDecimalsToPUSD` and `_convertFromPUSD` are exact inverses when `tokenDecimals >= 6`. For `tokenDecimals < 6` there is potential truncation, but the user always receives weakly less than they are owed (never more).

---

## I-09 – Token Status Monotonicity (soft)

> `REMOVED` is a terminal state. Once a token is set to `REMOVED`, `addSupportedToken` cannot add it again (it still `exists` in the mapping). Only an upgrade can clear `exists`.

---

## I-10 – Reentrancy Safety

> `deposit`, `redeem`, `rebalance`, and `sweepAllSurplus` are all guarded by the `nonReentrant` modifier using the `_status` flag (values `_NOT_ENTERED=1`, `_ENTERED=2`).

---

## I-11 – Zero-Address Guards

> Neither PUSD nor PUSDManager accepts `address(0)` in initialisation or privileged setters:
- `PUSD.mint`: `to != address(0)`.
- `PUSD.burn`: `from != address(0)`.
- `PUSDManager.initialize`: `_pusd != address(0)` and `admin != address(0)`.
- `PUSDManager.setTreasuryReserve`: `newTreasuryReserve != address(0)`.

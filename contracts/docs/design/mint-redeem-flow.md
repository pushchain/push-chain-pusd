# Mint & Redeem Flow

## Deposit (Mint)

```
User calls: PUSDManager.deposit(token, amount)
```

### Preconditions
- `token` must have `status == ENABLED`.
- `amount > 0`.
- User has approved `PUSDManager` to spend at least `amount` of `token`.

### Steps

```
1. Load TokenInfo for token
2. surplusTokenAmount = amount * surplusHaircutBps / 10000
3. netTokenAmount     = amount - surplusTokenAmount
4. safeTransferFrom(user → PUSDManager, amount)          // full amount including haircut
5. accruedHaircut[token] += surplusTokenAmount           // haircut stays in contract
6. pusdAmount = normalizeDecimalsToPUSD(netTokenAmount, tokenDecimals)
7. PUSD.mint(user, pusdAmount)
8. emit Deposited(user, token, amount, pusdAmount, surplusTokenAmount)
```

### Exchange rate

`pusdMinted = (amount - haircut) * 10^(6 - tokenDecimals)` (when tokenDecimals ≤ 6)

For a 6-decimal token with no haircut: **1 token unit = 1 PUSD unit**.

---

## Redeem

```
User calls: PUSDManager.redeem(pusdAmount, preferredAsset, allowBasket)
```

The function routes to one of three execution paths:

```
                      redeem()
                         │
              ┌──────────▼──────────┐
              │  hasEmergencyTokens? │
              └──────────┬──────────┘
                         │
          ┌──────────────┴──────────────────┐
         No                                Yes
          │                                 │
    ┌─────▼──────────────┐      ┌───────────▼──────────────┐
    │ preferredAsset      │      │ preferredAsset valid?     │
    │ valid & sufficient? │      └───────────┬──────────────┘
    └─────┬──────────────┘                  │
          │                         ┌───────▼───────┐
       Yes │  No                   Yes              No
          │   │                     │               │
          ▼   ▼                     ▼               ▼
    Single  allowBasket?    Emergency Redeem    revert
    Token   ─────┬─────
    Redeem  Yes  │  No
                 │   └──► revert
                 ▼
            Basket Redeem
```

### Path 1 – Single-token redeem (preferred asset available, no emergency)

```
1. requiredAmount = convertFromPUSD(pusdAmount, preferredDecimals)
2. Check availableLiquidity(preferredAsset) >= requiredAmount
3. preferredFee = calculatePreferredFee(preferredAsset)  // 0..preferredFeeMax bps
4. totalFee = baseFee + preferredFee
5. _executeRedeem(preferredAsset, pusdAmount, requiredAmount, shouldBurn=true, totalFee)
   ├─ PUSD.burn(user, pusdAmount)
   ├─ feeAmount = requiredAmount * totalFee / 10000
   ├─ accruedFees[token] += feeAmount
   └─ safeTransfer(token → user, requiredAmount - feeAmount)
```

### Path 2 – Basket redeem (preferred unavailable, user opts in)

```
1. Compute availableLiquidity[i] in PUSD terms for every non-REMOVED token
2. Verify sum >= pusdAmount
3. PUSD.burn(user, pusdAmount)                           // burned once upfront
4. For each token i (proportional to its liquidity share):
   tokenSharePUSD = pusdAmount * liquidity[i] / totalLiquidity
   tokenAmount    = convertFromPUSD(tokenSharePUSD, decimals[i])
   _executeRedeem(token, tokenSharePUSD, tokenAmount, shouldBurn=false, baseFee)
5. Any rounding remainder allocated to the most-liquid token
```

Note: `baseFee` (not `baseFee + preferredFee`) is applied to each basket leg.

### Path 3 – Emergency redeem (at least one EMERGENCY_REDEEM token has balance)

```
1. Build liquidity set: preferredAsset + all EMERGENCY_REDEEM tokens only
2. Verify sum >= pusdAmount
3. PUSD.burn(user, pusdAmount)
4. Distribute proportionally across that set (same algorithm as basket)
5. baseFee applied per leg
```

This path forces proportional drainage of the at-risk token(s) regardless of user preference.

---

## Available Liquidity

Internal liquidity for any token excludes reserved surplus:

```
availableLiquidity(token) = balanceOf(PUSDManager, token)
                           - accruedFees[token]
                           - accruedHaircut[token]
```

Surplus is ring-fenced so rebalance and redemptions cannot accidentally spend it before it is swept to treasury.

---

## Surplus Sweep

```
Admin calls: PUSDManager.sweepAllSurplus()
```

- Iterates all tokens in `tokenList`.
- For each token with `accruedFees[token] + accruedHaircut[token] > 0`:
  - Transfers total to `treasuryReserve`.
  - Increments `sweptFees` / `sweptHaircut` historical counters.
  - Resets `accruedFees` / `accruedHaircut` to 0.

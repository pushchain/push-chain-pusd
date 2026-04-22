# Mint & Redeem Flow

The protocol supports four user flows, all of which route through `PUSDManager`:

1. **Deposit** — user deposits stablecoin, receives plain **PUSD**.
2. **Wrap** — user deposits stablecoin, receives **PUSD+** (the default UX).
3. **Redeem** — user burns PUSD, receives stablecoin.
4. **Unwrap** — user burns PUSD+, receives stablecoin (or PUSD, in the ERC-4626 path).

All four flows are atomic. Nothing queues unless the yield tier lacks sufficient instant-unwind capacity, and even then, only Unwrap is affected.

The authoritative architecture for the two reserve slices is in [ADR 0003 §3](decisions/0003-product-architecture.md).

---

## 1. Deposit — plain PUSD

Mints plain PUSD against the `parReserve` slice.

```
┌────────┐   1. approve(token, amount)   ┌───────────────┐
│  user  │──────────────────────────────▶│     token     │
└────┬───┘                               └───────────────┘
     │  2. deposit(token, amount)
     ▼
┌───────────────────────────────────────────────────────┐
│  PUSDManager.deposit(token, amount)                   │
│  ─ pull `amount` of token from user                   │
│  ─ haircut := amount * surplusHaircutBps / 10_000     │
│  ─ parReserve[token]   += (amount - haircut)          │
│  ─ accruedHaircut[token] += haircut                   │
│  ─ pusdAmount := normalize(amount - haircut)          │
│  ─ PUSD.mint(user, pusdAmount)                        │
└───────────────────────────────────────────────────────┘
     │
     ▼
   user holds pusdAmount PUSD
```

Notes:
- **Always 1:1 in USD terms.** No slippage. No NAV to worry about. The haircut exists to build a surplus buffer, not to drift the price — PUSD is always $1.
- **`parReserve` only.** No strategy risk. No yield accrual.
- `TokenStatus` must be `ENABLED` for deposit to succeed.

---

## 2. Wrap — PUSD+ (default)

Atomically deposits stablecoin and mints PUSD+ shares in a single transaction.

```
┌────────┐   1. approve(token, amount)   ┌───────────────┐
│  user  │──────────────────────────────▶│     token     │
└────┬───┘                               └───────────────┘
     │  2. PUSDPlus.depositStable(token, amount, user)
     ▼
┌─────────────────────────────────────────────────────┐
│  PUSDPlus.depositStable                             │
│  ─ transferFrom(user, PUSDPlus, amount)             │
│  ─ approve(PUSDManager, amount)                     │
│  ─ pusdMinted :=                                    │
│      PUSDManager.mintForVault(token, amount, self)  │
│  ─ shares := convertToShares(pusdMinted)            │
│  ─ _mint(user, shares)                              │
│  ─ emit Deposit(user, self, amount, shares)         │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│  PUSDManager.mintForVault (VAULT_ROLE only)         │
│  ─ pull `amount` of token from PUSDPlus             │
│  ─ no haircut on vault-path deposits (§policy)      │
│  ─ yieldShareReserve[token] += amount               │
│  ─ pusdAmount := normalize(amount)                  │
│  ─ PUSD.mint(PUSDPlus, pusdAmount)                  │
│  ─ return pusdAmount                                │
└─────────────────────────────────────────────────────┘
     │
     ▼
   user holds `shares` PUSD+;
   PUSDPlus holds pusdAmount PUSD;
   yieldShareReserve[token] incremented by amount
```

Why the haircut is waived on the vault path: the haircut exists to deter churn on plain-PUSD flows and to build a par-side surplus buffer. PUSD+ users already pay the performance fee on yield; stacking a mint-time haircut on top creates double friction. Admin-configurable `vaultHaircutBps` defaults to 0 but can be raised if needed.

### What the user pays

- **Deposit cost:** always 1:1 USD. $1,000 USDC → $1,000 worth of PUSD+ shares.
- **NAV at deposit:** PUSD+ issues `pusdAmount / currentPPS` shares. As `pps` grows over time, a user who deposits later pays the same USD but gets fewer shares — this is correct ERC-4626 behaviour.

### What the vault earns

The deposited capital now sits in `yieldShareReserve[token]`. PUSDLiquidity can pull up to 35% of PUSD+ total assets for active strategies. The remainder stays in PUSDManager, ideally in a rate-bearing wrapper (sDAI, USDY, etc.) to earn passive yield.

---

## 3. Redeem — plain PUSD

Burns PUSD and returns stablecoin from `parReserve`.

### Three paths (unchanged semantics from v1, but scoped to `parReserve` only)

Given `redeem(pusdAmount, preferredAsset, allowBasket)`:

**Path A — Preferred (single-asset).** Used when `_getAvailableLiquidity(preferredAsset) >= pusdAmountInToken`, where availability is computed from `parReserve[preferredAsset] - ...` (not total balance).
```
fee := preferredFeeBps(preferredAsset)  // 10–200 bps, depends on pool composition
tokenOut := pusdAmountInToken * (10_000 - fee) / 10_000
parReserve[preferredAsset] -= tokenOut + fee
accruedFees[preferredAsset] += fee
PUSD.burn(user, pusdAmount)
token.safeTransfer(user, tokenOut)
```

**Path B — Basket (proportional).** Used when preferred is insufficient AND `allowBasket == true`. Sum the available liquidity (in `parReserve`) across all non-removed tokens. Split `pusdAmount` proportionally. Apply `baseFee` per leg.

**Path C — Emergency.** Used when `_hasEmergencyTokens() == true`. Basket limited to preferred + tokens with status `EMERGENCY_REDEEM`. Purpose: drain illiquid stables during a crisis without forcing the whole basket to be used.

All three paths touch only `parReserve`. **Strategy risk cannot affect plain-PUSD redemption.**

---

## 4. Unwrap — PUSD+

Burns PUSD+ shares and returns stablecoin from `yieldShareReserve`, drawing on `PUSDLiquidity` as needed.

```
┌────────┐  redeemToStable(shares, token, user)
│  user  │────────────────────────────────────┐
└────────┘                                    │
                                              ▼
┌─────────────────────────────────────────────────────┐
│  PUSDPlus.redeemToStable                            │
│  ─ pusdOwed := convertToAssets(shares)              │
│  ─ _burn(user, shares)                              │
│  ─ check: PUSD.balanceOf(self) + allowanceFrom      │
│           PUSDManager covers pusdOwed               │
│  ─ PUSD.approve(PUSDManager, pusdOwed)              │
│  ─ tokenOut := PUSDManager.redeemForVault(          │
│       pusdOwed, token, user)                        │
│  ─ emit Withdraw(self, user, tokenOut, shares)      │
└──────────────┬──────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────┐
│  PUSDManager.redeemForVault (VAULT_ROLE only)       │
│  ─ PUSD.burn(PUSDPlus, pusdOwed)                    │
│  ─ needInToken := convertFromPUSD(pusdOwed, decs)   │
│  ─ if yieldShareReserve[token] >= needInToken:      │
│        yieldShareReserve[token] -= needInToken      │
│        token.safeTransfer(user, needInToken)        │
│    else:                                            │
│        shortfall := needInToken                     │
│                     - yieldShareReserve[token]      │
│        yieldShareReserve[token] = 0                 │
│        PUSDLiquidity.pullForWithdraw(               │
│            token, shortfall, user)                  │
│        // PUSDLiquidity unwinds smallest-hit        │
│        // adapter and sends token directly to user  │
│  ─ return needInToken                               │
└─────────────────────────────────────────────────────┘
```

### Instant vs. async

- **Instant** whenever `yieldShareReserve[token] + PUSDLiquidity.idleBalance(token) >= needInToken`.
- **Instant** whenever the requested amount can be satisfied by unwinding a single adapter (e.g. Aave v3 supply withdraws are atomic).
- **Async** only when the requested amount exceeds instant capacity. In that case, launch ships with a conservative fallback: the call reverts with `InsufficientLiquidity()`, and the frontend shows an "Unwinding strategies — try again in ~10 min" state. PUSDLiquidity's keeper unwinds proactively.
- A future ADR (0005 candidate) introduces an ERC-7540-style queue for truly large withdraws.

### PUSD+ never allows withdraw below par

Invariant I-01b: if unwinding strategies at stress would produce less PUSD than the shares imply at `pps >= 1.0`, the redeem reverts rather than pay at below-par NAV. Users can still use the pure ERC-4626 `redeem(shares, ...)` path to receive PUSD, which is always possible from the vault's PUSD balance + an on-demand mint against `yieldShareReserve`.

---

## Where available liquidity comes from

### Plain PUSD (`_getAvailableLiquidity` for `redeem`)

```
availableLiquidity(token) = parReserve[token]
                          - accruedFees[token]         // already ring-fenced
                          - accruedHaircut[token]      // already ring-fenced
```

Note: this is the v1 formula but scoped to `parReserve` instead of the whole balance. The surplus buffers (`accruedFees` + `accruedHaircut`) keep their same role: they are reserve-like pools for admin sweep and haircut-funded safety margin.

### PUSD+ (`availableForVaultWithdraw`)

```
availableForVaultWithdraw(token) =
    yieldShareReserve[token]
  + PUSDLiquidity.idleBalance(token)
  + sum over adapters of instantUnwindCapacity(token)
```

`instantUnwindCapacity` is per-adapter; e.g. Aave v3 returns a large number (essentially min(supplied, protocol liquidity)); Curve LP returns the LP-equivalent of the pool's current depth for that token.

---

## Fee / haircut model (summary)

- `surplusHaircutBps` — applied on **plain deposits** only. Builds par-side buffer. Max 40%.
- `baseFee` — applied on **plain redeems** when routed through basket or as fallback. Max 1%.
- `preferredFee` — applied on **plain preferred-asset redeems**. 10–200 bps sliding with pool composition.
- `performanceFeeBps` — applied on **PUSD+ NAV gains** only. Default 10%, max 20%.

No fee on PUSD+ deposit (`vaultHaircutBps` default 0). No fee on PUSD+ share-→share transfers.

---

## Summary table

| Flow | Touches slice | Fee | Latency | Price |
|---|---|---|---|---|
| Deposit (plain PUSD) | `parReserve` | haircut 0–40% | instant | 1 PUSD = $1 |
| Wrap (PUSD+ default) | `yieldShareReserve` | 0 (launch) | instant | shares at current NAV |
| Redeem (plain PUSD) — preferred | `parReserve` | 10–200 bps | instant | 1 PUSD = $1 − fee |
| Redeem (plain PUSD) — basket | `parReserve` (all tokens) | `baseFee` per leg | instant | 1 PUSD = $1 − fee |
| Unwrap (PUSD+) — idle | `yieldShareReserve` | 0 | instant | at current NAV |
| Unwrap (PUSD+) — with unwind | `yieldShareReserve` + adapter | 0 + strategy slippage | instant or async | at current NAV |

See [invariants.md](invariants.md) for the safety properties enforced by these flows.

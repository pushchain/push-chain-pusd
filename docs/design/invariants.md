# Invariants

Protocol-level safety properties. Every invariant must hold after every external state-changing transaction.

The machine-readable version for fuzz/formal tooling is in [`/agents/invariants.context.md`](../../agents/invariants.context.md).

---

## I-01 — Full Collateralisation (extended for v2)

For every non-REMOVED token `t`:

```
IERC20(t).balanceOf(PUSDManager)
  == parReserve[t]
   + yieldShareReserve[t]
   + accruedFees[t]
   + accruedHaircut[t]
```

And:

```
PUSD.totalSupply()
  == sum over non-REMOVED tokens of:
       _normalizeDecimalsToPUSD(parReserve[t], decimals(t))
     + sum of PUSD held by PUSDPlus that is matched by yieldShareReserve
       = _normalizeDecimalsToPUSD(yieldShareReserve[t], decimals(t))
         - (PUSD in flight during a vault operation, bounded to atomic frames)
```

Intuition: every PUSD in existence corresponds to exactly one dollar's worth of stablecoin held in PUSDManager, assigned to exactly one of the two slices. Supply ≠ idle balance is permissible only inside a single non-reentrant function frame.

**Foundry stub**
```solidity
function invariant_fullCollateralisation() public {
    for (uint256 i = 0; i < manager.tokenCount(); i++) {
        address t = manager.getSupportedTokenAt(i);
        if (manager.getTokenStatus(t) == PUSDManager.TokenStatus.REMOVED) continue;

        uint256 bal = IERC20(t).balanceOf(address(manager));
        uint256 sum = manager.parReserve(t)
                    + manager.yieldShareReserve(t)
                    + manager.accruedFees(t)
                    + manager.accruedHaircut(t);
        assertEq(bal, sum, "I-01: balance != sum of slices");
    }
}
```

---

## I-01b — PUSD+ Never Below Par  *(new, v2)*

```
PUSDPlus.convertToAssets(10**18)  // 1 share's worth, up-normalised
  >= 10**pusdDecimals            // at least 1 PUSD per share
```

Equivalently:
```
pps := PUSDPlus.totalAssets() * 1e18 / PUSDPlus.totalSupply()
pps >= 1e18   // monotonic non-decrease required
```

The vault may lose value internally (strategy drawdown), but user-facing `pps` is clamped ≥ 1. Losses below par are absorbed by:
1. The `performanceFee` crystallisation pool (rewards not yet distributed).
2. A `protocolLossBuffer` funded by a slice of performance fees (optional v2+).
3. A governance-triggered socialised haircut (documented, but not silent).

**Foundry stub**
```solidity
function invariant_pusdPlusAboveParGlobal() public {
    uint256 supply = pusdPlus.totalSupply();
    if (supply == 0) return;
    uint256 assets = pusdPlus.totalAssets();
    assertGe(assets * 1e18 / supply, 1e18, "I-01b: pps < 1.0");
}
```

---

## I-02 — Surplus Ring-Fence (unchanged)

For every token (including REMOVED during pending sweep):

```
IERC20(t).balanceOf(PUSDManager)
  >= accruedFees[t] + accruedHaircut[t]
```

The surplus is never double-counted against `parReserve` or `yieldShareReserve`.

---

## I-03 — Mint Only via PUSDManager (extended for v2)

```
PUSD.totalSupply() increases iff
  msg.sender == PUSDManager AND
    call stack contains either
      PUSDManager.deposit()     // plain path
      OR
      PUSDManager.mintForVault() // vault path, caller == PUSDPlus
```

PUSDPlus never has `MINTER_ROLE` directly. No other contract holds `MINTER_ROLE` or `BURNER_ROLE`.

---

## I-04 — Burn Before Transfer (extended for v2)

In every redemption transaction, whether `redeem` or `redeemForVault`:
```
PUSD.burn() is called before (or in the same call frame as) safeTransfer(token → receiver)
pusdBurned == pusdAmount requested
```

---

## I-05 — Fee Bounds

```
baseFee          <= 100
preferredFeeMax  <= 200
preferredFeeMin  <= preferredFeeMax
surplusHaircutBps[t] <= 4000   for all tokens
performanceFeeBps <= 2000      (PUSDPlus)
```

---

## I-06 — No Self-Rebalance

`PUSDManager.rebalance(tokenIn, _, tokenOut, _)` requires `tokenIn != tokenOut`.

---

## I-07 — Value Conservation on Rebalance (extended)

Rebalance must preserve the invariant:
```
sum of normalised parReserve across all tokens before == after
sum of normalised yieldShareReserve across all tokens before == after
```

I.e. rebalance acts on each slice independently. No cross-slice value transfer unless explicitly approved by governance (a separate `reclassify(token, fromSlice, toSlice, amount)` function protected by `ADMIN_ROLE`).

---

## I-08 — Decimal Normalisation Non-Inflation

```
∀ (amount, tokenDecimals):
  convertFromPUSD(normalizeDecimalsToPUSD(amount, tokenDecimals), tokenDecimals)
    <= amount
```

Round-trip never inflates token amounts.

---

## I-09 — REMOVED is Terminal

Once `supportedTokens[t].status == REMOVED`, no re-add via `addSupportedToken` is possible (guarded by `exists == true`).

---

## I-10 — Reentrancy Safety (extended for v2)

Both PUSDManager's and PUSDPlus's non-reentrant functions respect the guard. In addition:
- `PUSDManager.mintForVault` is `nonReentrant` and can only be called by PUSDPlus.
- `PUSDManager.redeemForVault` is `nonReentrant` and may call `PUSDLiquidity.pullForWithdraw`, which is itself `nonReentrant` — no reentrant back into PUSDManager.
- `PUSDPlus.depositStable` and `redeemToStable` are `nonReentrant`.
- `PUSDLiquidity.deployToStrategy` and `withdrawFromStrategy` are `nonReentrant`.

Cross-contract call graph forms a DAG: PUSDPlus → PUSDManager → PUSDLiquidity. No cycles.

---

## I-11 — Zero-Address Guards (extended for v2)

```
PUSD.mint(to, _)                   requires to   != address(0)
PUSD.burn(from, _)                 requires from != address(0)
PUSDManager.initialize             requires _pusd != 0
PUSDManager.setPUSDPlus(v)         requires v != 0
PUSDManager.setTreasuryReserve(a)  requires a != 0
PUSDPlus.initialize                requires asset, manager, admin all != 0
PUSDLiquidity.initialize           requires vault, manager, admin all != 0
```

---

## I-12 — Deploy Cap  *(new, v2)*

```
PUSDLiquidity.totalDeployedInPUSD()
  <= maxDeployableBps * PUSDPlus.totalAssets() / 10_000

and maxDeployableBps <= 3_500 (hard ceiling)
```

Enforced in both `deployToStrategy` (entry check) and the `invariant_*` fuzz suite. Raising the cap requires governance + a new ADR.

**Foundry stub**
```solidity
function invariant_deployCap() public {
    uint256 deployed = liquidity.totalDeployedInPUSD();
    uint256 allowed  = liquidity.maxDeployableBps() * pusdPlus.totalAssets() / 10_000;
    assertLe(deployed, allowed, "I-12: deployed > allowed");
    assertLe(liquidity.maxDeployableBps(), 3_500, "I-12: cap > hard ceiling");
}
```

---

## Retired invariants

- **R-07 (v1): Treasury Not Set** — retired. Under ADR 0003, plain-PUSD holders are not owed yield, so a missing treasury no longer contaminates the settlement token. Surplus sweep still behaves as in v1; `treasuryReserve == address(0)` simply means sweeps revert and fees accrue on the ledger.

## Summary

| ID | Type | Area |
|---|---|---|
| I-01  | global     | PUSDManager collateralisation with v2 slice split |
| I-01b | global     | PUSD+ NAV never below par (new) |
| I-02  | global     | Surplus ring-fence |
| I-03  | per-tx     | PUSD mint authority (PUSDManager only; vault path via mintForVault) |
| I-04  | per-tx     | Burn precedes transfer on redeem |
| I-05  | global     | Fee bounds |
| I-06  | per-tx     | No self-rebalance |
| I-07  | per-tx     | Value conservation on rebalance, per slice |
| I-08  | per-tx     | Decimal normalisation non-inflation |
| I-09  | transition | REMOVED is terminal |
| I-10  | per-tx     | Reentrancy safety, cross-contract DAG |
| I-11  | per-tx     | Zero-address guards |
| I-12  | global     | Strategy deploy cap (new) |

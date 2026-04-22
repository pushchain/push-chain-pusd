# Invariants Context (Machine-Readable) — v2

Structured invariant list for fuzz testing (Foundry), formal verification (Halmos/Certora), or LLM-assisted audit.

Each invariant has:
- **ID** — stable identifier, matches [docs/design/invariants.md](../docs/design/invariants.md).
- **Type** — `global` (holds after every tx), `per-tx` (holds within a single call), or `transition` (governs state changes).
- **Solidity expression** — executable predicate where possible.

---

## I-01 — Full Collateralisation (v2)

```
type: global
contracts: [PUSDManager, PUSD]

∀ token ∈ tokenList where status != REMOVED:
  IERC20(token).balanceOf(PUSDManager)
    == parReserve[token]
     + yieldShareReserve[token]
     + accruedFees[token]
     + accruedHaircut[token]

PUSD.totalSupply() ==
  (sum over non-REMOVED tokens of normalize(parReserve[t], decimals(t)))
  + (PUSD held by PUSDPlus, == normalized yieldShareReserve and the NAV component)
```

**Foundry stub**
```solidity
function invariant_slicedCollateralisation() public {
    for (uint256 i = 0; i < manager.tokenCount(); i++) {
        address t = manager.getSupportedTokenAt(i);
        if (manager.getTokenStatus(t) == PUSDManager.TokenStatus.REMOVED) continue;

        uint256 bal = IERC20(t).balanceOf(address(manager));
        uint256 sum = manager.parReserveOf(t)
                    + manager.yieldShareReserveOf(t)
                    + manager.getAccruedFees(t)
                    + manager.getAccruedHaircut(t);
        assertEq(bal, sum, "I-01: balance != sum of slices");
    }
}
```

---

## I-01b — PUSD+ Never Below Par  *(new, v2)*

```
type: global
contracts: [PUSDPlus]

PUSDPlus.totalSupply() == 0 OR
  PUSDPlus.totalAssets() * 1e18 / PUSDPlus.totalSupply() >= 1e18
```

**Foundry stub**
```solidity
function invariant_pusdPlusAboveParGlobal() public {
    uint256 supply = pusdPlus.totalSupply();
    if (supply == 0) return;
    uint256 pps = pusdPlus.totalAssets() * 1e18 / supply;
    assertGe(pps, 1e18, "I-01b: pps < 1.0");
}
```

---

## I-02 — Surplus Ring-Fence

```
type: global
contracts: [PUSDManager]

∀ token ∈ tokenList:
  IERC20(token).balanceOf(PUSDManager)
    >= accruedFees[token] + accruedHaircut[token]
```

---

## I-03 — Mint Authority (v2)

```
type: per-tx
contracts: [PUSD]

PUSD.totalSupply() increases iff
  msg.sender == PUSDManager AND
    (call stack contains PUSDManager.deposit
     OR
     call stack contains PUSDManager.mintForVault
        AND caller of mintForVault == PUSDPlus AND has VAULT_ROLE)
```

Fuzz property: no call sequence should cause `PUSD.totalSupply()` to increase unless routed through one of the two entry paths.

---

## I-04 — Burn Before Transfer (v2)

```
type: per-tx
contracts: [PUSDManager]

In every redemption (redeem | redeemForVault | basket | emergency):
  PUSD.burn() is called before (or in the same call frame as) safeTransfer(token → receiver)
  pusdBurned == pusdAmount requested
```

---

## I-05 — Fee Bounds (v2)

```
type: global

PUSDManager:
  baseFee                    <= 100
  preferredFeeMax            <= 200
  preferredFeeMin            <= preferredFeeMax
  ∀ t: supportedTokens[t].surplusHaircutBps <= 4000
  vaultHaircutBps            <= 500

PUSDPlus:
  performanceFeeBps          <= 2000
```

**Foundry stub**
```solidity
function invariant_feeBounds() public {
    assertLe(manager.baseFee(), 100, "I-05: baseFee");
    assertLe(manager.preferredFeeMax(), 200, "I-05: preferredFeeMax");
    assertLe(manager.preferredFeeMin(), manager.preferredFeeMax(), "I-05: preferredFeeMin > max");
    assertLe(manager.vaultHaircutBps(), 500, "I-05: vaultHaircutBps");
    assertLe(pusdPlus.performanceFeeBps(), 2000, "I-05: performanceFeeBps");
}
```

---

## I-06 — No Self-Rebalance

```
type: per-tx
contracts: [PUSDManager]

rebalance(tokenIn, _, tokenOut, _) requires tokenIn != tokenOut
```

---

## I-07 — Value Conservation on Rebalance (v2)

```
type: per-tx
contracts: [PUSDManager]

Before and after rebalance:
  sum over tokens of normalize(parReserve[t], decimals[t])       == unchanged
  sum over tokens of normalize(yieldShareReserve[t], decimals[t]) == unchanged

PUSD.totalSupply() unchanged by any rebalance.
```

---

## I-08 — Decimal Normalisation Non-Inflation

```
type: per-tx

∀ (amount, tokenDecimals):
  convertFromPUSD(normalizeDecimalsToPUSD(amount, tokenDecimals), tokenDecimals) <= amount
```

---

## I-09 — REMOVED is Terminal

```
type: transition
contracts: [PUSDManager]

once supportedTokens[t].status == REMOVED,
no call path can change it (guarded by exists == true)
```

---

## I-10 — Reentrancy Safety, Cross-Contract DAG (v2)

```
type: per-tx
contracts: [PUSDManager, PUSDPlus, PUSDLiquidity]

_status invariants on each contract's reentrancy guard:
  NOT_ENTERED at the start and end of every external call.

Call graph is a DAG:
  PUSDPlus     → PUSDManager
  PUSDPlus     → (implicit through Manager) → PUSDLiquidity
  PUSDManager  → PUSDLiquidity
  PUSDLiquidity → (leaf: only calls external protocols via adapters)

No cycles. No nonReentrant function calls another nonReentrant function on the same contract.
```

---

## I-11 — Zero-Address Guards (v2)

```
type: per-tx

PUSD.mint(to, _)                      requires to   != 0
PUSD.burn(from, _)                    requires from != 0

PUSDManager.initialize                requires _pusd != 0
PUSDManager.setPUSDPlus(v)            requires v != 0
PUSDManager.setTreasuryReserve(a)     requires a != 0
PUSDManager.setRateBearingWrapper(t,w,a)  v2 launch: w must be 0 (reserved)

PUSDPlus.initialize                   requires asset, manager, admin != 0
PUSDPlus.setPerformanceFeeRecipient(r) requires r != 0 (else disable)

PUSDLiquidity.initialize              requires vault, manager, npm, router, pool, usdc, usdt, admin != 0
PUSDLiquidity.setPool(p)              requires p != 0 && positions.length == 0
PUSDLiquidity.setRouter(r)            requires r != 0
```

---

## I-12 — Deploy Cap  *(new, v2)*

```
type: global
contracts: [PUSDLiquidity, PUSDPlus]

PUSDLiquidity.totalDeployedInPUSD()
  <= PUSDLiquidity.maxDeployableBps() * PUSDPlus.totalAssets() / 10_000

PUSDLiquidity.maxDeployableBps() <= PUSDLiquidity.HARD_CAP_BPS (= 5000)

PUSDLiquidity.idleInPUSD()
  >= PUSDLiquidity.emergencyLiquidityBps() * yieldShareReserveInPUSD / 10_000

PUSDLiquidity.positions.length <= PUSDLiquidity.MAX_POSITIONS (= 10)
```

**Foundry stub**
```solidity
function invariant_deployCap() public {
    uint256 deployed = liquidity.totalDeployedInPUSD();
    uint256 allowed  = liquidity.maxDeployableBps() * pusdPlus.totalAssets() / 10_000;
    assertLe(deployed, allowed, "I-12: deployed > global cap");
    assertLe(liquidity.maxDeployableBps(), liquidity.HARD_CAP_BPS(), "I-12: cap > hard ceiling");
    assertLe(liquidity.positionCount(), liquidity.MAX_POSITIONS(), "I-12: position count > cap");
}
```

---

## I-13 — LP Accounting Drift  *(new, v2)*

```
type: global
contracts: [PUSDLiquidity]

netReported := PUSDLiquidity.netAssetsInPUSD()
netTrue     := idleInPUSD
             + Σ positionValue(positions[i].tokenId).valueInPUSD
             + uncollectedFeesInPUSD

|netReported − netTrue| / netReported <= NAV_DRIFT_TOLERANCE_BPS (= 10 bps)
```

If drift exceeds the bound, `PUSDPlus` minting MUST pause until the contract is
reconciled. This catches oracle drift (slot0 manipulation), unclaimed-fee
staleness, and NPM-interface mismatches.

**Foundry stub**
```solidity
function invariant_lpAccountingDrift() public {
    uint256 netReported = liquidity.netAssetsInPUSD();
    uint256 netTrue     = _reconstructNAV(liquidity);  // helper sums idle + positions + fees
    uint256 diff        = netReported > netTrue ? netReported - netTrue : netTrue - netReported;
    if (netReported == 0) return;
    assertLe(diff * 10_000 / netReported, 10, "I-13: LP accounting drifted > 10 bps");
}
```

---

## Retired

- **R-07** retired. Treasury-not-set no longer contaminates plain PUSD under the v2 slice split.

---

## Fuzz setup notes

- Handler contract exposes: `deposit`, `redeem`, `rebalance`, `setTokenStatus`, `sweepAllSurplus`,
  `depositStable` (vault), `redeemToStable` (vault), `mintPosition`, `increaseLiquidity`,
  `decreaseLiquidity`, `collectFees`, `closePosition`, and token transfers on a mock set of
  stablecoins plus a mock Uniswap V3 USDC/USDT pool with controllable tick drift.
- Ghost variables:
  - `gm_cumulativePUSDMinted`, `gm_cumulativePUSDBurned`
  - `gm_parDepositsPerToken`, `gm_parRedeemsPerToken`
  - `gm_vaultDepositsPerToken`, `gm_vaultRedeemsPerToken`
  - `gm_positionMints`, `gm_positionCloses`, `gm_feeCollections`
  - `gm_swapSlippageMaxBps`
- Key post-assertions per handler step: I-01, I-01b, I-02, I-05, I-12, I-13.
- Stress scenarios:
  - Mass PUSD+ redeem while positions are deployed at near-cap and pool tick is at the range edge — exercises R-09 and `InsufficientLiquidity` fallback.
  - Adversarial tick drift pushing `slot0` outside `[tickLower, tickUpper]` while the redeemer requests the leg the position is now 100% in — exercises the swap-through path with `lpSwapSlippageBps` cap.

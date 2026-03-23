# Invariants Context (Machine-Readable)

Structured invariant list for use with fuzz testing (Foundry), formal verification (Halmos/Certora), or LLM-assisted audit.

Each invariant has:
- **ID** — stable identifier, matches `docs/design/invariants.md`
- **Type** — `global` (holds after every tx), `per-tx` (holds within a single call), or `transition` (governs state changes)
- **Solidity expression** — executable predicate where possible

---

## I-01 – Full Collateralisation

```
type: global
contracts: [PUSDManager, PUSD]

// For every non-REMOVED token, contract balance covers reserved surplus
∀ token ∈ tokenList where status != REMOVED:
  IERC20(token).balanceOf(address(PUSDManager))
    >= PUSDManager.accruedFees(token) + PUSDManager.accruedHaircut(token)

// Total PUSD supply backed by available liquidity
PUSD.totalSupply()
  <= sum over non-REMOVED tokens of:
       _normalizeDecimalsToPUSD(
         IERC20(token).balanceOf(PUSDManager) - accruedFees[token] - accruedHaircut[token],
         tokenInfo[token].decimals
       )
```

**Foundry handler stub:**
```solidity
function invariant_fullCollateralisation() public {
    for (uint256 i = 0; i < manager.tokenCount(); i++) {
        address t = manager.getSupportedTokenAt(i);
        if (manager.getTokenStatus(t) == PUSDManager.TokenStatus.REMOVED) continue;
        uint256 bal = IERC20(t).balanceOf(address(manager));
        uint256 reserved = manager.getAccruedSurplus(t);
        assertGe(bal, reserved, "I-01: balance < reserved surplus");
    }
}
```

---

## I-02 – Surplus Ring-Fence

```
type: global
contracts: [PUSDManager]

∀ token ∈ tokenList:
  IERC20(token).balanceOf(address(PUSDManager))
    >= accruedFees[token] + accruedHaircut[token]
```

Same as I-01 but applies to ALL tokens including REMOVED (they may still hold surplus pending sweep).

---

## I-03 – Mint Only on Deposit

```
type: per-tx
contracts: [PUSD]

PUSD.totalSupply() increases iff msg.sender == address(PUSDManager) AND
  the call stack includes PUSDManager.deposit()
```

**Fuzz property:** After any arbitrary call sequence, `PUSD.totalSupply()` must equal the sum of all net deposit amounts minus all burned amounts.

---

## I-04 – Burn Before Transfer

```
type: per-tx
contracts: [PUSDManager]

In every redemption transaction:
  PUSD.burn() is called before or in the same call frame as safeTransfer(token → user)
  pusdBurned == pusdAmount passed to redeem()
```

---

## I-05 – Fee Bounds

```
type: global
contracts: [PUSDManager]

baseFee        <= 100
preferredFeeMax <= 200
preferredFeeMin <= preferredFeeMax
∀ token: supportedTokens[token].surplusHaircutBps <= 4000
```

**Foundry handler stub:**
```solidity
function invariant_feeBounds() public {
    assertLe(manager.baseFee(), 100, "I-05: baseFee > 1%");
    assertLe(manager.preferredFeeMax(), 200, "I-05: preferredFeeMax > 2%");
    assertLe(manager.preferredFeeMin(), manager.preferredFeeMax(), "I-05: min > max");
}
```

---

## I-06 – No Self-Rebalance

```
type: per-tx
contracts: [PUSDManager]

rebalance(tokenIn, _, tokenOut, _) requires tokenIn != tokenOut
```

---

## I-07 – Value Conservation on Rebalance

```
type: per-tx
contracts: [PUSDManager]

normalizeDecimalsToPUSD(amountIn, decimalsIn)
  == normalizeDecimalsToPUSD(amountOut, decimalsOut)

PUSD.totalSupply() is unchanged before and after rebalance()
```

---

## I-08 – Decimal Normalisation Non-Inflation

```
type: per-tx
contracts: [PUSDManager]

∀ (amount, tokenDecimals):
  convertFromPUSD(normalizeDecimalsToPUSD(amount, tokenDecimals), tokenDecimals) <= amount

// i.e. round-trip never gives back MORE tokens than the user put in
```

---

## I-09 – REMOVED is Terminal

```
type: transition
contracts: [PUSDManager]

∀ token: once supportedTokens[token].status == REMOVED,
  no call to addSupportedToken(token, ...) can change it
  (because supportedTokens[token].exists == true blocks re-add)
```

---

## I-10 – Reentrancy Safety

```
type: per-tx
contracts: [PUSDManager]

_status == _NOT_ENTERED (1) at the start and end of every external call.
_status == _ENTERED (2) only during execution of nonReentrant functions.
No nonReentrant function calls another nonReentrant function.
```

---

## I-11 – Zero-Address Guards

```
type: per-tx
contracts: [PUSD, PUSDManager]

PUSD.mint(to, _)          requires to != address(0)
PUSD.burn(from, _)        requires from != address(0)
PUSDManager.initialize    requires _pusd != address(0) && admin != address(0)
setTreasuryReserve(addr)  requires addr != address(0)
```

---

## Fuzz Setup Notes

- Use Foundry invariant testing with a `Handler` contract that calls `deposit`, `redeem`, `rebalance`, `setTokenStatus`, and `sweepAllSurplus` with bounded random inputs.
- Ghost variables to track: cumulative PUSD minted, cumulative PUSD burned, cumulative tokens deposited per token, cumulative tokens redeemed per token.
- Key assertion: `cumulativePUSDMinted - cumulativePUSDburned == PUSD.totalSupply()` at all times.

# PUSDManager — Research Notes

## What is it?

`PUSDManager` is the core protocol contract. It holds all stablecoin reserves and orchestrates `mint`/`burn` calls on `PUSD`. Users interact with it to deposit stablecoins (receiving PUSD) and to redeem PUSD (receiving stablecoins back).

- **Upgradeable:** Yes — UUPS proxy pattern via OpenZeppelin
- **Reentrancy guard:** Custom inline guard using `_status` flag (`_NOT_ENTERED=1`, `_ENTERED=2`)
- **Safe transfers:** Uses OpenZeppelin `SafeERC20` for all token interactions

---
## 20-02-2026

## Contract Inheritance

```
PUSDManager
  ├── Initializable
  ├── AccessControlUpgradeable
  └── UUPSUpgradeable
```

---

## Roles

| Role | Capability |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Grant / revoke all other roles |
| `ADMIN_ROLE` (`keccak256("ADMIN_ROLE")`) | Token management, fee config, rebalance, sweep |
| `UPGRADER_ROLE` (`keccak256("UPGRADER_ROLE")`) | Authorise UUPS proxy upgrade |

`initialize(address _pusd, address admin)` grants all three roles to `admin`.

---

## Storage Layout

```solidity
PUSD public pusd;                                     // reference to PUSD token
uint256 private _status;                              // reentrancy guard

mapping(address => TokenInfo) public supportedTokens; // token config by address
mapping(uint256 => address)   public tokenList;       // ordered index → address
mapping(address => uint256)   private tokenIndex;     // reverse: address → index
uint256 public tokenCount;

address public treasuryReserve;
uint256 public baseFee;           // bps, max 100 (1%)
uint256 public preferredFeeMin;   // bps
uint256 public preferredFeeMax;   // bps, max 200 (2%)

mapping(address => uint256) public accruedFees;       // redemption fees pending sweep
mapping(address => uint256) public accruedHaircut;    // deposit haircuts pending sweep
mapping(address => uint256) public sweptFees;         // historical totals per token
mapping(address => uint256) public sweptHaircut;
```

---

## TokenInfo Struct

```solidity
struct TokenInfo {
    bool exists;
    TokenStatus status;          // REMOVED | ENABLED | REDEEM_ONLY | EMERGENCY_REDEEM
    uint8 decimals;
    uint16 surplusHaircutBps;   // 0..4000 (max 40%), applied on deposit
    string name;
    string chainNamespace;       // e.g. "eip155:1" to identify originating chain
}
```

---

## Token Status Lifecycle

```
addSupportedToken()  →  ENABLED
                           │
              setTokenStatus()
         ┌─────────────────┴────────────────┐
         ▼                                  ▼
    REDEEM_ONLY                     EMERGENCY_REDEEM
         │                                  │
         └────────────┬─────────────────────┘
                      ▼
                   REMOVED  (terminal — cannot re-add without upgrade)
```

| Status | Deposit | Redeem |
|---|---|---|
| `ENABLED` | ✅ | ✅ (preferred, basket, emergency) |
| `REDEEM_ONLY` | ❌ | ✅ (preferred, basket) |
| `EMERGENCY_REDEEM` | ❌ | ✅ (forces proportional drain) |
| `REMOVED` | ❌ | ❌ (skipped in all loops) |

---

## Key Functions

### `initialize(address _pusd, address admin)`
- Sets `pusd` reference, initialises reentrancy status to `_NOT_ENTERED`.
- Grants `DEFAULT_ADMIN_ROLE`, `ADMIN_ROLE`, `UPGRADER_ROLE` to `admin`.

### `addSupportedToken(address, string name, string chainNamespace, uint8 decimals)` — `ADMIN_ROLE`
- Registers a new token as `ENABLED` with `surplusHaircutBps = 0`.
- Appends to `tokenList`, sets `tokenIndex` reverse mapping.
- Guard: cannot add `address(0)`, cannot add a token that `exists` already, decimals must be 1–18.

### `setTokenStatus(address, TokenStatus)` — `ADMIN_ROLE`
- Changes status of an existing token. Reverts if status is unchanged.

### `setTreasuryReserve(address)` — `ADMIN_ROLE`
- Sets the destination for swept fees and haircuts.

### `setBaseFee(uint256)` — `ADMIN_ROLE`
- Max 100 bps (1%).

### `setPreferredFeeRange(uint256 min, uint256 max)` — `ADMIN_ROLE`
- Requires `min <= max`, max capped at 200 bps (2%).

### `setSurplusHaircutBps(address, uint16)` — `ADMIN_ROLE`
- Per-token deposit haircut. Max 4000 bps (40%).

---

## Deposit Flow

```
deposit(address token, uint256 amount)
  │
  ├─ require: token status == ENABLED
  ├─ require: amount > 0
  ├─ surplusTokenAmount = amount * surplusHaircutBps / 10000
  ├─ netTokenAmount = amount - surplusTokenAmount
  ├─ safeTransferFrom(user → contract, amount)   // full amount incl. haircut
  ├─ accruedHaircut[token] += surplusTokenAmount
  ├─ pusdAmount = _normalizeDecimalsToPUSD(netTokenAmount, decimals)
  └─ PUSD.mint(user, pusdAmount)
```

The haircut stays in the contract until `sweepAllSurplus()` is called.

---

## Redemption Flow

`redeem(uint256 pusdAmount, address preferredAsset, bool allowBasket)` has three paths:

### Path 1 — Preferred Single-Token (happy path)
- Conditions: `preferredAsset` status is ENABLED/REDEEM_ONLY/EMERGENCY_REDEEM, no emergency tokens exist, sufficient liquidity.
- Fee: `baseFee + preferredFee` (preferred fee is dynamic — see below).
- Burns PUSD, transfers `tokenAmount - feeAmount` to user, keeps fee in contract.

### Path 2 — Emergency Proportional
- Conditions: one or more tokens are in `EMERGENCY_REDEEM` status with non-zero balance.
- Burns PUSD upfront, distributes proportionally across `preferredAsset` + all `EMERGENCY_REDEEM` tokens by liquidity share.
- Fee: `baseFee` only (no preferred fee).

### Path 3 — Basket
- Conditions: preferred asset unavailable or insufficient; `allowBasket == true`.
- Burns PUSD upfront, distributes proportionally across all non-REMOVED tokens by liquidity share.
- Rounding remainder allocated to the token with the largest remaining liquidity.
- Fee: `baseFee` only.

---

## Preferred Fee Formula

When a user redeems into a specific token, a `preferredFee` is added on top of `baseFee`. It discourages draining thin positions:

```
token liquidity share ≥ 50%  →  preferredFeeMin
token liquidity share ≤ 10%  →  preferredFeeMax
10% < share < 50%            →  linear interpolation between min and max
```

If `preferredFeeMin == 0` and `preferredFeeMax == 0`, preferred fee is 0.

---

## Decimal Normalisation

PUSD has 6 decimals. All internal accounting normalises to PUSD units:

| Token decimals | Direction | Operation |
|---|---|---|
| `== 6` | — | no change |
| `> 6` | token → PUSD | divide by `10^(decimals - 6)` (truncates) |
| `< 6` | token → PUSD | multiply by `10^(6 - decimals)` |

`_convertFromPUSD` is the exact inverse for sending tokens back to users.  
For `tokenDecimals < 6`, there is potential truncation — users receive weakly less than owed, never more (favours protocol).

---

## Available Liquidity

```solidity
_getAvailableLiquidity(token) = balanceOf(token) - accruedFees[token] - accruedHaircut[token]
```

Reserved surplus is always excluded from liquidity calculations and rebalancing.

---

## Surplus Sweep

### `sweepAllSurplus()` — `ADMIN_ROLE`, `nonReentrant`
- Requires `treasuryReserve != address(0)`.
- Iterates all tokens in `tokenList`, calls `_sweepTokenSurplus(token)` for each.
- `_sweepTokenSurplus`: transfers `accruedFees + accruedHaircut` to `treasuryReserve`, resets both to 0, updates `sweptFees`/`sweptHaircut` historical totals.
- Reverts if nothing was swept.

---

## Rebalance

### `rebalance(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut)` — `ADMIN_ROLE`, `nonReentrant`
- Admin supplies `tokenIn` to contract, receives `tokenOut` back.
- Guard: `tokenIn != tokenOut`, both tokens must exist and not be `REMOVED`.
- Value conservation: `_normalizeDecimalsToPUSD(amountIn, decimalsIn) == _normalizeDecimalsToPUSD(amountOut, decimalsOut)` — exact 1:1 PUSD value.
- Surplus ring-fence: `tokenOutBalance >= amountOut + reservedSurplus` — cannot spend surplus as if it's free liquidity.
- No PUSD is minted or burned.

---

## Events

| Event | Trigger |
|---|---|
| `TokenAdded` | `addSupportedToken` |
| `TokenStatusChanged` | `setTokenStatus` |
| `Deposited(user, token, tokenAmount, pusdMinted, surplusAmount)` | `deposit` |
| `Redeemed(user, token, pusdBurned, tokenAmount)` | `_executeRedeem` |
| `TreasuryReserveUpdated` | `setTreasuryReserve` |
| `BaseFeeUpdated` | `setBaseFee` |
| `PreferredFeeRangeUpdated` | `setPreferredFeeRange` |
| `Rebalanced(tokenIn, amountIn, tokenOut, amountOut)` | `rebalance` |
| `SurplusHaircutUpdated` | `setSurplusHaircutBps` |
| `SurplusAccrued(token, feeDelta, haircutDelta)` | `deposit` (haircut) and `_executeRedeem` (fee) |
| `SurplusSwept(token, treasury, feeSwept, haircutSwept)` | `_sweepTokenSurplus` |

---

## Invariants

- **I-01 (Full Collateralisation):** `PUSD.totalSupply() <= Σ availableLiquidity(t)` across all non-REMOVED tokens.
- **I-02 (Surplus Ring-Fence):** `accruedFees[t] + accruedHaircut[t] <= balanceOf(t)` always.
- **I-04 (Burn Before Transfer):** In all redeem paths, PUSD is burned before or atomically with the outbound transfer.
- **I-05 (Fee Bounds):** `baseFee ≤ 100`, `preferredFeeMax ≤ 200`, `surplusHaircutBps ≤ 4000`.
- **I-06 (No Self-Rebalance):** `tokenIn != tokenOut`.
- **I-07 (Value Conservation on Rebalance):** Equal PUSD value in/out; total supply unchanged.
- **I-09 (REMOVED is terminal):** Once `REMOVED`, a token's `exists` flag is still `true` — cannot be re-added via `addSupportedToken` without an upgrade.
- **I-10 (Reentrancy Safety):** `deposit`, `redeem`, `rebalance`, `sweepAllSurplus` all guarded by `nonReentrant`.
- **I-11 (Zero-Address Guards):** `initialize`, `addSupportedToken`, `setTreasuryReserve` all reject `address(0)`.

---

## Risks

- **R-01 (Stablecoin De-peg):** A supported stablecoin loses peg → basket under-collateralised. Mitigation: admin sets token to `REDEEM_ONLY` or `EMERGENCY_REDEEM` to stop new exposure and drain the position. Residual: response latency window.
- **R-02 (Admin Key Compromise):** `ADMIN_ROLE` can call `rebalance` to drain tokens (must supply equal value) and redirect `treasuryReserve`. Mitigation: multisig. No timelock currently.
- **R-03 (UUPS Upgrade Risk):** Bad upgrade corrupts state. `UPGRADER_ROLE` should require governance + timelock (not enforced on-chain today).
- **R-05 (Basket Gas Cost):** `_executeBasketRedeem` iterates `tokenList` twice — O(n) in `tokenCount`. No on-chain cap on `tokenCount`.
- **R-06 (Liquidity Fragmentation):** Basket path rounding remainder relies on most-liquid token having sufficient balance post-distribution.
- **R-07 (Treasury Not Set):** Fees accumulate indefinitely if `treasuryReserve == address(0)`. No fund loss, just locked revenue.
- **R-08 (Front-Running Preferred Fee):** Dynamic fee based on live pool balance is observable; users can front-run to avoid higher fees. Bounded by `preferredFeeMax` (≤ 2%).

---

## Open Questions / Notes

- `tokenIndex` mapping stores the index at time of insertion. `REMOVED` tokens are not deleted from `tokenList` — they still occupy a slot and are iterated (then `continue`d) in basket/emergency/sweep loops. A large number of removed tokens degrades gas performance.
- No maximum `tokenCount` is enforced on-chain. A governance-level limit should be documented.
- The `rebalance` function is admin-only but requires the admin to supply the `tokenIn` value externally — it is not a free drain. However, combined with `setTreasuryReserve`, a compromised admin could redirect and then sweep.
- `_executeBasketRedeem` and `_executeEmergencyRedeem` both call `_executeRedeem` with `shouldBurn=false` after burning PUSD upfront — the single burn is intentional to avoid double-burn across the loop.

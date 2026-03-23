# PUSDManager.sol — Agent Context

Dense reference for AI-assisted work on `contracts/src/PUSDManager.sol`.

## File facts

| Property | Value |
|---|---|
| Path | `contracts/src/PUSDManager.sol` |
| SPDX | MIT |
| Solidity | 0.8.22 |
| Lines | 699 |
| Proxy pattern | UUPS (OpenZeppelin) |
| Reentrancy guard | Custom (inline, `_status` slot) |

## Inheritance chain

```
PUSDManager
  ├── Initializable
  ├── AccessControlUpgradeable
  └── UUPSUpgradeable
```

Uses `SafeERC20` for all external token transfers.

## Roles

```solidity
ADMIN_ROLE    = keccak256("ADMIN_ROLE")
UPGRADER_ROLE = keccak256("UPGRADER_ROLE")
// DEFAULT_ADMIN_ROLE inherited (bytes32(0))
```

`initialize(admin)` grants all three roles to `admin`.

## Enums & Structs

### `TokenStatus`
```solidity
enum TokenStatus {
    REMOVED,          // excluded from all operations
    ENABLED,          // deposit + redeem freely
    REDEEM_ONLY,      // redeem only, no new deposits
    EMERGENCY_REDEEM  // proportional forced redemption to drain this token
}
```

### `TokenInfo`
```solidity
struct TokenInfo {
    bool exists;
    TokenStatus status;
    uint8 decimals;
    uint16 surplusHaircutBps;  // 0..4000 (max 40%)
    string name;
    string chainNamespace;     // informational, e.g. "eip155:1"
}
```

## Storage slots (declaration order — critical for upgrade safety)

```
slot 0  (inherited gap slots from OZ upgradeable contracts first)
...
pusd               : address  (PUSD contract reference)
_status            : uint256  (reentrancy guard; 1=NOT_ENTERED, 2=ENTERED)
supportedTokens    : mapping(address => TokenInfo)
tokenList          : mapping(uint256 => address)   (ordered index → address)
tokenIndex         : mapping(address => uint256)   (reverse: address → index)
tokenCount         : uint256
treasuryReserve    : address
baseFee            : uint256  (bps, max 100)
preferredFeeMin    : uint256  (bps)
preferredFeeMax    : uint256  (bps, max 200)
accruedFees        : mapping(address => uint256)
accruedHaircut     : mapping(address => uint256)
sweptFees          : mapping(address => uint256)
sweptHaircut       : mapping(address => uint256)
```

## Public / external functions

### Admin configuration

| Function | Guard | Description |
|---|---|---|
| `addSupportedToken(token, name, chainNamespace, decimals)` | `ADMIN_ROLE` | Registers a new token (status=ENABLED, haircut=0) |
| `setTokenStatus(token, newStatus)` | `ADMIN_ROLE` | Transitions token through lifecycle states |
| `setTreasuryReserve(addr)` | `ADMIN_ROLE` | Sets sweep destination; cannot be zero |
| `setBaseFee(bps)` | `ADMIN_ROLE` | Base redemption fee; max 100 bps (1%) |
| `setPreferredFeeRange(min, max)` | `ADMIN_ROLE` | Preferred fee bounds; max 200 bps (2%) |
| `setSurplusHaircutBps(token, bps)` | `ADMIN_ROLE` | Per-token deposit haircut; max 4000 bps (40%) |
| `rebalance(tokenIn, amountIn, tokenOut, amountOut)` | `ADMIN_ROLE` + `nonReentrant` | 1:1 value swap; admin provides tokenIn, receives tokenOut |
| `sweepAllSurplus()` | `ADMIN_ROLE` + `nonReentrant` | Transfers all accrued fees+haircut to treasuryReserve |

### User operations

| Function | Guard | Description |
|---|---|---|
| `deposit(token, amount)` | `nonReentrant` | Deposit stablecoin → mint PUSD |
| `redeem(pusdAmount, preferredAsset, allowBasket)` | `nonReentrant` | Burn PUSD → receive stablecoin(s) |

### View functions

| Function | Returns |
|---|---|
| `getSupportedTokensCount()` | `tokenCount` |
| `getSupportedTokenAt(index)` | `tokenList[index]` |
| `isTokenSupported(token)` | true if ENABLED / REDEEM_ONLY / EMERGENCY_REDEEM |
| `getTokenStatus(token)` | `TokenStatus` |
| `getTokenInfo(token)` | `TokenInfo` struct |
| `getAccruedFees(token)` | pending redemption fees |
| `getAccruedHaircut(token)` | pending deposit haircut |
| `getAccruedSurplus(token)` | fees + haircut |
| `getSweptFees(token)` | historical swept fees |
| `getSweptHaircut(token)` | historical swept haircut |
| `getTotalSwept(token)` | swept fees + haircut |
| `getSurplusBreakdown(token)` | (accruedFee, accruedHaircut, sweptFee, sweptHaircut) |

## Internal functions

### `_executeRedeem(token, pusdAmount, tokenAmount, shouldBurn, feeBps)`
Core redemption executor:
1. If `shouldBurn`: calls `pusd.burn(msg.sender, pusdAmount)`.
2. `feeAmount = tokenAmount * feeBps / 10000`; added to `accruedFees[token]`.
3. Transfers `tokenAmount - feeAmount` to `msg.sender`.

### `_executeBasketRedeem(pusdAmount)`
Proportional redemption across all non-REMOVED tokens:
- Burns PUSD once upfront.
- Splits by liquidity share; applies `baseFee` per leg.
- Rounding remainder goes to most-liquid token.

### `_executeEmergencyRedeem(pusdAmount, preferredAsset)`
Same algorithm as basket but limited to: `preferredAsset` + all `EMERGENCY_REDEEM` tokens.

### `_hasEmergencyTokens() → bool`
Scans `tokenList` for any `EMERGENCY_REDEEM` token with available balance > 0.

### `_getAvailableLiquidity(token) → uint256`
```solidity
balance - accruedFees[token] - accruedHaircut[token]
// returns 0 if balance < reserved
```

### `_normalizeDecimalsToPUSD(amount, tokenDecimals) → uint256`
Converts token units to PUSD (6 decimal) units.

### `_convertFromPUSD(pusdAmount, tokenDecimals) → uint256`
Converts PUSD units back to token units (inverse of above).

### `_calculatePreferredFee(token) → uint256`
Linear interpolation: `preferredFeeMax` when token has ≤10% of pool, `preferredFeeMin` when ≥50%.

### `_sweepTokenSurplus(token) → bool`
Internal helper for `sweepAllSurplus`. Skips if treasury not set or no accrued surplus.

## Events

```solidity
TokenAdded(address indexed token, string name, string chainNamespace, uint8 decimals)
TokenStatusChanged(address indexed token, TokenStatus oldStatus, TokenStatus newStatus)
Deposited(address indexed user, address indexed token, uint256 tokenAmount, uint256 pusdMinted, uint256 surplusAmount)
Redeemed(address indexed user, address indexed token, uint256 pusdBurned, uint256 tokenAmount)
TreasuryReserveUpdated(address indexed oldTreasury, address indexed newTreasury)
BaseFeeUpdated(uint256 oldFee, uint256 newFee)
PreferredFeeRangeUpdated(uint256 oldMin, uint256 oldMax, uint256 newMin, uint256 newMax)
Rebalanced(address indexed tokenIn, uint256 amountIn, address indexed tokenOut, uint256 amountOut)
SurplusHaircutUpdated(address indexed token, uint256 oldBps, uint256 newBps)
SurplusAccrued(address indexed token, uint256 feeDelta, uint256 haircutDelta)
SurplusSwept(address indexed token, address indexed treasury, uint256 feeSwept, uint256 haircutSwept)
```

## Constants

```solidity
uint256 private constant _NOT_ENTERED = 1;
uint256 private constant _ENTERED     = 2;
uint256 private constant BASIS_POINTS = 10000;
```

## Common editing patterns

**Add a deposit cap per token:**
```solidity
// in TokenInfo: add uint256 depositCap
// in deposit(): require(IERC20(token).balanceOf(address(this)) + amount <= tokenInfo.depositCap)
```

**Add a global PUSD mint cap:**
```solidity
uint256 public globalMintCap;
// in deposit(): require(pusd.totalSupply() + pusdAmount <= globalMintCap)
```

**Add single-token sweep:**
```solidity
function sweepSurplus(address token) external onlyRole(ADMIN_ROLE) nonReentrant {
    require(treasuryReserve != address(0), "PUSDManager: treasury not set");
    require(_sweepTokenSurplus(token), "PUSDManager: no surplus");
}
```

## Upgrade safety notes

- `_status` is in the contract's own storage (not inherited). Do not reorder or remove it.
- OpenZeppelin upgradeable contracts use gap arrays — any new storage must be appended after all existing variables.
- Run `forge inspect PUSDManager storageLayout` before and after any upgrade to diff the layout.
- After upgrading `PUSDManager` to a new address (new proxy), re-grant `MINTER_ROLE` and `BURNER_ROLE` on `PUSD` to the new address.

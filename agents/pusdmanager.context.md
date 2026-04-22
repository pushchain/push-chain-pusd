# PUSDManager.sol — Agent Context (v2)

Dense reference for AI-assisted work on `contracts/src/PUSDManager.sol`.

> **v2 changes** — reserve is now split into `parReserve` (backs plain PUSD) and
> `yieldShareReserve` (backs PUSD+). New entrypoints `mintForVault` and
> `redeemForVault` are the only paths that touch `yieldShareReserve`. See
> [ADR 0003 §3](../docs/design/decisions/0003-product-architecture.md#3--reserve-slicing).

## File facts

| Property | Value |
|---|---|
| Path | `contracts/src/PUSDManager.sol` |
| SPDX | MIT |
| Solidity | 0.8.22 |
| Proxy | UUPS |
| Reentrancy | Custom inline `_status` slot |
| SafeERC20 | yes |

## Inheritance chain

```
PUSDManager
  ├── Initializable
  ├── AccessControlUpgradeable
  └── UUPSUpgradeable
```

## Roles

```solidity
ADMIN_ROLE    = keccak256("ADMIN_ROLE")
VAULT_ROLE    = keccak256("VAULT_ROLE")   // NEW v2 — held only by PUSDPlus
UPGRADER_ROLE = keccak256("UPGRADER_ROLE")
// DEFAULT_ADMIN_ROLE inherited
```

| Role | Holder |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Multisig |
| `ADMIN_ROLE` | Multisig |
| `VAULT_ROLE` | PUSDPlus (sole) |
| `UPGRADER_ROLE` | 48h Timelock |

## Enums & structs

### `TokenStatus` (unchanged)
```solidity
enum TokenStatus {
    REMOVED,
    ENABLED,
    REDEEM_ONLY,
    EMERGENCY_REDEEM
}
```

### `TokenInfo` (extended for v2)
```solidity
struct TokenInfo {
    bool exists;
    TokenStatus status;
    uint8 decimals;
    uint16 surplusHaircutBps;      // 0..4000 (max 40%)
    string name;
    string chainNamespace;
    // v2 additions: reserve composition rate-bearing wrappers are out of scope
    // for v2 (no sDAI/sUSDS/USDY available on Push Chain). Reserved slots kept
    // for future wiring; both must remain address(0) at launch.
    address rateBearingWrapper;    // reserved; address(0) at v2 launch
    address unwrapAdapter;         // reserved; address(0) at v2 launch
}
```

## Storage (declaration order — upgrade-safe)

```
// v1 slots retained up front:
pusd               : address
_status            : uint256                    (1=NOT_ENTERED, 2=ENTERED)
supportedTokens    : mapping(address => TokenInfo)
tokenList          : mapping(uint256 => address)
tokenIndex         : mapping(address => uint256)
tokenCount         : uint256
treasuryReserve    : address
baseFee            : uint256                    (bps, max 100)
preferredFeeMin    : uint256
preferredFeeMax    : uint256                    (bps, max 200)
accruedFees        : mapping(address => uint256)
accruedHaircut     : mapping(address => uint256)
sweptFees          : mapping(address => uint256)
sweptHaircut       : mapping(address => uint256)

// v2 appended:
parReserve          : mapping(address => uint256)
yieldShareReserve   : mapping(address => uint256)
pusdPlus            : address
vaultHaircutBps     : uint16                    (launch: 0, max 500)
```

## Constants

```solidity
uint256 private constant _NOT_ENTERED = 1;
uint256 private constant _ENTERED     = 2;
uint256 private constant BASIS_POINTS = 10000;
uint256 public  constant MAX_TOKENS   = 25;     // ADR 0003 §8
```

## Public / external functions

### Admin configuration (ADMIN_ROLE)

| Function | Description |
|---|---|
| `addSupportedToken(token, name, chainNamespace, decimals)` | Registers token; status=ENABLED; haircut=0; wrapper=0 |
| `setTokenStatus(token, newStatus)` | Lifecycle transitions |
| `setTreasuryReserve(addr)` | Sweep destination; cannot be zero |
| `setBaseFee(bps)` | max 100 |
| `setPreferredFeeRange(min, max)` | max 200 |
| `setSurplusHaircutBps(token, bps)` | max 4000 |
| `setRateBearingWrapper(token, wrapper, adapter)` | v2: configure rate-bearing form per token |
| `rebalanceReserveToRateBearing(token, amount)` | v2: wrap idle yieldShareReserve into rate-bearing form |
| `rebalanceRateBearingToReserve(token, amount)` | v2: inverse |
| `rebalance(tokenIn, amountIn, tokenOut, amountOut)` | 1:1 cross-token swap within same slice |
| `sweepAllSurplus()` | Sweeps fees+haircut to treasury |
| `setPUSDPlus(addr)` | v2: set the VAULT_ROLE holder |
| `setVaultHaircutBps(bps)` | v2: deposit-side fee on vault path; default 0 |

### User operations (plain PUSD — touches parReserve only)

```solidity
function deposit(address token, uint256 amount) external nonReentrant;
function redeem(uint256 pusdAmount, address preferredAsset, bool allowBasket) external nonReentrant;
```

### Vault operations (VAULT_ROLE — touches yieldShareReserve only)  NEW v2

```solidity
function mintForVault(
    address token,
    uint256 amount,
    address recipient           // always PUSDPlus in practice
) external onlyRole(VAULT_ROLE) nonReentrant returns (uint256 pusdMinted);

function redeemForVault(
    uint256 pusdAmount,
    address preferredAsset,
    address recipient           // always the end user
) external onlyRole(VAULT_ROLE) nonReentrant returns (uint256 tokenOut);
```

### View functions

| Function | Returns |
|---|---|
| `getSupportedTokensCount()` | `tokenCount` |
| `getSupportedTokenAt(index)` | `tokenList[index]` |
| `isTokenSupported(token)` | true if ENABLED/REDEEM_ONLY/EMERGENCY_REDEEM |
| `getTokenStatus(token)` | `TokenStatus` |
| `getTokenInfo(token)` | `TokenInfo` |
| `getAccruedFees/Haircut/Surplus(token)` | unchanged v1 |
| `getSweptFees/Haircut(token)` | unchanged v1 |
| `parReserveOf(token)` | v2: slice value |
| `yieldShareReserveOf(token)` | v2: slice value |
| `availableForParRedeem(token)` | `parReserve[t] - fees[t] - haircut[t]` capped at 0 |
| `availableForVaultWithdraw(token)` | `yieldShareReserve[t] + PUSDLiquidity.idleBalance(t)` |

## Internal helpers (v2)

### `_executeRedeem(token, pusdAmount, tokenAmount, shouldBurn, feeBps, fromSlice)`
- Extended with `fromSlice ∈ {PAR, YIELD}` selector.
- If `PAR`: decrements `parReserve[token]`.
- If `YIELD`: decrements `yieldShareReserve[token]`; if slice < need, additional pull via `PUSDLiquidity.pullForWithdraw`.

### `_executeBasketRedeem(pusdAmount)` (plain PUSD only, `parReserve` scope)
Proportional across non-REMOVED tokens' `parReserve`. Burns PUSD once. Applies `baseFee` per leg.

### `_executeEmergencyRedeem(pusdAmount, preferredAsset)` (plain PUSD only)
Preferred + all `EMERGENCY_REDEEM` tokens, pulling from `parReserve` only.

### `_normalizeDecimalsToPUSD(amount, tokenDecimals) → uint256`
Unchanged v1.

### `_convertFromPUSD(pusdAmount, tokenDecimals) → uint256`
Unchanged v1.

### `_calculatePreferredFee(token) → uint256`
Linear interpolation based on `parReserve[token]` share of total-par (not total-balance) — fee floor when token is overrepresented in `parReserve`, ceiling when underrepresented.

### `_sweepTokenSurplus(token)` — unchanged

## Events

Additions to v1:
```solidity
event ParReserveDelta(address indexed token, int256 delta);           // positive = deposit, negative = redeem
event YieldShareReserveDelta(address indexed token, int256 delta);    // positive = vault mint, negative = vault burn
event RateBearingWrapperSet(address indexed token, address indexed wrapper, address indexed adapter);
event RateBearingRebalanced(address indexed token, uint256 amountBase, uint256 amountWrapped, bool toWrapped);
event PUSDPlusSet(address indexed oldVault, address indexed newVault);
event VaultHaircutBpsSet(uint16 oldBps, uint16 newBps);
```

## Invariants touching PUSDManager

- I-01 (v2): `balance == parReserve + yieldShareReserve + fees + haircut` per token.
- I-05: fee bounds.
- I-06, I-07: rebalance semantics; value conservation per slice.
- I-08: decimal normalisation.
- I-09: REMOVED is terminal.
- I-10: reentrancy guard; cross-contract DAG.
- I-11: zero-address guards.

## Upgrade safety notes

- `_status` in own storage. Do not reorder.
- New v2 slots are appended after all v1 slots. Verify with `forge inspect`.
- Re-granting `MINTER_ROLE`/`BURNER_ROLE` on PUSD is required after any Manager upgrade.
- Re-granting `VAULT_ROLE` on PUSDManager is required after any PUSDPlus upgrade.

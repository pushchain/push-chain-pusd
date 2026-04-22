# Architecture

The PUSD protocol is four upgradeable contracts. This page documents each: its role, its storage, its external interface, and how it wires to the others.

The authoritative design intent is in [ADR 0003](decisions/0003-product-architecture.md). This page is the spec.

---

## Contract map

```
                              ┌────────────────────────┐
                              │      PUSD (ERC-20)     │
                              │   mint/burn by role    │
                              └───────────┬────────────┘
                                          │ MINTER_ROLE, BURNER_ROLE
                                          │ (held only by PUSDManager)
                                          ▼
        VAULT_ROLE      ┌─────────────────────────────────┐
       ┌────────────────▶           PUSDManager           │
       │                │  parReserve, yieldShareReserve  │
       │                │  deposit, redeem                │
       │                │  mintForVault, redeemForVault   │
       │                └──────────────────┬──────────────┘
       │                                   │ holds PUSD
       │                                   │ credits
       │                                   ▼
  ┌────┴──────────────────┐   ┌──────────────────────────────┐
  │   PUSDPlus (ERC-4626) │   │                              │
  │  underlying = PUSD    │   │   PUSDPlus holds PUSD in its │
  │  totalAssets =        │   │   own balance, plus the      │
  │   PUSD.bal(vault) +   │   │   claim reported by          │
  │   liquidity.nav()     │   │   PUSDLiquidity              │
  └─────────┬─────────────┘   └──────────────────────────────┘
            │ LIQUIDITY_ROLE (PUSDPlus grants to PUSDLiquidity)
            │ VAULT_ROLE     (PUSDLiquidity grants to PUSDPlus)
            ▼
  ┌────────────────────────────────────┐
  │          PUSDLiquidity             │
  │  holds USDC/USDT and UniV3 NFT     │
  │  positions; never holds PUSD       │
  │  deploys via INonfungiblePosition- │
  │  Manager + UniV3Router             │
  │                                    │
  │  netAssetsInPUSD() → uint256       │
  └────────────────────────────────────┘
```

Key wiring rules:
- **Only `PUSDManager`** ever calls `PUSD.mint`/`PUSD.burn`. Nothing else has `MINTER_ROLE`/`BURNER_ROLE`.
- **Only `PUSDPlus`** can call `PUSDManager.mintForVault` / `redeemForVault` (`VAULT_ROLE` on PUSDManager).
- **Only `PUSDPlus`** can pull/push capital from `PUSDLiquidity` for user withdraws (`VAULT_ROLE` on PUSDLiquidity).
- **Only `PUSDLiquidity`** reports NAV to PUSDPlus (`LIQUIDITY_ROLE` on PUSDPlus).

---

## PUSD.sol — the token

Unchanged from v1. Minimal ERC-20.

| Field | Value |
|---|---|
| Standard | ERC-20 |
| Decimals | 6 |
| Name / Symbol | "Push USD" / "PUSD" |
| Upgradeable | Yes (UUPS) |
| Roles | `DEFAULT_ADMIN_ROLE`, `UPGRADER_ROLE`, `MINTER_ROLE`, `BURNER_ROLE` |

External surface:
```solidity
function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE);
function burn(address from, uint256 amount) external onlyRole(BURNER_ROLE);
```

PUSD has no idea about the reserve, the wrapper, or strategies. It exists purely to track "who holds how much of the settlement token". All complexity lives upstream.

---

## PUSDManager.sol — the reserve

Holds every deposited stablecoin, splits them into two slices, and serves both `deposit/redeem` (for plain PUSD) and `mintForVault/redeemForVault` (for PUSD+).

### New state (vs. v1)

```solidity
// Replaces the single implicit "reserve = balance - surplus" model.
mapping(address => uint256) public parReserve;          // backs PUSD 1:1
mapping(address => uint256) public yieldShareReserve;   // owned by PUSD+

address public pusdPlus;                                 // VAULT_ROLE holder
```

Invariant (I-01):
```
IERC20(t).balanceOf(PUSDManager)
  == parReserve[t]
   + yieldShareReserve[t]
   + accruedFees[t]
   + accruedHaircut[t]
```

### Storage (declaration order — upgrade-safe)

```
// existing v1 slots retained at the front for upgrade safety
pusd                  : address
_status               : uint256 (reentrancy guard)
supportedTokens       : mapping(address => TokenInfo)
tokenList             : mapping(uint256 => address)
tokenIndex            : mapping(address => uint256)
tokenCount            : uint256
treasuryReserve       : address
baseFee               : uint256
preferredFeeMin       : uint256
preferredFeeMax       : uint256
accruedFees           : mapping(address => uint256)
accruedHaircut        : mapping(address => uint256)
sweptFees             : mapping(address => uint256)
sweptHaircut          : mapping(address => uint256)

// NEW v2 slots appended
parReserve            : mapping(address => uint256)
yieldShareReserve     : mapping(address => uint256)
pusdPlus              : address
```

### TokenInfo (extended)

```solidity
struct TokenInfo {
    bool exists;
    TokenStatus status;
    uint8 decimals;
    uint16 surplusHaircutBps;
    string name;
    string chainNamespace;

    // v2 slots — reserved. Rate-bearing wrappers are out of scope for v2 launch
    // (no sDAI/sUSDS/USDY available on Push Chain). Must be address(0) at launch.
    address rateBearingWrapper;   // reserved (0) at v2 launch
    address unwrapAdapter;         // reserved (0) at v2 launch
}
```

At v2 launch both reserved slots must be `address(0)`. When a rate-bearing wrapper is bridged to Push Chain, a follow-up ADR can wire `setRateBearingWrapper` back on — the Solidity slots stay where they are to preserve upgrade safety.

### Roles (per ADR 0002)

| Role | Holder | |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Multisig | |
| `ADMIN_ROLE` | Multisig | token config, fees, sweep, wrapper config |
| `VAULT_ROLE` | PUSDPlus | gates `mintForVault`, `redeemForVault` |
| `UPGRADER_ROLE` | 48h Timelock | |

### External surface

**User-facing (plain PUSD)**
```solidity
function deposit(address token, uint256 amount) external nonReentrant;
function redeem(uint256 pusdAmount, address preferredAsset, bool allowBasket) external nonReentrant;
```

Touch `parReserve` only. No change in semantics from v1 except the reserve slice accounting.

**Vault-facing (PUSD+ internal)**
```solidity
function mintForVault(address token, uint256 amount, address recipient)
    external onlyRole(VAULT_ROLE) nonReentrant returns (uint256 pusdMinted);

function redeemForVault(uint256 pusdAmount, address preferredAsset, address recipient)
    external onlyRole(VAULT_ROLE) nonReentrant returns (uint256 tokenOut);
```

- `mintForVault` is called by `PUSDPlus.deposit`. PUSDManager moves the stablecoin from the sender (PUSDPlus, or the original user via `permit`) into its balance, credits `yieldShareReserve`, and mints PUSD **to `recipient`** (which will be PUSDPlus).
- `redeemForVault` is the inverse: PUSDPlus hands back PUSD, PUSDManager burns it, decrements `yieldShareReserve`, pulls from `PUSDLiquidity` if the Manager's held balance is insufficient, and sends the base stablecoin to `recipient` (the end user).

**Admin**
```solidity
function setPUSDPlus(address newVault) external onlyRole(ADMIN_ROLE);
function setRateBearingWrapper(address base, address wrapper, address adapter) external onlyRole(ADMIN_ROLE);
function rebalanceReserveToRateBearing(address token, uint256 amount) external onlyRole(ADMIN_ROLE);
function rebalanceRateBearingToReserve(address token, uint256 amount) external onlyRole(ADMIN_ROLE);
```

---

## PUSDPlus.sol — the yield wrapper

Standard ERC-4626, underlying asset = PUSD. This contract does **not** mint PUSD; PUSDManager does. PUSDPlus just receives PUSD, wraps shares, and tracks NAV.

### Storage

```
asset                  : address   (= PUSD)
pusdManager            : address
pusdLiquidity          : address

performanceFeeBps      : uint256   (default 1000 = 10%, max 2000)
performanceFeeRecipient: address
highWaterMarkPUSD      : uint256   (for performance-fee crystallisation)

paused                 : bool
// standard ERC-4626 / ERC-20 state from OZ base
```

### Roles

| Role | Holder | |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Multisig | |
| `ADMIN_ROLE` | Multisig | fee params, pause |
| `LIQUIDITY_ROLE` | PUSDLiquidity | (future use — explicit NAV push) |
| `UPGRADER_ROLE` | 48h Timelock | |

### NAV (`totalAssets`)

```solidity
function totalAssets() public view override returns (uint256) {
    // PUSD held directly by this vault (idle + any buffered)
    uint256 idlePUSD = IERC20(asset).balanceOf(address(this));
    // PUSD-equivalent claim on yieldShareReserve + strategies
    uint256 liquidityNav = IPUSDLiquidity(pusdLiquidity).netAssetsInPUSD();
    return idlePUSD + liquidityNav;
}
```

Crucially: `netAssetsInPUSD()` returns the PUSD-equivalent net value of the yield tier — that is, `yieldShareReserve` aggregated + deployed strategy NAVs — all normalised to 6-decimal PUSD units. This is why `pps` is monotonic and meaningful.

### User entrypoints (convenience over vanilla ERC-4626)

```solidity
// Single-call flow: user sends stablecoin, receives PUSD+ shares.
// Handles the Manager.mintForVault atomically.
function depositStable(address token, uint256 amount, address receiver)
    external returns (uint256 shares);

// Inverse.
function redeemToStable(uint256 shares, address token, address receiver)
    external returns (uint256 tokenOut);

// Pure ERC-4626 paths (user already holds PUSD, wants PUSD+)
function deposit(uint256 pusdAmount, address receiver) external returns (uint256 shares);
function withdraw(uint256 pusdAmount, address receiver, address owner) external returns (uint256 shares);
function mint(uint256 shares, address receiver) external returns (uint256 pusdAmount);
function redeem(uint256 shares, address receiver, address owner) external returns (uint256 pusdAmount);
```

### Performance fee

On every `totalAssets()` evaluation, if it exceeds the prior `highWaterMarkPUSD`, the delta is the realised gain. A fraction (`performanceFeeBps`, 10% default) is skimmed into the fee recipient and mints the equivalent PUSD+ shares to them; the rest accrues to existing PUSD+ holders.

This is the standard Yearn-style HWM model. It means existing holders are never diluted on pps drawdowns and the fee only hits realised upside.

### Pause

`ADMIN_ROLE` can pause deposits and withdrawals. Pause is a crisis tool (e.g. a strategy exploit discovered) and does not go through the timelock.

---

## PUSDLiquidity.sol — the Uniswap V3 LP engine

Owned by PUSDPlus. Holds USDC/USDT pulled from `yieldShareReserve` and opens concentrated-liquidity positions on a single Uniswap V3 USDC/USDT pool on Push Chain. The contract wraps `INonfungiblePositionManager` for position lifecycle and an internal `UniV3Router` for slippage-bounded swaps during unwind.

### Storage

```
pusdPlus                : address
pusdManager             : address
npm                     : INonfungiblePositionManager
router                  : UniV3Router
usdc                    : address
usdt                    : address
poolUsdcUsdt            : address

maxDeployableBps        : uint16     (≤ HARD_CAP_BPS = 5000; launch 3000)
emergencyLiquidityBps   : uint16     (default 3000 — min idle % of yieldShareReserve)
lpSwapSlippageBps       : uint16     (default 50 — max swap slippage per rebalance)

positions               : Position[] (length ≤ MAX_POSITIONS = 10)
positionByTokenId       : mapping(uint256 => uint256)   // tokenId → index + 1
```

Position record:
```solidity
struct Position { uint256 tokenId; address pool; int24 tickLower; int24 tickUpper; bool active; }
```

### Roles

| Role | Holder | |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Multisig | |
| `ADMIN_ROLE` | Multisig | set caps, pool, router |
| `REBALANCER_ROLE` | Operator / keeper | open/adjust/close positions |
| `VAULT_ROLE` | PUSDPlus | pull capital on user withdraws |
| `PAUSER_ROLE` | Multisig + incident responder | pause new deployment only |
| `UPGRADER_ROLE` | 48h Timelock | |

### External surface

**Reporting (called by PUSDPlus)**
```solidity
function netAssetsInPUSD() external view returns (uint256);
```

Sums `idleInPUSD + Σ positionValue(positions[i].tokenId).valueInPUSD + uncollectedFeesInPUSD`. `positionValue` derives from `npm.positions(tokenId)` + `pool.slot0.sqrtPriceX96` via `LiquidityAmounts`. All numbers normalise to PUSD 6-decimal units using the same helpers as PUSDManager.

**Operations (`REBALANCER_ROLE`)**
```solidity
function mintPosition(address pool, int24 tickLower, int24 tickUpper,
    uint256 amount0, uint256 amount1, uint256 minAmount0, uint256 minAmount1)
    external whenNotPaused returns (uint256 tokenId);

function increaseLiquidity(uint256 tokenId, uint256 amount0, uint256 amount1,
    uint256 minAmount0, uint256 minAmount1) external whenNotPaused;

function decreaseLiquidity(uint256 tokenId, uint128 liquidity,
    uint256 minAmount0, uint256 minAmount1)
    external returns (uint256 amount0, uint256 amount1);

function collectFees(uint256 tokenId)
    external returns (uint256 amount0, uint256 amount1);

function closePosition(uint256 tokenId, uint256 minAmount0, uint256 minAmount1) external;
```

All mints/increases are bounded by both `maxDeployableBps` (global) and `emergencyLiquidityBps` (idle floor).

**Vault-facing**
```solidity
function pullForWithdraw(address token, uint256 amount, address recipient)
    external onlyRole(VAULT_ROLE) returns (uint256 delivered);

function pushForDeploy(address token, uint256 amount) external onlyRole(VAULT_ROLE);
```

`pullForWithdraw` algorithm: (1) if idle suffices, transfer. (2) else `decreaseLiquidity` from `positions[]` in insertion order + `collectFees`, using legs directly when possible. (3) if the legs don't match `token`, route the surplus leg through `router.swapExactInput` capped at `lpSwapSlippageBps`. (4) if `delivered < amount`, revert `InsufficientLiquidity`; a future ADR introduces an async queue.

**Admin**
```solidity
function setMaxDeployableBps(uint16 bps) external;          // <= HARD_CAP_BPS (5000)
function setEmergencyLiquidityBps(uint16 bps) external;     // <= 5000
function setLpSwapSlippageBps(uint16 bps) external;         // <= 100
function setPool(address pool) external;                    // only while positions.length == 0
function setRouter(UniV3Router newRouter) external;
function recoverDust(address token, address to, uint256 amount) external;
```

---

## Decimal normalisation

Unchanged from v1 in semantics. PUSD is 6 decimals. Each supported stablecoin may be 6 or 18 decimals. The helpers `_normalizeDecimalsToPUSD` and `_convertFromPUSD` in PUSDManager are used by both the plain and vault entrypoints.

PUSDLiquidity uses the same convention when computing `netAssetsInPUSD`.

---

## What does not change from v1

- The TokenStatus lifecycle (`REMOVED`, `ENABLED`, `REDEEM_ONLY`, `EMERGENCY_REDEEM`).
- The basket redemption semantics (now scoped to `parReserve` only for plain-PUSD redeem).
- The surplus haircut / preferred-fee / base-fee model.
- The reentrancy guard in PUSDManager.
- ADR 0001 (separation of token and reserve) and ADR 0002 (role-based access).

---

## Upgrade safety

- All four contracts use UUPS proxies.
- `UPGRADER_ROLE` on each held by a 48h `TimelockController`.
- New storage variables are always appended; existing slots are never reordered.
- `forge inspect <Contract> storageLayout` is diffed before and after every upgrade.

See [invariants.md](invariants.md) and [risks.md](risks.md) for the safety properties the architecture must preserve.

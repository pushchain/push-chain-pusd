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
  │  holds unwrapped stablecoins       │
  │  and LP tokens; never holds PUSD   │
  │  deploys via IStrategyAdapter      │
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

    // v2 additions — for rate-bearing reserve composition
    address rateBearingWrapper;   // e.g. sDAI address; address(0) if none
    address unwrapAdapter;         // adapter that converts rate-bearing → base
}
```

If `rateBearingWrapper != address(0)`, PUSDManager may hold the yield-share slice for this token in the wrapped form. Deposit always accepts the base token; wrapping/unwrapping happens inside the Manager.

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

## PUSDLiquidity.sol — the strategy engine

Owned by PUSDPlus. Holds unwrapped stablecoins pulled from `yieldShareReserve` and deploys them via pluggable `IStrategyAdapter` instances.

### Storage

```
pusdPlus           : address
pusdManager        : address

maxDeployableBps   : uint256   (≤ 3500; launch 2500)
strategies         : IStrategyAdapter[]
strategyEnabled    : mapping(address => bool)
strategyCapBps     : mapping(address => uint16)   // per-strategy sub-cap
```

### Roles

| Role | Holder | |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Multisig | |
| `ADMIN_ROLE` | Multisig | add/remove adapters, set caps |
| `REBALANCER_ROLE` | Operator / keeper | rebalance within caps |
| `VAULT_ROLE` | PUSDPlus | pull capital on user withdraws |
| `UPGRADER_ROLE` | 48h Timelock | |

### External surface

**Reporting (called by PUSDPlus)**
```solidity
function netAssetsInPUSD() external view returns (uint256);
```

Sums the PUSD-equivalent value held in this contract + every enabled adapter's `balanceInPUSD()`. Normalised to PUSD 6-decimal units via the same decimal helpers used in PUSDManager.

**Operations (`REBALANCER_ROLE`)**
```solidity
function deployToStrategy(address adapter, address token, uint256 amount) external;
function withdrawFromStrategy(address adapter, uint256 amount) external;
function harvestAll() external;   // claim rewards, swap to stable, report
```

All deploys are bounded by: `totalDeployedInPUSD() + marginalNewDeployInPUSD <= maxDeployableBps * PUSDPlus.totalAssets() / 10000`.

**Vault-facing**
```solidity
function pullForWithdraw(address token, uint256 amount, address recipient)
    external onlyRole(VAULT_ROLE) returns (uint256 delivered);
```

Called by `PUSDPlus.redeemToStable` when `PUSDManager.yieldShareReserve[token]` is below the required amount. PUSDLiquidity unwinds the smallest adapter that satisfies the request, transfers to `recipient`, and reports the amount delivered. If it cannot meet the request in full, the vault falls back to queueing (future ADR 0005).

**Admin**
```solidity
function setMaxDeployableBps(uint16 bps) external onlyRole(ADMIN_ROLE);   // <= 3500
function addStrategy(address adapter, uint16 capBps) external onlyRole(ADMIN_ROLE);
function removeStrategy(address adapter) external onlyRole(ADMIN_ROLE);
function emergencyUnwind(address adapter) external onlyRole(ADMIN_ROLE);
```

### IStrategyAdapter

```solidity
interface IStrategyAdapter {
    function deposit(address token, uint256 amount) external returns (uint256 sharesOrLP);
    function withdraw(uint256 amount) external returns (address token, uint256 delivered);
    function balanceInPUSD() external view returns (uint256);
    function harvest() external returns (uint256 rewardsInPUSD);
    function underlyingTokens() external view returns (address[] memory);
}
```

Launch adapters:
- `AaveV3SupplyAdapter` (USDC, USDT)
- `Curve3poolLPAdapter`
- `MorphoSupplyAdapter` (per whitelisted market)

Each is a short contract — typically under 250 lines — with its own unit tests.

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

# PUSDLiquidity.sol — Agent Context

Dense reference for AI-assisted work on `contracts/src/PUSDLiquidity.sol`. New in v2.

> The protocol's LP engine. Owned by PUSDPlus; holds USDC/USDT pulled from
> `yieldShareReserve` and deploys up to `maxDeployableBps` (hard cap **5000**)
> into Uniswap V3 USDC/USDT positions on Push Chain. Plain PUSD never touches
> this contract. Uniswap V3 is the sole execution venue — no Aave, Curve, or
> Morpho integrations exist on Push Chain today.
> See [ADR 0003 §4](../docs/design/decisions/0003-product-architecture.md#4--one-venue-capped-deployment)
> and [v2 contracts plan](../docs/design/v2-contracts-plan.md).

## File facts

| Property | Value |
|---|---|
| Path | `contracts/src/PUSDLiquidity.sol` |
| SPDX | MIT |
| Solidity | 0.8.22 |
| Proxy | UUPS |
| SafeERC20 | yes |
| External deps | `INonfungiblePositionManager`, `IUniswapV3Pool`, `UniV3Router` (internal) |
| Never holds | PUSD (only USDC/USDT + Uniswap V3 NFT positions) |

## Inheritance chain

```
PUSDLiquidity
  ├── Initializable
  ├── AccessControlUpgradeable
  ├── PausableUpgradeable
  ├── ReentrancyGuardUpgradeable
  └── UUPSUpgradeable
```

## Roles

```solidity
ADMIN_ROLE       = keccak256("ADMIN_ROLE")
REBALANCER_ROLE  = keccak256("REBALANCER_ROLE")
VAULT_ROLE       = keccak256("VAULT_ROLE")       // held by PUSDPlus
PAUSER_ROLE      = keccak256("PAUSER_ROLE")
UPGRADER_ROLE    = keccak256("UPGRADER_ROLE")
// DEFAULT_ADMIN_ROLE inherited
```

| Role | Holder |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Multisig |
| `ADMIN_ROLE` | Multisig |
| `REBALANCER_ROLE` | Operator hot wallet / keeper |
| `VAULT_ROLE` | PUSDPlus (sole) |
| `PAUSER_ROLE` | Multisig + incident responder |
| `UPGRADER_ROLE` | 48h Timelock |

## Storage

```
pusdPlus                : address
pusdManager             : address
npm                     : INonfungiblePositionManager  // Uniswap V3 position manager
router                  : UniV3Router                  // internal swap wrapper
usdc                    : address
usdt                    : address
poolUsdcUsdt            : address                      // USDC/USDT 100-bps pool

maxDeployableBps        : uint16     // <= HARD_CAP_BPS
emergencyLiquidityBps   : uint16     // default 3000 — min idle % of yieldShareReserve
lpSwapSlippageBps       : uint16     // default 50 — max swap slippage per rebalance

positions               : Position[]                   // <= MAX_POSITIONS
positionByTokenId       : mapping(uint256 => uint256)  // tokenId → positions[] index + 1
```

```solidity
struct Position {
    uint256 tokenId;
    address pool;
    int24   tickLower;
    int24   tickUpper;
    bool    active;          // false after full unwind; slot reserved for audit trail
}
```

## Constants

```solidity
uint16 public constant HARD_CAP_BPS             = 5000;   // ADR 0003 §8
uint16 public constant HARD_EMERGENCY_BPS       = 5000;   // emergencyLiquidityBps ceiling
uint16 public constant HARD_SLIPPAGE_BPS        = 100;    // lpSwapSlippageBps ceiling (1%)
uint8  public constant MAX_POSITIONS            = 10;
uint256 private constant BASIS_POINTS           = 10000;
uint16 public constant NAV_DRIFT_TOLERANCE_BPS  = 10;     // I-13 bound
```

## External functions

### Reporting (view — called by PUSDPlus and the frontend)

```solidity
function netAssetsInPUSD() external view returns (uint256);
// = idleInPUSD + Σ positionValue(positions[i].tokenId) + uncollectedFeesInPUSD

function totalDeployedInPUSD() external view returns (uint256);
// = Σ positionValue(positions[i].tokenId) (excludes idle + uncollected fees)

function idleBalance(address token) external view returns (uint256);
// IERC20(token).balanceOf(address(this))

function positionValue(uint256 tokenId)
    external view returns (uint256 amount0, uint256 amount1, uint256 valueInPUSD);
// derived from npm.positions(tokenId) + pool.slot0.sqrtPriceX96 via LiquidityAmounts

function inRange(uint256 tokenId) external view returns (bool);
// slot0.tick ∈ [tickLower, tickUpper]

function positionCount() external view returns (uint256);
```

### Operations (REBALANCER_ROLE)

```solidity
function mintPosition(
    address pool,
    int24 tickLower,
    int24 tickUpper,
    uint256 amount0,
    uint256 amount1,
    uint256 minAmount0,
    uint256 minAmount1
) external onlyRole(REBALANCER_ROLE) nonReentrant whenNotPaused returns (uint256 tokenId);

function increaseLiquidity(
    uint256 tokenId,
    uint256 amount0,
    uint256 amount1,
    uint256 minAmount0,
    uint256 minAmount1
) external onlyRole(REBALANCER_ROLE) nonReentrant whenNotPaused;

function decreaseLiquidity(
    uint256 tokenId,
    uint128 liquidity,
    uint256 minAmount0,
    uint256 minAmount1
) external onlyRole(REBALANCER_ROLE) nonReentrant returns (uint256 amount0, uint256 amount1);

function collectFees(uint256 tokenId)
    external onlyRole(REBALANCER_ROLE) nonReentrant returns (uint256 amount0, uint256 amount1);

function closePosition(uint256 tokenId, uint256 minAmount0, uint256 minAmount1)
    external onlyRole(REBALANCER_ROLE) nonReentrant;
// decreaseLiquidity(max) + collectFees + npm.burn; marks position.active = false
```

Guards on `mintPosition` / `increaseLiquidity`:
- `positions.length < MAX_POSITIONS` (mintPosition only).
- `pool == poolUsdcUsdt` at launch; opening a position on any other pool requires ADR + admin whitelist.
- `tickLower < tickUpper`, both aligned to `pool.tickSpacing()`.
- Post-call: `totalDeployedInPUSD() <= maxDeployableBps * PUSDPlus.totalAssets() / BASIS_POINTS` (I-12).
- Post-call: `idleInPUSD >= emergencyLiquidityBps * yieldShareReserveInPUSD / BASIS_POINTS`.

### Vault-facing (VAULT_ROLE)

```solidity
function pullForWithdraw(address token, uint256 amount, address recipient)
    external onlyRole(VAULT_ROLE) nonReentrant returns (uint256 delivered);

function pushForDeploy(address token, uint256 amount) external onlyRole(VAULT_ROLE);
// Called by PUSDPlus via Manager when new yieldShareReserve arrives; just credits idle.
```

`pullForWithdraw` algorithm:
1. If `idleBalance(token) >= amount` → transfer + return.
2. Else, iterate `positions[]` in insertion order and `decreaseLiquidity` proportionally until the combined `amount0 + amount1` ≥ shortfall. `collectFees` along the way.
3. If the withdrawn legs don't match `token` (e.g. user wants USDC, pool returned USDT), route the surplus leg through `router.swapExactInput` with `lpSwapSlippageBps` cap.
4. Transfer `delivered` to `recipient`. If `delivered < amount`, revert `InsufficientLiquidity(requested, delivered)`. (Launch behaviour; ADR 0005 introduces an async queue.)

### Admin (ADMIN_ROLE)

```solidity
function setMaxDeployableBps(uint16 bps) external onlyRole(ADMIN_ROLE);       // <= HARD_CAP_BPS
function setEmergencyLiquidityBps(uint16 bps) external onlyRole(ADMIN_ROLE);  // <= HARD_EMERGENCY_BPS
function setLpSwapSlippageBps(uint16 bps) external onlyRole(ADMIN_ROLE);      // <= HARD_SLIPPAGE_BPS
function setPool(address pool) external onlyRole(ADMIN_ROLE);                 // only while positions.length == 0
function setRouter(UniV3Router newRouter) external onlyRole(ADMIN_ROLE);
function recoverDust(address token, address to, uint256 amount) external onlyRole(ADMIN_ROLE);
```

### Pause (PAUSER_ROLE)

```solidity
function pause() external onlyRole(PAUSER_ROLE);
function unpause() external onlyRole(PAUSER_ROLE);
```

Paused state blocks `mintPosition` and `increaseLiquidity` only — `decreaseLiquidity`, `collectFees`, `closePosition`, and `pullForWithdraw` remain callable so redemptions survive.

### Upgrade (UPGRADER_ROLE)

```solidity
function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE);
```

## Events

```solidity
event PositionMinted(uint256 indexed tokenId, address indexed pool, int24 tickLower, int24 tickUpper, uint256 amount0, uint256 amount1);
event LiquidityIncreased(uint256 indexed tokenId, uint256 amount0, uint256 amount1);
event LiquidityDecreased(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
event FeesCollected(uint256 indexed tokenId, uint256 amount0, uint256 amount1);
event PositionClosed(uint256 indexed tokenId);
event VaultPull(address indexed token, uint256 amount, uint256 delivered, address indexed recipient);
event VaultPush(address indexed token, uint256 amount);
event MaxDeployableBpsSet(uint16 oldBps, uint16 newBps);
event EmergencyLiquidityBpsSet(uint16 oldBps, uint16 newBps);
event LpSwapSlippageBpsSet(uint16 oldBps, uint16 newBps);
event PoolSet(address pool);
event RouterSet(address router);
event Paused(address account);
event Unpaused(address account);
```

## Invariants touching PUSDLiquidity

- **I-10** — `nonReentrant` on every state-mutating function; sits as a leaf in the call DAG.
- **I-11** — zero-address guards on recipients, pools, routers.
- **I-12** — `totalDeployedInPUSD() <= maxDeployableBps * PUSDPlus.totalAssets() / BASIS_POINTS`.
- **I-13** (new) — LP accounting drift: `|netAssetsInPUSD() − (idleInPUSD + Σ positionValue + uncollectedFees)| / netAssetsInPUSD() <= NAV_DRIFT_TOLERANCE_BPS`. Monitored off-chain; a breach pauses the contract.
- `maxDeployableBps <= HARD_CAP_BPS`, `emergencyLiquidityBps <= HARD_EMERGENCY_BPS`, `lpSwapSlippageBps <= HARD_SLIPPAGE_BPS` always.
- `positions.length <= MAX_POSITIONS` always.

## Risks touching PUSDLiquidity

- **R-09** (LP fragility) — the primary risk surface. Covers out-of-range drift, pool peg divergence, swap slippage during unwind, and NPM interface changes.

## Upgrade safety

- Positions are keyed by NPM `tokenId`, which is immutable and survives upgrades.
- Changing the active pool is only allowed while `positions.length == 0`; migrating to a new pool requires closing every position first.
- `router` can be swapped live; its role is bounded to `swapExactInput` with slippage caps, so an upgraded router cannot exfiltrate funds.
- Storage is append-only after v2 genesis; never reorder existing slots.

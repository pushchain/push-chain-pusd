# PUSDLiquidity.sol — Agent Context

Dense reference for AI-assisted work on `contracts/src/PUSDLiquidity.sol`. New in v2.

> The protocol's strategy engine. Owned by PUSDPlus; holds stablecoins pulled from
> `yieldShareReserve` and deploys up to `maxDeployableBps` (hard cap 3500) into
> whitelisted `IStrategyAdapter` instances. Plain PUSD never touches this
> contract. See [ADR 0003 §4](../docs/design/decisions/0003-product-architecture.md#4--strategy-deployment-is-capped-reserve-composition-is-not).

## File facts

| Property | Value |
|---|---|
| Path | `contracts/src/PUSDLiquidity.sol` |
| SPDX | MIT |
| Solidity | 0.8.22 |
| Proxy | UUPS |
| SafeERC20 | yes |
| Never holds | PUSD (only base stablecoins + LP tokens) |

## Inheritance chain

```
PUSDLiquidity
  ├── Initializable
  ├── AccessControlUpgradeable
  ├── PausableUpgradeable
  └── UUPSUpgradeable
```

## Roles

```solidity
ADMIN_ROLE       = keccak256("ADMIN_ROLE")
REBALANCER_ROLE  = keccak256("REBALANCER_ROLE")
VAULT_ROLE       = keccak256("VAULT_ROLE")       // held by PUSDPlus
UPGRADER_ROLE    = keccak256("UPGRADER_ROLE")
// DEFAULT_ADMIN_ROLE inherited
```

| Role | Holder |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Multisig |
| `ADMIN_ROLE` | Multisig |
| `REBALANCER_ROLE` | Operator hot wallet / keeper |
| `VAULT_ROLE` | PUSDPlus (sole) |
| `UPGRADER_ROLE` | 48h Timelock |

## Storage

```
pusdPlus              : address       // sole VAULT_ROLE holder
pusdManager           : address       // for decimal helpers + allowed-tokens list

maxDeployableBps      : uint16        // <= HARD_CAP; launch 2500
strategies            : address[]     // ordered list
strategyEnabled       : mapping(address => bool)
strategyCapBps        : mapping(address => uint16)    // per-strategy sub-cap
strategyDeployedPUSD  : mapping(address => uint256)   // snapshot for caps

paused                : bool
```

## Constants

```solidity
uint16 public constant HARD_CAP_BPS      = 3500;    // ADR 0003 §8
uint16 public constant MAX_STRATEGIES    = 16;
uint256 private constant BASIS_POINTS    = 10000;
```

## External functions

### Reporting (view — called by PUSDPlus)

```solidity
function netAssetsInPUSD() external view returns (uint256);
// = idleBalanceInPUSD(self) + Σ strategy.balanceInPUSD() for enabled strategies
```

```solidity
function totalDeployedInPUSD() external view returns (uint256);
// = Σ strategy.balanceInPUSD() for enabled strategies (excludes idle balances)
```

```solidity
function idleBalance(address token) external view returns (uint256);
// IERC20(token).balanceOf(address(this))
```

### Operations (REBALANCER_ROLE)

```solidity
function deployToStrategy(address adapter, address token, uint256 amount)
    external onlyRole(REBALANCER_ROLE) nonReentrant whenNotPaused;

function withdrawFromStrategy(address adapter, uint256 amount)
    external onlyRole(REBALANCER_ROLE) nonReentrant;

function harvestAll() external onlyRole(REBALANCER_ROLE) nonReentrant;
```

Guards on `deployToStrategy`:
- `strategyEnabled[adapter]` must be true.
- Post-call, `totalDeployedInPUSD() <= maxDeployableBps * PUSDPlus.totalAssets() / 10_000` (I-12).
- Post-call, `strategyDeployedPUSD[adapter] <= strategyCapBps[adapter] * PUSDPlus.totalAssets() / 10_000`.
- `token` must be in the Manager's supportedTokens and in `adapter.underlyingTokens()`.

### Vault-facing (VAULT_ROLE — called by PUSDPlus via Manager)

```solidity
function pullForWithdraw(address token, uint256 amount, address recipient)
    external onlyRole(VAULT_ROLE) nonReentrant returns (uint256 delivered);
```

Algorithm:
1. If `idleBalance(token) >= amount`, transfer and return.
2. Else, rank enabled strategies by instant-unwind cost (Aave supply cheapest; Curve LP costs swap slippage; Morpho is market-dependent). Unwind from cheapest until `amount` satisfied or all exhausted.
3. Transfer `delivered` to `recipient`. If `delivered < amount`, revert `InsufficientLiquidity(requested, delivered)`. (Launch behaviour; future ADR 0005 introduces async queue.)

### Admin (ADMIN_ROLE)

```solidity
function setMaxDeployableBps(uint16 bps) external onlyRole(ADMIN_ROLE);      // <= HARD_CAP_BPS
function addStrategy(address adapter, uint16 capBps) external onlyRole(ADMIN_ROLE);
function removeStrategy(address adapter) external onlyRole(ADMIN_ROLE);       // must be at 0 deployed
function setStrategyCapBps(address adapter, uint16 capBps) external onlyRole(ADMIN_ROLE);
function emergencyUnwind(address adapter) external onlyRole(ADMIN_ROLE) nonReentrant;
function pause() external;
function unpause() external;
```

### Upgrade (UPGRADER_ROLE)

```solidity
function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE);
```

## `IStrategyAdapter`

```solidity
interface IStrategyAdapter {
    function deposit(address token, uint256 amount) external returns (uint256 sharesOrLP);
    function withdraw(uint256 amount) external returns (address token, uint256 delivered);
    function balanceInPUSD() external view returns (uint256);
    function harvest() external returns (uint256 rewardsInPUSD);
    function underlyingTokens() external view returns (address[] memory);
    function instantUnwindCapacity(address token) external view returns (uint256);
}
```

Launch adapters:
- `AaveV3SupplyAdapter` — holds aTokens for USDC and USDT. Instant unwind via Aave `withdraw`. Harvest is a no-op (interest accrues in aToken balance).
- `Curve3poolLPAdapter` — holds 3pool LP; harvests CRV + optionally CVX/LDO; swaps to USDC. Unwind cost is slippage on `remove_liquidity_one_coin`.
- `MorphoSupplyAdapter` — holds Morpho supply-market share. One instance per whitelisted market. Instant unwind bounded by market liquidity.

Each adapter's `balanceInPUSD()` must be implemented using the same pricing path as its `withdraw()` to prevent NAV ≠ exit-price drift.

## Events

```solidity
event StrategyAdded(address indexed adapter, uint16 capBps);
event StrategyRemoved(address indexed adapter);
event StrategyCapSet(address indexed adapter, uint16 oldBps, uint16 newBps);
event MaxDeployableBpsSet(uint16 oldBps, uint16 newBps);
event Deployed(address indexed adapter, address indexed token, uint256 amount, uint256 newStrategyBalancePUSD);
event Withdrawn(address indexed adapter, uint256 amountPUSD, uint256 newStrategyBalancePUSD);
event Harvested(address indexed adapter, uint256 rewardsPUSD);
event EmergencyUnwound(address indexed adapter, uint256 recoveredPUSD);
event VaultPull(address indexed token, uint256 amount, uint256 delivered, address indexed recipient);
event Paused(address account);
event Unpaused(address account);
```

## Invariants touching PUSDLiquidity

- I-12: `totalDeployedInPUSD() <= maxDeployableBps * PUSDPlus.totalAssets() / 10_000`.
- I-10: `nonReentrant` on every state-mutating function; sits as a leaf in the call DAG.
- I-11: zero-address guards on adapters, tokens, recipients.
- `maxDeployableBps <= HARD_CAP_BPS` always.

## Risks touching PUSDLiquidity

- R-09 (strategy failure) — the primary risk surface for this contract.

## Upgrade safety

- All storage appended after v1 slots (there are none — this is a new contract).
- Strategy state is keyed by adapter address; upgrading an adapter requires `removeStrategy(old)` + `addStrategy(new)` with full unwind in between.

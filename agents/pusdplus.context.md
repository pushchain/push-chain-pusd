# PUSDPlus.sol — Agent Context

Dense reference for AI-assisted work on `contracts/src/PUSDPlus.sol`. New in v2.

> ERC-4626 yield-bearing wrapper over PUSD. Holders earn blended yield from
> rate-bearing reserve wrappers and `PUSDLiquidity` strategies. See
> [ADR 0003 §2](../docs/design/decisions/0003-product-architecture.md#2--four-contracts-clean-separation).

## File facts

| Property | Value |
|---|---|
| Path | `contracts/src/PUSDPlus.sol` |
| SPDX | MIT |
| Solidity | 0.8.22 |
| Proxy | UUPS |
| Standard | ERC-4626 |
| Underlying asset | PUSD (6 decimals) |
| Share decimals | 18 (per ERC-4626 convention) |
| Symbol | "PUSD+" |
| Name | "Push USD Plus" |

## Inheritance chain

```
PUSDPlus
  ├── Initializable
  ├── ERC20Upgradeable
  ├── ERC4626Upgradeable
  ├── AccessControlUpgradeable
  ├── PausableUpgradeable
  └── UUPSUpgradeable
```

## Roles

```solidity
ADMIN_ROLE      = keccak256("ADMIN_ROLE")
LIQUIDITY_ROLE  = keccak256("LIQUIDITY_ROLE")   // held by PUSDLiquidity (future: push-NAV)
UPGRADER_ROLE   = keccak256("UPGRADER_ROLE")
// DEFAULT_ADMIN_ROLE inherited
```

| Role | Holder |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Multisig |
| `ADMIN_ROLE` | Multisig |
| `LIQUIDITY_ROLE` | PUSDLiquidity (sole) |
| `UPGRADER_ROLE` | 48h Timelock |

## Storage (declaration order — upgrade-safe)

```
// ERC4626 / ERC20 / AccessControl / Pausable / UUPS slots (OZ-inherited, front)

pusd                    : address      // underlying asset
pusdManager             : address      // for mintForVault / redeemForVault calls
pusdLiquidity           : address      // for netAssetsInPUSD() NAV component

performanceFeeBps       : uint16       // launch 1000 = 10%; max 2000
performanceFeeRecipient : address

highWaterMarkPUSD       : uint256      // last seen totalAssets at HWM; used for fee crystallisation
accruedFeeShares        : uint256      // shares owed to recipient, not yet distributed
```

## Constants

```solidity
uint256 public constant MAX_PERFORMANCE_FEE_BPS = 2000;   // 20%
uint256 private constant BASIS_POINTS           = 10000;
uint256 private constant PAR_NAV_SCALE          = 1e6;    // PUSD decimals
```

## Core accounting

### `asset()` → `address`
Returns `pusd`.

### `totalAssets()` → `uint256`
```solidity
function totalAssets() public view override returns (uint256) {
    // Idle PUSD held directly by this vault
    uint256 idle = IERC20(pusd).balanceOf(address(this));
    // PUSD-equivalent claim on yieldShareReserve + deployed strategies
    uint256 claim = IPUSDLiquidity(pusdLiquidity).netAssetsInPUSD();
    return idle + claim;
}
```

### `convertToShares(uint256 assets)` / `convertToAssets(uint256 shares)`
Standard ERC-4626 using `totalSupply` and `totalAssets` with OZ rounding conventions (down on deposit, down on withdraw).

Virtual-shares protection is enabled via `_decimalsOffset()` returning 6 — this forces the initial attacker to deposit >>1 PUSD to meaningfully move `pps`, shutting down the classic ERC-4626 inflation attack.

### `pricePerShare()` → `uint256`  *(helper)*
```
pps = totalAssets() * 1e18 / totalSupply()   // 18-decimal fixed point
```

Invariant I-01b requires `pps >= 1e18` at all times (ignoring the OZ virtual-shares rounding floor).

## External functions

### User entrypoints — high level (convenience wraps for mintForVault / redeemForVault)

```solidity
function depositStable(address token, uint256 amount, address receiver)
    external whenNotPaused returns (uint256 shares);

function redeemToStable(uint256 shares, address token, address receiver)
    external whenNotPaused returns (uint256 tokenOut);
```

Flow (`depositStable`):
1. `_crystalliseFees()` — update HWM and mint fee-shares to recipient if due.
2. `transferFrom(msg.sender, self, amount)` of the stable token.
3. `approve(pusdManager, amount)`.
4. `pusd := pusdManager.mintForVault(token, amount, self)` — PUSD arrives at this vault.
5. `shares := previewDeposit(pusd)`.
6. `_mint(receiver, shares)`.
7. Emit `Deposit`.

Flow (`redeemToStable`):
1. `_crystalliseFees()`.
2. `pusdOwed := previewRedeem(shares)`.
3. `_burn(owner, shares)`.
4. `pusd.approve(pusdManager, pusdOwed)`.
5. `tokenOut := pusdManager.redeemForVault(pusdOwed, token, receiver)` — stablecoin delivered to receiver.
6. Emit `Withdraw`.

### User entrypoints — pure ERC-4626 (for users holding PUSD directly)

Standard `deposit`, `mint`, `withdraw`, `redeem`. These do NOT touch PUSDManager — they operate on PUSD that's already in the user's wallet (they can get PUSD via `PUSDManager.deposit`).

### Admin (ADMIN_ROLE)

```solidity
function setPerformanceFeeBps(uint16 bps) external;             // <= 2000
function setPerformanceFeeRecipient(address r) external;
function pause() external;                                      // sets `paused = true`
function unpause() external;
function crystalliseFees() external;                            // manual HWM update
```

### Upgrade (UPGRADER_ROLE)

```solidity
function _authorizeUpgrade(address newImpl) internal override onlyRole(UPGRADER_ROLE);
```

## Performance fee — high-water-mark model

On every user-facing state-mutating call, `_crystalliseFees()` runs:

```
assetsNow := totalAssets()
if assetsNow > highWaterMarkPUSD:
    delta   := assetsNow - highWaterMarkPUSD
    feeRaw  := delta * performanceFeeBps / 10_000
    feeShares := convertToShares(feeRaw)
    _mint(performanceFeeRecipient, feeShares)
    highWaterMarkPUSD := assetsNow
```

- Only mints fee shares on *realised* NAV increase.
- No dilution at crystallisation: minted at current `pps`.
- No fee charged on drawdowns; HWM can only rise.

## Events

```solidity
event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
event PerformanceFeeCrystallised(uint256 deltaPUSD, uint256 feeShares, uint256 newHighWaterMark);
event PerformanceFeeBpsSet(uint16 oldBps, uint16 newBps);
event PerformanceFeeRecipientSet(address indexed oldR, address indexed newR);
event Paused(address account);
event Unpaused(address account);
```

## Invariants touching PUSDPlus

- I-01b: `pps >= 1e18` (NAV never below par).
- I-03: does NOT hold `MINTER_ROLE` on PUSD; mints only via `PUSDManager.mintForVault`.
- I-04: burn-before-transfer on vault redeems.
- I-10: reentrancy safe; fits in the DAG `PUSDPlus → PUSDManager → PUSDLiquidity`.
- I-11: zero-address guards on receiver / owner / recipient.

## Integration map

```
user ──depositStable──▶ PUSDPlus
                         │
                         ├── mintForVault ──▶ PUSDManager
                         │                    (credits yieldShareReserve, mints PUSD to PUSDPlus)
                         │
                         └── (shares minted to user)

user ──redeemToStable──▶ PUSDPlus
                         │
                         ├── _burn(shares)
                         │
                         └── redeemForVault ──▶ PUSDManager
                                                (pulls from yieldShareReserve,
                                                 calls PUSDLiquidity.pullForWithdraw if short,
                                                 burns PUSD, sends token to user)
```

## Not in v1 launch (future ADR work)

- ERC-7540 async `requestRedeem` queue for oversized withdraws (ADR 0005 candidate).
- Multi-asset NAV view — at launch the UI shows USD terms only.
- Cross-chain PUSD+ shares (requires a bridge ADR).

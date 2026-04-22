# PUSD.sol — Agent Context

Dense reference for AI-assisted work on `contracts/src/PUSD.sol`.

> Unchanged from v1. Under ADR 0003, PUSD remains a minimal ERC-20; PUSDPlus does
> not hold `MINTER_ROLE` and always mints through `PUSDManager.mintForVault`.

## File facts

| Property | Value |
|---|---|
| Path | `contracts/src/PUSD.sol` |
| SPDX | MIT |
| Solidity | 0.8.22 |
| Lines | 58 |
| Proxy pattern | UUPS (OpenZeppelin) |
| Token decimals | 6 |
| Token name | "Push USD" |
| Token symbol | "PUSD" |

## Inheritance chain

```
PUSD
  ├── Initializable            (OZ upgradeable)
  ├── ERC20Upgradeable         (OZ upgradeable)
  ├── AccessControlUpgradeable (OZ upgradeable)
  └── UUPSUpgradeable          (OZ upgradeable)
```

## Roles (bytes32 constants)

```solidity
MINTER_ROLE   = keccak256("MINTER_ROLE")
BURNER_ROLE   = keccak256("BURNER_ROLE")
UPGRADER_ROLE = keccak256("UPGRADER_ROLE")
// DEFAULT_ADMIN_ROLE inherited from AccessControl (bytes32(0))
```

## Role holders

| Role | Holder at launch |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Multisig |
| `UPGRADER_ROLE` | 48h TimelockController |
| `MINTER_ROLE` | PUSDManager (sole) |
| `BURNER_ROLE` | PUSDManager (sole) |

## Functions

### `constructor()`
- Calls `_disableInitializers()`.
- `@custom:oz-upgrades-unsafe-allow constructor`

### `initialize(address admin)`
- `public initializer`
- `__ERC20_init("Push USD", "PUSD")`, `__AccessControl_init()`.
- Grants `DEFAULT_ADMIN_ROLE` and `UPGRADER_ROLE` to `admin`.
- Does NOT grant `MINTER_ROLE` / `BURNER_ROLE` — must be granted to PUSDManager separately.

### `decimals() → uint8`
Returns `6`.

### `mint(address to, uint256 amount)`
- `external onlyRole(MINTER_ROLE)`
- Guards: `to != address(0)`, `amount > 0`.
- `_mint(to, amount)`. Emits `Minted`.

### `burn(address from, uint256 amount)`
- `external onlyRole(BURNER_ROLE)`
- Guards: `from != address(0)`, `amount > 0`, `balanceOf(from) >= amount`.
- `_burn(from, amount)`. Emits `Burned`.

### `_authorizeUpgrade(address newImplementation)`
- `internal override onlyRole(UPGRADER_ROLE)` — empty body; role check is the authorisation.

## Events

```solidity
event Minted(address indexed to, uint256 amount, address indexed minter);
event Burned(address indexed from, uint256 amount, address indexed burner);
```

## What PUSD does NOT do

- Does not know about collateral, fees, or the reserve.
- Does not know about PUSD+ or the yield layer.
- No pause, no supply cap, no allow/blocklist.

## Invariants touching PUSD

- I-03: supply changes only via PUSDManager paths.
- I-04: burn precedes transfer on every redeem flow.
- I-10: no reentrant mint via MINTER_ROLE path.
- I-11: zero-address guards on mint/burn inputs.

## Upgrade safety

- Storage: ERC20 + AccessControl + UUPS slots (all OZ standard).
- Any upgrade **must** preserve `_balances`, `_allowances`, `_totalSupply` slots (inherited from OZ ERC20).
- Adding a supply cap, pause, or allowlist requires a fresh upgrade + re-audit.

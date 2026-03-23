# PUSD.sol — Agent Context

Dense reference for AI-assisted work on `contracts/src/PUSD.sol`.

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
  ├── Initializable          (OZ upgradeable)
  ├── ERC20Upgradeable       (OZ upgradeable)
  ├── AccessControlUpgradeable (OZ upgradeable)
  └── UUPSUpgradeable        (OZ upgradeable)
```

## Roles (bytes32 constants)

```solidity
MINTER_ROLE   = keccak256("MINTER_ROLE")
BURNER_ROLE   = keccak256("BURNER_ROLE")
UPGRADER_ROLE = keccak256("UPGRADER_ROLE")
// DEFAULT_ADMIN_ROLE inherited from AccessControl (bytes32(0))
```

## Functions

### `constructor()`
- Calls `_disableInitializers()` — prevents initialisation on the implementation contract.
- `@custom:oz-upgrades-unsafe-allow constructor`

### `initialize(address admin)`
- `public initializer`
- Calls `__ERC20_init("Push USD", "PUSD")` and `__AccessControl_init()`.
- Grants `DEFAULT_ADMIN_ROLE` and `UPGRADER_ROLE` to `admin`.
- **Does NOT grant `MINTER_ROLE` or `BURNER_ROLE`** — these must be granted separately (to `PUSDManager`).

### `decimals() → uint8`
- Overrides ERC20 default. Returns `6`.

### `mint(address to, uint256 amount)`
- `external onlyRole(MINTER_ROLE)`
- Guards: `to != address(0)`, `amount > 0`.
- Calls `_mint(to, amount)`.
- Emits `Minted(to, amount, msg.sender)`.

### `burn(address from, uint256 amount)`
- `external onlyRole(BURNER_ROLE)`
- Guards: `from != address(0)`, `amount > 0`, `balanceOf(from) >= amount`.
- Calls `_burn(from, amount)`.
- Emits `Burned(from, amount, msg.sender)`.

### `_authorizeUpgrade(address newImplementation)`
- `internal override onlyRole(UPGRADER_ROLE)`
- Required by UUPS pattern; empty body — the role check is the full authorisation.

## Events

```solidity
event Minted(address indexed to, uint256 amount, address indexed minter);
event Burned(address indexed from, uint256 amount, address indexed burner);
```

## What PUSD does NOT do

- No knowledge of collateral, fees, or redemption routing.
- No pause/unpause mechanism.
- No supply cap.
- No allowlist or blocklist.

## Common editing patterns

**Add a supply cap:**
```solidity
uint256 public maxSupply;
// in mint(): require(totalSupply() + amount <= maxSupply, "PUSD: cap exceeded");
```

**Add pause:**
```solidity
// inherit PausableUpgradeable; add whenNotPaused to mint/burn
```

**Change decimals:** Only possible via upgrade — stored decimals are returned by override. Changing on a live token breaks all existing integrations.

## Upgrade safety notes

- No new storage variables may be inserted before existing ones in an upgrade.
- The proxy uses ERC1967 storage slots; do not declare variables that collide with those slots.
- Run `forge inspect PUSD storageLayout` to verify layout before any upgrade.

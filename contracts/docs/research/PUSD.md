# PUSD — Research Notes

## What is it?

`PUSD` (Push USD) is a USD-pegged ERC-20 stablecoin issued by the Push Chain protocol. It is a **thin, permission-gated token** — it has no knowledge of collateral, fees, or redemption logic. All business logic lives in `PUSDManager`.

- **Name:** Push USD
- **Symbol:** PUSD
- **Decimals:** 6 (matches USDC/USDT convention)
- **Upgradeable:** Yes — UUPS proxy pattern via OpenZeppelin

---
## 20-02-2026

## Contract Inheritance

```
PUSD
  ├── Initializable
  ├── ERC20Upgradeable
  ├── AccessControlUpgradeable
  └── UUPSUpgradeable
```

The constructor calls `_disableInitializers()` to prevent direct implementation initialization (standard UUPS safety pattern).

---

## Roles

| Role | Keccak constant | Capability |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | OZ default | Grant / revoke all other roles |
| `MINTER_ROLE` | `keccak256("MINTER_ROLE")` | Call `mint()` |
| `BURNER_ROLE` | `keccak256("BURNER_ROLE")` | Call `burn()` |
| `UPGRADER_ROLE` | `keccak256("UPGRADER_ROLE")` | Authorise UUPS proxy upgrade |

`initialize(admin)` grants only `DEFAULT_ADMIN_ROLE` and `UPGRADER_ROLE` to `admin`. `MINTER_ROLE` and `BURNER_ROLE` are **not** granted in `initialize` — they must be granted separately (the deployment script grants both to `PUSDManager`).

---

## Key Functions

### `initialize(address admin)`
- Calls `__ERC20_init("Push USD", "PUSD")` and `__AccessControl_init()`.
- Grants `DEFAULT_ADMIN_ROLE` and `UPGRADER_ROLE` to `admin`.

### `mint(address to, uint256 amount)` — `onlyRole(MINTER_ROLE)`
- Guards: `to != address(0)`, `amount > 0`.
- Calls `_mint(to, amount)`.
- Emits `Minted(to, amount, msg.sender)`.

### `burn(address from, uint256 amount)` — `onlyRole(BURNER_ROLE)`
- Guards: `from != address(0)`, `amount > 0`, `balanceOf(from) >= amount`.
- Calls `_burn(from, amount)`.
- Emits `Burned(from, amount, msg.sender)`.

### `decimals()` — `public view`
- Returns `6` (overrides OZ default of 18).

### `_authorizeUpgrade(address newImplementation)` — `onlyRole(UPGRADER_ROLE)`
- Empty body; the role check is the entire guard.

---

## Events

| Event | When emitted |
|---|---|
| `Minted(address indexed to, uint256 amount, address indexed minter)` | On every successful `mint()` |
| `Burned(address indexed from, uint256 amount, address indexed burner)` | On every successful `burn()` |

---

## Design Decisions

- **Separation of concerns:** PUSD knows nothing about collateral. This makes it trivially auditable and replaceable.
- **6 decimals:** Chosen to match USDC/USDT so that 1:1 accounting with those tokens is exact without scaling in the common case.
- **No pause mechanism:** There is no `pause()` on PUSD itself. Emergency control is exercised at the `PUSDManager` level via token status changes.
- **Burn is permissioned (not self-serve):** `burn()` requires `BURNER_ROLE`. Users cannot burn their own PUSD directly — they must go through `PUSDManager.redeem()`. This prevents supply manipulation outside the protocol.

---

## Invariants Relevant to PUSD

- **I-03** — PUSD can only be minted by `PUSDManager` via `deposit()`. No other path calls `mint()`. Enforced by `MINTER_ROLE` being held exclusively by `PUSDManager`.
- **I-04** — In every redemption path, `burn()` is called before or atomically with the outbound token transfer.
- **I-11** — `mint` and `burn` both guard against `address(0)`.

---

## Risks

- **R-02 (Admin Key Compromise):** If `DEFAULT_ADMIN_ROLE` on PUSD is compromised, an attacker can grant themselves `MINTER_ROLE` and mint unbacked PUSD. Mitigated by using a multisig as admin.
- **R-03 (UUPS Upgrade Risk):** A malicious or buggy upgrade can change storage layout or introduce exploits. `UPGRADER_ROLE` should follow a higher-security path (governance + timelock).

---

## Open Questions / Notes

- No on-chain timelock or governance currently enforces upgrade authorization — relies purely on key management.
- `MINTER_ROLE` and `BURNER_ROLE` are not granted at initialization — this is intentional (deployment script wires them up), but means a partially-deployed system is in a broken state until the deployment script completes.

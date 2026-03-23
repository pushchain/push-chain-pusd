# ADR 0001 – Why PUSDManager Exists as a Separate Contract

**Status:** Accepted  
**Date:** 2024

---

## Context

The protocol needs to:
1. Issue a fungible ERC-20 stablecoin (PUSD).
2. Accept deposits of multiple stablecoins and hold them as reserves.
3. Redeem PUSD for stablecoins, applying fees and routing logic.
4. Support adding/removing tokens and adjusting fees over time.

A naive design would put all of this — the ERC-20 token, reserve management, fee logic, and token routing — inside a single contract.

---

## Decision

Split the system into two contracts:

- **`PUSD`** — a minimal, upgradeable ERC-20. Knows nothing about collateral or fees. Only exposes `mint` and `burn` behind role guards.
- **`PUSDManager`** — holds all reserves, implements all deposit/redeem logic, and is the sole holder of `MINTER_ROLE` and `BURNER_ROLE` on `PUSD`.

---

## Rationale

### 1. Separation of concerns reduces upgrade risk

The ERC-20 token is the most sensitive piece of state — its storage layout, `totalSupply`, and user balances must never be corrupted. By keeping `PUSD` minimal, its implementation rarely needs to change. Complex routing logic lives in `PUSDManager`, which can be upgraded more frequently without touching the token.

### 2. Simpler auditability

Auditors reviewing mint/burn trust surface only need to inspect `PUSD` (58 lines). The collateral and routing logic in `PUSDManager` can be reviewed independently. If a bug is found in fee calculation, the fix does not require re-auditing the ERC-20.

### 3. Role delegation is explicit and revocable

`PUSDManager` holds mint/burn power as a role, not as the token owner. If `PUSDManager` needs to be replaced (e.g. a critical bug), the admin can:
1. Deploy a new `PUSDManager`.
2. Grant it `MINTER_ROLE` and `BURNER_ROLE`.
3. Revoke those roles from the old contract.

This is impossible if the manager is the same contract as the token.

### 4. Future extensibility

Additional managers (e.g. a cross-chain bridge manager, a yield manager) can be granted `MINTER_ROLE` independently without modifying the token contract. Each manager can be independently paused or replaced.

---

## Consequences

- Two deployment addresses must be tracked and kept in sync.
- The `initialize` sequence matters: `PUSD` must be deployed first, then `PUSDManager` is initialised with the PUSD address, then `MINTER_ROLE`/`BURNER_ROLE` are granted to `PUSDManager`.
- Any exploit that drains `PUSDManager`'s reserves does not affect `PUSD`'s own storage, but does break the collateral backing — the token and its backing are logically inseparable even if the contracts are separate.

# ADR 0002 – Access Control Model

**Status:** Accepted  
**Date:** 2024

---

## Context

Both `PUSD` and `PUSDManager` are upgradeable contracts that need to restrict who can:
- Mint and burn the token.
- Change protocol configuration (fees, tokens, treasury).
- Authorise contract upgrades.

The choices are: Ownable (single address), AccessControl (role-based), or a custom governance contract.

---

## Decision

Use OpenZeppelin `AccessControlUpgradeable` on both contracts with the following role structure:

### PUSD roles

| Role | Holder at launch | Capability |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Protocol multisig | Grant / revoke all roles |
| `UPGRADER_ROLE` | Protocol multisig | Authorise UUPS upgrade |
| `MINTER_ROLE` | PUSDManager | Call `mint()` |
| `BURNER_ROLE` | PUSDManager | Call `burn()` |

### PUSDManager roles

| Role | Holder at launch | Capability |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Protocol multisig | Grant / revoke all roles |
| `ADMIN_ROLE` | Protocol multisig | Token config, fees, rebalance, sweep |
| `UPGRADER_ROLE` | Protocol multisig | Authorise UUPS upgrade |

---

## Rationale

### Why not Ownable?

`Ownable` provides a single `owner` address with full control. This conflates token-management permissions with upgrade permissions. With `AccessControl`:
- `MINTER_ROLE` can be held by `PUSDManager` without that contract also being able to upgrade `PUSD`.
- `UPGRADER_ROLE` can be transferred to a timelock without affecting day-to-day operations.
- Future operators can be granted `ADMIN_ROLE` on `PUSDManager` without gaining upgrade rights.

### Why separate ADMIN_ROLE from DEFAULT_ADMIN_ROLE?

`DEFAULT_ADMIN_ROLE` is the role that can grant/revoke other roles — it is the highest privilege. `ADMIN_ROLE` covers day-to-day operations (fee changes, token additions). Separating them means:
- Operational actions (`ADMIN_ROLE`) can be delegated to a hot wallet or automation without granting the ability to reassign roles.
- Role assignment (`DEFAULT_ADMIN_ROLE`) stays with a high-security multisig.

### Why separate UPGRADER_ROLE?

Contract upgrades are the highest-risk operation. Separating `UPGRADER_ROLE` allows it to be held by a different multisig threshold or eventually a timelock + governance contract, without disrupting normal admin operations.

---

## Role Assignment at Deployment

```
deploy PUSD proxy          → PUSD.initialize(multisig)
                             grants DEFAULT_ADMIN_ROLE + UPGRADER_ROLE to multisig

deploy PUSDManager proxy   → PUSDManager.initialize(pusdAddress, multisig)
                             grants DEFAULT_ADMIN_ROLE + ADMIN_ROLE + UPGRADER_ROLE to multisig

grant roles on PUSD        → multisig calls PUSD.grantRole(MINTER_ROLE, PUSDManager)
                             multisig calls PUSD.grantRole(BURNER_ROLE, PUSDManager)
```

---

## Consequences

- Role assignments must be verified post-deployment (e.g. by checking `hasRole` for each expected holder).
- If `PUSDManager` is upgraded to a new implementation at a new address, the role grants on `PUSD` must be updated manually (`grantRole` new, `revokeRole` old).
- `DEFAULT_ADMIN_ROLE` on `PUSDManager` grants the holder the ability to revoke their own `ADMIN_ROLE` — this is an OZ `AccessControl` footgun to be aware of.
- There is currently no on-chain timelock protecting upgrades (see OQ-01).

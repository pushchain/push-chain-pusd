# ADR 0002 — Access Control Model

**Status:** Accepted (principles); role tables superseded by ADR 0004
**Date:** 2026-02-22 (extended 2026-04-22 for the scrapped ADR 0003 contracts)

> **The principles still hold** — `AccessControl` over `Ownable`, separate
> `ADMIN_ROLE` from `DEFAULT_ADMIN_ROLE`, timelock the `UPGRADER_ROLE`,
> bind mint authority to a specific call path that preserves the reserve
> invariant.
>
> **The role tables below are stale.** They describe the scrapped 4-contract
> plan (`PUSDPlus` as ERC-4626, separate `PUSDLiquidity`, `VAULT_ROLE` /
> `LIQUIDITY_ROLE` / `REBALANCER_ROLE`, `mintForVault`/`redeemForVault`
> functions). What shipped is 3 contracts + InsuranceFund sidecar with a
> different role layout — see:
>
> - [ADR 0004 — Shipped V2 architecture](0004-shipped-v2-architecture.md) for the diff
> - [`docs/research/pusdmanager.md`](../../research/pusdmanager.md), [`pusdplusvault.md`](../../research/pusdplusvault.md), and [`insurancefund.md`](../../research/insurancefund.md) for the current role tables per contract
>
> Per ADR convention the body below is preserved as-is for historical record.

---

## Context

All four protocol contracts are upgradeable and need to restrict who can:
- Mint and burn the token.
- Change protocol configuration (fees, tokens, treasury, deploy cap, strategies).
- Authorise contract upgrades.

The choices are: `Ownable` (single address), `AccessControl` (role-based), or a custom governance contract.

---

## Decision

Use OpenZeppelin `AccessControlUpgradeable` on all contracts with the following role structure.

### PUSD roles

| Role | Holder at launch | Capability |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Protocol multisig | Grant / revoke all roles |
| `UPGRADER_ROLE` | 48h TimelockController | Authorise UUPS upgrade |
| `MINTER_ROLE` | PUSDManager (only) | Call `mint()` |
| `BURNER_ROLE` | PUSDManager (only) | Call `burn()` |

### PUSDManager roles

| Role | Holder at launch | Capability |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Protocol multisig | Grant / revoke all roles |
| `ADMIN_ROLE` | Protocol multisig | Token config, fees, rebalance, sweep. (Rate-bearing-wrapper setter exists on the contract but is reserved — must remain `address(0)` at v2 launch; see ADR 0003.) |
| `VAULT_ROLE` | PUSDPlus (only) | Call `mintForVault(...)` and `redeemForVault(...)` |
| `UPGRADER_ROLE` | 48h TimelockController | Authorise UUPS upgrade |

### PUSDPlus roles

| Role | Holder at launch | Capability |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Protocol multisig | Grant / revoke all roles |
| `ADMIN_ROLE` | Protocol multisig | Set performance fee, fee recipient, pause |
| `LIQUIDITY_ROLE` | PUSDLiquidity (only) | Report `netAssetsInPUSD()` for NAV calc |
| `UPGRADER_ROLE` | 48h TimelockController | Authorise UUPS upgrade |

### PUSDLiquidity roles

| Role | Holder at launch | Capability |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Protocol multisig | Grant / revoke all roles |
| `ADMIN_ROLE` | Protocol multisig | Set `maxDeployableBps` / `emergencyLiquidityBps` / `lpSwapSlippageBps` (each bounded by hard caps); swap the UniV3 pool (only while positions.length == 0); swap the `UniV3Router`; recover dust |
| `REBALANCER_ROLE` | Operator hot wallet or keeper | Open, adjust, and close UniV3 positions within caps |
| `VAULT_ROLE` | PUSDPlus (only) | Pull capital for withdraws; push capital on new deposits |
| `PAUSER_ROLE` | Protocol multisig + incident responder | Pause new deployment (redemptions still flow) |
| `UPGRADER_ROLE` | 48h TimelockController | Authorise UUPS upgrade |

---

## Rationale

### Why not Ownable?

`Ownable` provides a single `owner` address with full control. This conflates token-management permissions with upgrade permissions. With `AccessControl`:
- `MINTER_ROLE` can be held by `PUSDManager` without that contract also being able to upgrade `PUSD`.
- `UPGRADER_ROLE` can be held by a timelock without affecting day-to-day operations.
- A keeper can hold `REBALANCER_ROLE` on `PUSDLiquidity` without gaining cap-raising or pool-swap power.

### Why separate `ADMIN_ROLE` from `DEFAULT_ADMIN_ROLE`?

`DEFAULT_ADMIN_ROLE` grants/revokes other roles — the highest privilege. `ADMIN_ROLE` covers day-to-day operations. Separation means:
- Operational actions can be delegated to a hot wallet or automation without granting the ability to reassign roles.
- Role assignment stays with a high-security multisig.

### Why separate `UPGRADER_ROLE` behind a timelock?

Contract upgrades are the highest-risk operation on an upgradeable stablecoin. Holding `UPGRADER_ROLE` on a 48h `TimelockController` means:
- Any upgrade is publicly visible for 48 hours before it executes.
- A compromised multisig cannot ship an upgrade instantly.
- OQ-01 is resolved.

### Why `VAULT_ROLE` and not just share `MINTER_ROLE` with PUSD+?

Because `mintForVault` must do more than mint — it must also increment `yieldShareReserve` and debit whatever stablecoin was deposited. Exposing raw `MINTER_ROLE` to PUSD+ would let PUSD+ mint PUSD out of thin air, breaking I-01. `VAULT_ROLE` on PUSDManager binds mint authority to a specific callpath that always preserves the reserve invariant.

### Why `REBALANCER_ROLE` separate from `ADMIN_ROLE` on PUSDLiquidity?

Because deploying capital between whitelisted strategies is a frequent operation that should be automatable, while whitelisting strategies is a governance-grade action. The two risks are different — a compromised keeper can shuffle capital within whitelisted adapters (bounded risk) but cannot add a malicious adapter.

---

## Role Assignment at Deployment

```
1. deploy PUSD proxy
     PUSD.initialize(multisig)
       → multisig gets DEFAULT_ADMIN_ROLE + UPGRADER_ROLE

2. deploy PUSDManager proxy
     PUSDManager.initialize(pusdAddr, multisig)
       → multisig gets DEFAULT_ADMIN_ROLE + ADMIN_ROLE + UPGRADER_ROLE
     PUSD.grantRole(MINTER_ROLE, pusdManager)
     PUSD.grantRole(BURNER_ROLE, pusdManager)

3. deploy PUSDPlus proxy
     PUSDPlus.initialize(pusdAddr, pusdManagerAddr, multisig)
       → multisig gets DEFAULT_ADMIN_ROLE + ADMIN_ROLE + UPGRADER_ROLE
     PUSDManager.grantRole(VAULT_ROLE, pusdPlus)

4. deploy PUSDLiquidity proxy
     PUSDLiquidity.initialize(pusdPlusAddr, pusdManagerAddr, multisig)
       → multisig gets DEFAULT_ADMIN_ROLE + ADMIN_ROLE + UPGRADER_ROLE
       → keeper gets REBALANCER_ROLE
     PUSDPlus.grantRole(LIQUIDITY_ROLE, pusdLiquidity)

5. rotate UPGRADER_ROLE on all four contracts from multisig
   → 48h TimelockController
```

---

## Consequences

- Role assignments must be verified post-deployment. Ship a `verifyRoles.s.sol` script that asserts the expected holder of every non-default role.
- If any manager contract is upgraded to a new address, grants on dependencies must be updated. Example: upgrading PUSDManager to a new proxy requires re-granting `MINTER_ROLE` and `BURNER_ROLE` on PUSD.
- `DEFAULT_ADMIN_ROLE` can revoke its own role — standard OZ footgun, document in the runbook.
- Emergency procedures (pause, strategy unwind) are `ADMIN_ROLE` actions, not `UPGRADER_ROLE`, so they do not go through the 48h timelock. Crisis response stays fast; upgrades stay slow.

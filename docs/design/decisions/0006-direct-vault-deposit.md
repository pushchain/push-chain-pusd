# ADR 0006 — Direct Vault Deposits + Basket Wrap (V2.1)

**Status:** Accepted
**Date:** 2026-05-06
**Amends (in part):** [ADR 0004 — Shipped V2 Architecture](0004-shipped-v2-architecture.md)

---

## TL;DR

`PUSDManager.depositToPlus` is rewritten so reserves go **directly to the
vault** instead of round-tripping through the manager. Wrap path
(`tokenIn == PUSD`) basket-redeems through the manager and pays reserves to
the vault.

This is a **function-body-only impl swap on PUSDManager** plus a small
state addition on PUSDPlusVault (one slot from `__gap`). Storage layouts
preserved below the gaps; UUPS upgrades only.

Solves the LP-inventory contention problem ADR 0004 inherited from
shipping the fee-exempt-flag isolation model.

---

## Context

ADR 0004 chose the **fee-exempt vault flag** over sliced reserves. That
choice was correct for redemption isolation (vault redeems / converts pay
zero fees), and it kept the v1 storage layout intact.

But it left the deposit side with this shape:

```
USER → manager (USDC.eth)             ← user's reserve enters manager
manager mints PUSD to vault           ← claim ticket
later: keeper redeemPusdForToken      ← vault burns PUSD, manager pays
                                        the SAME asset back
manager → vault (USDC.eth)            ← back where it started
```

Two operational problems with this:

1. **Bootstrap impossibility.** When only USDC.eth has been deposited,
   the manager has only USDC.eth. The vault's PUSD claim can be
   redeemed for USDC.eth (preferred path) but not for USDT.eth (basket
   fallback returns whatever's there — more USDC.eth). Result: the vault
   can't get USDT.eth into its inventory until some other user deposits
   USDT.eth. **Stable/stable LP can't open until user diversity catches
   up.**

2. **Steady-state contention.** The vault's "PUSD claim" is general,
   not specific. If user C runs `manager.redeem(500, USDC.eth, ...)` and
   drains the manager's USDC.eth, the vault's planned LP top-up of USDC
   fails — the asset it needed is gone.

The **fee-exempt flag** gives PUSD+ holders fee isolation. It does *not*
give the vault asset-specific inventory. That's the gap v2.1 closes.

---

## Decision

`PUSDManager.depositToPlus` becomes:

**Direct path** (`tokenIn != PUSD`):

1. Pull full amount to manager (so haircut accounting matches
   `manager.deposit`).
2. Accrue `surplusHaircut[token] += haircutAmount`.
3. Forward the **net** to the vault.
4. Call `vault.mintPlus(pusdValueOfNet, recipient)`.

No PUSD is minted on this path. `pusd.totalSupply` is unchanged. The
vault receives the underlying reserve token directly (counted in
`idleReservesPusd` because it's in `vault.basket`).

**Wrap path** (`tokenIn == PUSD`):

1. Reuse `_executeBasketRedeemFrom(amount, plusVault, msg.sender, 0)`.
   This burns `amount` PUSD from the caller and pays a proportional
   basket of reserves to the vault. `effectiveBaseFee = 0` because the
   vault is fee-exempt.
2. Call `vault.mintPlus(amount, recipient)`.

**Defensive `inBasket` check.** Direct path requires `vault.inBasket(tokenIn)`
to be true. If a token is supported by the manager but missing from the
vault's basket, the deposit reverts with `"PUSDManager: token not in vault
basket"` — preventing the silent-stranding failure mode where reserves
sit in `vault.balanceOf(token)` without being counted in NAV.

**Wired as part of the same upgrade**, the vault picks up:

- `_convertIdleReservesToPusd(target, preferred)` — drain the user's
  preferred asset first when sourcing PUSD on `burnPlus` and
  `fulfillQueueClaim`. Without this, v2.1 ships a redeem regression (vault
  drains basket[0] regardless of user preference, manager basket-fallbacks
  the payout, user gets wrong asset).
- `rebalance()` and `rebalanceBatch()` become permissionless-with-cooldown.
  KEEPER bypasses; public callers must wait
  `publicRebalanceCooldown` (default 1h, max 24h, settable by VAULT_ADMIN).
  Decentralizes liveness without sacrificing keeper economics.
- One new state slot for `(lastRebalanceAt, publicRebalanceCooldown)`,
  consuming `__gap[40] → __gap[39]`.

---

## Consequences

### Good

- **Vault accumulates diverse reserves organically.** A USDC.eth deposit
  lands as USDC.eth in the vault. A USDT.bnb deposit lands as USDT.bnb.
  No keeper rebalancing required to stand up LP positions.

- **Preferred-asset redeem actually works.** Under v2.1, when a user
  redeems PUSD+ wanting USDC.eth and the vault holds USDC.eth, the
  conversion drains USDC.eth (not basket[0]), the manager pays out USDC.eth
  via the preferred branch, and the user gets exactly what they asked for.

- **PUSD totalSupply growth profile flattens.** Direct deposits don't
  mint PUSD anymore. Indexers/dashboards showing "PUSD circulating" will
  see a flatter curve. PUSD's role narrows to: pure par-backed stable
  for plain `deposit` users.

- **I1 scope tightens (helpfully).** PUSD remains 1:1 backed by manager
  reserves only. Vault-held reserves back PUSD+ shares separately. Two
  ledgers, cleanly separated, both satisfied independently.

- **Bootstrap path becomes obvious.** Multisig direct injection of
  basket inventory is no longer required for normal deposits — only for
  cold-starting a specific stable/stable pair where user diversity is
  insufficient.

### Tradeoffs

- **redeem-side round-trip stays.** `redeemFromPlus` still goes vault →
  manager → user with a `depositForVault` round-trip in tier 2. v2.1 does
  not optimize this path. Deferred to v2.2 — the optimization needs
  careful design to preserve I1 invariants and isn't blocking the LP
  unlock that v2.1 enables.

- **Basket sync is an explicit prerequisite.** v2.1's defensive check
  reverts when `vault.inBasket(tokenIn) == false`. POOL_ADMIN must run
  `PopulateVaultBasket.s.sol` BEFORE the manager upgrade activates, or
  every direct deposit reverts. Documented in `V21_UPGRADE_RUNBOOK.md`.

- **`rebalance` permissioning shift.** Anyone can now call it, given
  cooldown. Spam griefing is bounded by the caller's own gas (no
  protocol-side cost). $PC tip mechanism deliberately deferred — easy to
  add later if real abuse appears.

- **Storage delta.** PUSDPlusVault gains one slot for
  `(lastRebalanceAt, publicRebalanceCooldown)` packed. `__gap[40]` →
  `__gap[39]`. Standard `__gap` consumption pattern.

### Migration

- **Pre-existing PUSD held by vault** is harmless. Counts in NAV via
  `idleReservesPusd`. Drains naturally as keeper rebalances. No active
  migration step.

- **Deployment 5** records the new PUSDManager and PUSDPlusVault impl
  addresses. Proxies unchanged.

---

## Alternatives considered

**(a) Optimize redeemFromPlus too in v2.1.** Rejected for scope. The
deposit-side fix is contained and ships value immediately. The redeem
overhaul deserves a focused v2.2.

**(b) Vault-side `swap()` function for inventory rebalancing.** Rejected
for v2.1. Real new contract surface; only useful once a pool is live; can
be added later without breaking compatibility.

**(c) Permissionless rebalance with $PC tip.** Tip mechanism deferred —
the cooldown alone is sufficient anti-spam (caller pays own gas, gets no
benefit from spamming). Tip can be added in v2.1.x or v2.2 if the
single-keeper liveness concern materializes.

**(d) Vault auto-sync basket from manager.supportedTokens.** Rejected —
adds new coupling between contracts. Manual `addBasketToken` calls via
POOL_ADMIN multisig is the correct governance shape. The v2.1 defensive
check makes the missing-from-basket case explicit rather than silent.

---

## References

- `contracts/src/PUSDManager.sol` — `depositToPlus` rewrite (function body only)
- `contracts/src/PUSDPlusVault.sol` — `_convertIdleReservesToPusd` signature change, `rebalance`/`rebalanceBatch` permissionless-with-cooldown, `setPublicRebalanceCooldown`, `lastRebalanceAt` + `publicRebalanceCooldown` storage, error types `Vault_RebalanceCooldown` and `Vault_CooldownTooLong`
- `contracts/src/interfaces/IPUSDPlusVault.sol` — adds `inBasket(address)` view
- `contracts/script/PopulateVaultBasket.s.sol` — POOL_ADMIN prerequisite script
- `contracts/script/DeployPUSDManager.v2.1.s.sol` — impl deploy + upgrade calldata
- `contracts/script/V21Smoke.s.sol` — post-upgrade read-only verification
- `contracts/script/V21_UPGRADE_RUNBOOK.md` — multisig checklist
- `contracts/test/V21UpgradeFork.t.sol` — fork tests against Deployment 4 state
- `docs/research/pusdmanager.md` — depositToPlus internals
- `docs/research/pusdplusvault.md` — preferred-first conversion + cooldown details
- `docs/research/agents.md` — updated DAG and I1 scope
- `docs/research/audit-asks.md` — A2 entry for v2.1 deep-look

# PUSD — Overview

PUSD is the USD-denominated stablecoin for Push Chain. It ships as a **two-tier product**: a boring par-backed token for payments and settlement, and an ERC-4626 yield-bearing wrapper for savers.

This page is the one-page product summary. The authoritative architecture is [ADR 0003](decisions/0003-product-architecture.md).

---

## The two tokens

| | **PUSD** | **PUSD+** |
|---|---|---|
| Type | ERC-20 | ERC-4626 vault (underlying = PUSD) |
| Value | Always $1 | Monotonically increasing PUSD per share |
| Audience | Payments, settlement, integrators | Savers, treasuries, idle-cash holders |
| Yield | None | Yes — blended reserve + strategy yield |
| Mint cost | Always 1:1 for stablecoin | Always 1:1 in USD terms at current NAV |
| Redeem latency | Instant (pulls from `parReserve`) | Instant when idle slice suffices; async otherwise |

Both tokens are minted against the same underlying reserve. The reserve is **logically partitioned** so that strategy risk lives only in the PUSD+ slice and never contaminates plain PUSD.

---

## The four contracts

```
PUSD (ERC-20)       — the boring token. 58 lines. Mint/burn gated by role.
PUSDManager         — the reserve. Splits holdings into parReserve + yieldShareReserve.
                      Single source of truth for mint authority.
PUSDPlus (ERC-4626) — the yield wrapper. Underlying is PUSD. NAV grows over time.
PUSDLiquidity       — the strategy engine. Owned by PUSDPlus. Deploys up to 35% of
                      PUSD+ assets into Aave / Curve / Morpho.
```

See [architecture.md](architecture.md) for the storage layout, roles, and reserve slicing.

---

## Default user flow

**Mint tab (default).**
> User deposits $1,000 USDC → receives ~1,000 PUSD+ (at current NAV).

One transaction, behind the scenes:
1. `PUSDManager` receives USDC and credits the yield-share slice.
2. `PUSDManager` mints 1,000 PUSD **directly to `PUSDPlus`**.
3. `PUSDPlus` mints PUSD+ shares to the user at current NAV.

**Mint tab (plain PUSD toggle on).**
> User deposits $1,000 USDC → receives 1,000 PUSD.

One transaction:
1. `PUSDManager` receives USDC and credits the par slice.
2. `PUSDManager` mints 1,000 PUSD to the user.

**Redeem.** Mirror of mint. PUSD redeems against `parReserve`; PUSD+ redeems against `yieldShareReserve` (with `PUSDLiquidity` unwinding where needed).

See [mint-redeem-flow.md](mint-redeem-flow.md) for the detailed paths.

---

## Where yield comes from

Two levers, with intentionally asymmetric policy.

**Lever 1 — Reserve composition (uncapped).** `PUSDManager`'s yield-share slice can be held in rate-bearing forms of the underlying stablecoin: `sDAI`, `USDY`, `sUSDe`, `scrvUSD`, `sUSDS`. Each is a stablecoin-denominated, public-NAV instrument. All of `yieldShareReserve` may be rate-bearing without increasing blow-up risk.

**Lever 2 — Active strategies (capped at 35%).** `PUSDLiquidity` deploys up to 35% of PUSD+ net assets into Aave supply, Curve LPs, and Morpho markets. Launch value is **25%**; the **35% ceiling is in the contract and moving it requires a new ADR**.

The cap protects redemption latency, not reserve integrity. See [ADR 0003 §4](decisions/0003-product-architecture.md).

---

## Why two tokens and not one

A single token cannot serve both payments and savings without pretending.
- A rebasing PUSD breaks integrations that assume supply-conservation on transfer.
- A drifting `pps` PUSD breaks every integration that assumes PUSD is worth $1.

Two tokens, each honest about its job, respect both audiences.

Integrators who hold plain PUSD earn **zero yield**. That is correct — plain PUSD is par-backed by idle `parReserve`, and there is no yield to distribute to them. Integrators who want yield can hold PUSD+ instead.

---

## Invariants (summary)

- I-01 — Every non-removed token's balance covers `parReserve + yieldShareReserve + fees + haircut`.
- I-01b — PUSD+ NAV is monotonically ≥ 1.0 PUSD/share, always.
- I-03 — PUSD mint only via `PUSDManager.deposit()` or `PUSDManager.mintForVault()`.
- I-12 — `PUSDLiquidity` total deployed ≤ `maxDeployableBps` (cap 35%) of PUSD+ assets.

The full set is in [invariants.md](invariants.md).

---

## What to read next

- [architecture.md](architecture.md) — per-contract storage, roles, and how the four contracts wire up.
- [mint-redeem-flow.md](mint-redeem-flow.md) — the full flow diagrams for deposit, wrap, redeem, unwrap.
- [ADR 0003](decisions/0003-product-architecture.md) — why the architecture is shaped this way.

# PUSD Open Design Forks

This file tracks unresolved design forks. These are not bugs. They are major product and architecture decisions.

> **Status:** Forks 1–5 are **resolved by [ADR 0003 – Product architecture](../design/decisions/0003-product-architecture.md)**. They are retained below as historical research context; the live decisions live in the ADR and should be edited there, not here.
>
> | Fork | Resolution | ADR §  |
> |---|---|---|
> | 1 – Boring vs yield-bearing base | Boring base; yield moves to a separate ERC-4626 wrapper (`PUSD+`) | §1, §4 |
> | 2 – Yield opt-in vs default UX | Default UX surfaces yield; backend keeps PUSD and PUSD+ strictly separate | §5 |
> | 3 – How much reserve capital is deployable | Start conservative: hard cap `maxDeployableBps ≤ 3500` (≤ 35%), initial target 25% | §3 |
> | 4 – Scope of `PUSDLiquidity` | Protocol-owned liquidity only at launch; strategy adapters gated behind a follow-up ADR | §2 |
> | 5 – The exact PUSD redemption promise | Preferred → basket → emergency, documented publicly and enforced in `PUSDManager` | §6 |

---

## Fork 1 — Is base PUSD boring or yield-bearing?  *(resolved · [ADR 0003 §1](../design/decisions/0003-product-architecture.md))*

### Option A
Base PUSD stays boring:
- 1 unit stable abstraction
- best for settlement, accounting, integrations
- yield lives in separate layer

### Option B
Base PUSD earns by default:
- stronger deposit / bootstrap story
- but contaminates settlement layer with strategy risk

### Current recommendation
Prefer Option A.

**Resolved:** Option A. Base PUSD stays boring; yield is delivered via a separate ERC-4626 wrapper (`PUSD+`). See [ADR 0003 §1](../design/decisions/0003-product-architecture.md) and [§4](../design/decisions/0003-product-architecture.md).

---

## Fork 2 — Is yield opt-in or default UX?  *(resolved · [ADR 0003 §5](../design/decisions/0003-product-architecture.md))*

### Option A
User explicitly chooses PUSD or PUSD+ at deposit.

Problem:
- user friction
- fragmented flows
- confusing product

### Option B
User gets yield-bearing experience by default in frontend, but backend keeps PUSD and yield layer separate.

This is currently the strongest UX direction.

**Resolved:** Option B. The frontend presents a single "Mint & earn" flow; the backend keeps PUSD (boring) and PUSD+ (ERC-4626 wrapper) as distinct contracts so integrators can still hold plain PUSD. See [ADR 0003 §5](../design/decisions/0003-product-architecture.md).

---

## Fork 3 — How much reserve capital can be deployed?  *(resolved · [ADR 0003 §3](../design/decisions/0003-product-architecture.md))*

### Aggressive path
50% or more deployable into LP / yield strategies.

Upside:
- stronger visible yield
- better early liquidity depth

Downside:
- more stress fragility
- harder redemption management

### Conservative path
25%–35% initial deploy cap.

Upside:
- safer
- easier to unwind
- better for launch credibility

Downside:
- lower user-visible yield

### Current recommendation
Start conservative.

**Resolved:** Conservative path. `maxDeployableBps` is hard-capped at `3500` (35%) in `PUSDLiquidity`; the launch target is **25%**. Raising the cap requires a governance action plus a new ADR. See [ADR 0003 §3](../design/decisions/0003-product-architecture.md).

---

## Fork 4 — What is PUSDLiquidity allowed to do?  *(resolved · [ADR 0003 §2](../design/decisions/0003-product-architecture.md))*

Possible scope:
- only protocol-owned LP
- protocol-owned LP plus external strategy adapters
- full liquidity engine for vault capital as well

### Current recommendation
Start with protocol-owned liquidity only.
Then extend.

**Resolved:** Protocol-owned liquidity only at v1. `PUSDLiquidity` exists as a separate contract so that adding strategy adapters later is an additive change, not a surgery on `PUSDManager`. Any expansion of its scope (external strategies, vault capital) requires a follow-up ADR. See [ADR 0003 §2](../design/decisions/0003-product-architecture.md).

---

## Fork 5 — What is the exact PUSD promise?  *(resolved · [ADR 0003 §6](../design/decisions/0003-product-architecture.md))*

Possible framings:
1. redeem for same asset
2. redeem for any supported stable asset
3. redeem for preferred if available, else basket / alternate

### Current practical promise
The protocol is converging toward:
- preferred asset if available
- otherwise basket / alternate based on liquidity and system status

This should be documented extremely clearly in public docs.

**Resolved:** Option 3. The public promise is **preferred → basket → emergency**, in that order, enforced on-chain by `PUSDManager` and surfaced as the single "You will receive" line in the redeem UI. See [ADR 0003 §6](../design/decisions/0003-product-architecture.md) and [`mint-redeem-flow.md`](../design/mint-redeem-flow.md).
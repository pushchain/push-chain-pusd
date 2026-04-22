# PUSD Docs

Human-readable documentation for the PUSD protocol.

> **Two versions.** v1 (live on Donut Testnet) is a single par-backed PUSD ERC-20.
> v2 (in engineering) adds PUSD+ (ERC-4626 yield wrapper) with yield sourced from
> a Uniswap V3 USDC/USDT LP position. The canonical architecture decision is
> [ADR 0003](design/decisions/0003-product-architecture.md).

## v1 — Live on Donut Testnet

- [v1-deployment.md](design/v1-deployment.md) — Addresses, supported tokens, fee config, go-live checklist. Source of truth for what is on-chain.
- [v1-frontend-plan.md](design/v1-frontend-plan.md) — Direction C brutalist editorial frontend plan: Mint, Redeem, Reserves dashboard, Transaction history, invariants ribbon.

## v2 — In engineering

- [v2-contracts-plan.md](design/v2-contracts-plan.md) — PUSD+, PUSDLiquidity, UniV3 integration, timelock, phased rollout (~10 weeks).
- [v2-frontend-plan.md](design/v2-frontend-plan.md) — PUSD+ mint/unwrap UI, LP position rail, pool peg chart, I-13 drift banner.

## Design

Living specification of the protocol.

- [overview.md](design/overview.md) — One-page summary. What PUSD is, what PUSD+ is, why two tiers.
- [architecture.md](design/architecture.md) — Contract layout, storage, roles, reserve slicing.
- [mint-redeem-flow.md](design/mint-redeem-flow.md) — Deposit, wrap, redeem, unwrap flows. Three redemption paths.
- [invariants.md](design/invariants.md) — Protocol safety properties. I-01 through I-13.
- [risks.md](design/risks.md) — Known failure modes and mitigations.
- [open-questions.md](design/open-questions.md) — Unresolved design questions.

## Decisions (ADRs)

Point-in-time decisions. Once accepted, ADRs are not edited — they are superseded by new ones.

- [ADR 0001 — Why PUSDManager exists](design/decisions/0001-why-pusdmanager-exists.md)
- [ADR 0002 — Access control model](design/decisions/0002-access-control-model.md)
- [ADR 0003 — Product architecture (two-tier)](design/decisions/0003-product-architecture.md) — authoritative

## Research

Historical ideation, predates the current architecture. Files are encrypted at rest. To read, run:

```sh
./scripts/decrypt-research.sh
```

- [research/](research/) — Evolution, PUSD, PUSDManager, PUSDLiquidity, Open-Design-Forks.

> Research files describe a **pre-ADR-0003 single-contract design** and are kept for
> context, not as a spec. When in doubt, trust the design docs above.

## Agent Context

Machine-readable reference material for coding agents lives at [`/agents`](../agents/), not here.
It includes per-contract fact sheets, a repo map, and a structured invariant list.

## For New Contributors

Read in this order:

1. [v1-deployment.md](design/v1-deployment.md) — what is on-chain today
2. [overview.md](design/overview.md) — what and why (v2 product)
3. [ADR 0003](design/decisions/0003-product-architecture.md) — how, at the highest level
4. [architecture.md](design/architecture.md) — contract layout
5. [mint-redeem-flow.md](design/mint-redeem-flow.md) — the two flows you will touch most often
6. [invariants.md](design/invariants.md) — what must always be true
7. [v1-frontend-plan.md](design/v1-frontend-plan.md) or [v2-frontend-plan.md](design/v2-frontend-plan.md) — depending on which frontend you're working on

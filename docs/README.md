# PUSD Docs

Documentation for the shipped V2 protocol — three contracts plus an
InsuranceFund sidecar.

## What and where

| Need                                       | Where                                                                |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Build a dApp with PUSD or PUSD+            | [Skill](../app/public/agents/skill/push-pusd/SKILL.md) (served at https://pusd.push.org/agents/skill/push-pusd/SKILL.md) |
| Understand the shipped architecture        | [`design/architecture.md`](design/architecture.md)                   |
| Understand product decisions               | [`design/decisions/`](design/decisions/) — ADRs, append-only         |
| Deploy or check live addresses             | [`/contracts/deployed.txt`](../contracts/deployed.txt) + [`/DEPLOYMENT.md`](../DEPLOYMENT.md) |
| Modify the contracts (internal team / auditors under engagement) | [`research/`](research/) — encrypted at rest. Start with [`agents.md`](research/agents.md) (cross-cutting) then the per-contract file |

## Sections

### Design (current)

- [`design/architecture.md`](design/architecture.md) — Shipped V2 architecture: contract responsibilities, key flows, trust boundaries, storage discipline.

> Live deployment addresses live in [`/contracts/deployed.txt`](../contracts/deployed.txt) and [`/DEPLOYMENT.md`](../DEPLOYMENT.md), not under `design/`.
>
> The pre-shipping 4-contract design (sliced reserves + ERC-4626 PUSD+ + separate `PUSDLiquidity`) and the v1 launch state document have both been removed from the working tree. The narrative diff lives in [ADR 0004](design/decisions/0004-shipped-v2-architecture.md); the original prose is recoverable via `git log --follow` if ever needed.

### Decisions (ADRs)

Append-only — once accepted, an ADR is not edited; it is superseded by a later one.

- [ADR 0001 — Why PUSDManager exists](design/decisions/0001-why-pusdmanager-exists.md)
- [ADR 0002 — Access control model](design/decisions/0002-access-control-model.md)
- [ADR 0003 — Product architecture (two-tier)](design/decisions/0003-product-architecture.md) — *superseded by 0004*
- [ADR 0004 — Shipped V2 architecture](design/decisions/0004-shipped-v2-architecture.md) — **authoritative**

### Research

Internal ideation and contributor reference. Files are AES-encrypted on
commit by a pre-commit hook. To read or edit, run:

```sh
./scripts/decrypt-research.sh
```

- [`research/agents.md`](research/agents.md) — Cross-cutting: invariants I1–I5, inter-contract call DAG, trust boundaries, fuzz setup. Entry point.
- [`research/pusd.md`](research/pusd.md), [`research/pusdmanager.md`](research/pusdmanager.md), [`research/pusdplusvault.md`](research/pusdplusvault.md), [`research/insurancefund.md`](research/insurancefund.md) — Per-contract mechanics + design + decisions.
- [`research/frontend.md`](research/frontend.md) — React app architecture, component tree, two write paths, Direction C aesthetic.
- [`research/backend.md`](research/backend.md) — Keeper bot + indexer + monitoring design space (not yet built).
- See [`research/README.md`](research/README.md) for the full file index.

## For new contributors

Read in this order:

1. Repo root [README.md](../README.md) — what is this, addresses, basic mint/redeem flow
2. [ADR 0004](design/decisions/0004-shipped-v2-architecture.md) — what shipped vs what was planned and why
3. [`design/architecture.md`](design/architecture.md) — diagram + per-contract responsibilities + key flows
4. Decrypt research; start with [`research/agents.md`](research/agents.md) (call DAG + invariants) then read the per-contract file you're working on (`pusd.md` / `pusdmanager.md` / `pusdplusvault.md` / `insurancefund.md`)
5. `contracts/src/` — ground truth

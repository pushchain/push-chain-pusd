# Research Notes

Internal team / auditor reference material. **Encrypted at rest** by a
pre-commit hook (`scripts/encrypt-research.sh`); decrypt with
`scripts/decrypt-research.sh` and the project key.

This is the deep technical layer of the docs tree — for someone
modifying the contracts, frontend, or future backend services. Public
documentation lives in `/docs/design/` (architecture + ADRs); the
integrator-facing guide lives in
[`/app/public/agents/skill/push-pusd/SKILL.md`](../../app/public/agents/skill/push-pusd/SKILL.md).

## Files

| File                                                    | Purpose                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`agents.md`](agents.md)                                | Cross-cutting: invariants I1–I5, inter-contract call DAG, trust boundaries, fuzz setup. The "how to navigate" entry point. |
| [`pusd.md`](pusd.md)                                    | PUSD.sol — settlement token. Storage, roles, mechanics, design + decisions, future work. |
| [`pusdmanager.md`](pusdmanager.md)                      | PUSDManager.sol (V2) — reserve orchestrator. Two-key gate, fee-exempt branches, storage append, decisions. |
| [`pusdplusvault.md`](pusdplusvault.md)                  | PUSDPlusVault.sol — NAV-bearing vault. Three-tier fulfilment, V3Math vendoring, full design rationale appended. |
| [`insurancefund.md`](insurancefund.md)                  | InsuranceFund.sol — passive sidecar. balanceOf-as-truth, try/catch on notify, review marks. |
| [`frontend.md`](frontend.md)                            | React + Vite dApp at `app/`. Component tree, two write paths (A/B), Direction C aesthetic, existing + future design. |
| [`backend.md`](backend.md)                              | Keeper bot + indexer + monitoring design space. Contracts are deployed; the backend isn't built yet. |

## Layout

```
docs/research/
├── README.md             ← this file
├── agents.md             ← cross-cutting
├── pusd.md               ← per-contract
├── pusdmanager.md        ← per-contract
├── pusdplusvault.md      ← per-contract (mechanics + full design rationale)
├── insurancefund.md      ← per-contract
├── frontend.md           ← app/ internals
└── backend.md            ← keeper + indexer design
```

## When to read which

| Task                                            | File                                      |
| ----------------------------------------------- | ----------------------------------------- |
| "I'm modifying a contract, where do I start?"   | `agents.md` for the call DAG + invariants, then the per-contract file |
| "I need the storage layout / role table for X"  | `pusd.md` / `pusdmanager.md` / `pusdplusvault.md` / `insurancefund.md` |
| "I want to understand why we shipped 3 contracts not 4" | [`docs/design/decisions/0004-shipped-v2-architecture.md`](../design/decisions/0004-shipped-v2-architecture.md) (ADR — public) |
| "I'm extending the React app"                   | `frontend.md`                             |
| "I'm building the keeper bot"                   | `backend.md`                              |
| "I want the deep design rationale for PUSD+"    | `pusdplusvault.md` §"Full Design Rationale" |

## Authority order (when files disagree)

1. Solidity source in `contracts/src/` — ground truth.
2. ADRs in `docs/design/decisions/` — authoritative decisions.
3. `docs/design/architecture.md` — current architecture summary.
4. This directory — internal mechanics + design rationale.

If you find drift between these layers, source wins. File an issue or
fix the doc — don't fork reality.

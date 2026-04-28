# Agents — Machine-Readable Context

This directory is the entry point for AI coding agents working on the
**PUSD smart contracts**. It contains dense, structured reference
material — storage layouts, function signatures, role tables, event
schemas, invariant IDs — that complements the human-readable design
docs in [`/docs`](../docs/).

> **Scope.** `/agents` is solidity-mechanics only. Frontend mechanics
> live in [`/app/README.md`](../app/README.md). Don't move this
> directory into `/app` — the two surfaces have different shapes
> (storage slots vs. render trees), and conflating them dilutes both.

> **Start at the top:** if you are an agent, the canonical entry point
> is the served Skill at https://pusd.push.org/agents/skill/push-pusd/SKILL.md
> (full integration guide) backed by https://pusd.push.org/llms.txt
> (entry-point map). The files in this directory are deeper per-contract
> mechanics — read them when you need storage layouts, role tables, or
> invariant IDs that the Skill doesn't carry.

## Files

| File | Purpose |
|---|---|
| [repo-map.md](repo-map.md) | One-line description per file across the repo. Use as a navigation index. |
| [pusd.context.md](pusd.context.md) | `PUSD.sol` — the boring ERC-20 settlement token. |
| [pusdmanager.context.md](pusdmanager.context.md) | `PUSDManager.sol` — the reserve. Slices `parReserve` + `yieldShareReserve`. |
| [pusdplus.context.md](pusdplus.context.md) | `PUSDPlus.sol` — the ERC-4626 yield wrapper over PUSD. |
| [pusdliquidity.context.md](pusdliquidity.context.md) | `PUSDLiquidity.sol` — the Uniswap V3 LP engine owned by PUSD+. |
| [invariants.context.md](invariants.context.md) | Structured invariant list with Foundry stubs for fuzz/formal tooling. |

## How these files differ from /docs

- `/docs` describes intent, rationale, and tradeoffs in prose. For humans.
- `/agents` lists facts: function signatures, storage slots, role tables, event schemas. For code generation and audit tooling.

Both are kept in sync manually. When they disagree, `/docs` is authoritative for **intent**; `/agents` is authoritative for **mechanics**.

## Authority order

1. Solidity source in `/contracts/src/` — ground truth.
2. Design docs in `/docs/design/` — authoritative intent.
3. ADRs in `/docs/design/decisions/` — authoritative decisions.
4. This directory — machine-readable summary of (1)–(3).
5. Research notes in `/docs/research/` — historical, superseded by ADR 0003.

# PUSD Protocol Documentation

Push USD (PUSD) is a pegged USD stablecoin that pools liquidity from USDT, USDC, and other trusted stablecoins across chains. Users deposit supported stablecoins to receive PUSD 1:1 (minus any configured haircut), and redeem PUSD back for stablecoins.

## Contents

### Design

| Document | Description |
|---|---|
| [overview.md](design/overview.md) | High-level protocol summary and goals |
| [architecture.md](design/architecture.md) | Contract structure, roles, and storage layout |
| [mint-redeem-flow.md](design/mint-redeem-flow.md) | Step-by-step deposit and redemption logic |
| [invariants.md](design/invariants.md) | Protocol-level invariants that must always hold |
| [risks.md](design/risks.md) | Known risks and mitigations |
| [open-questions.md](design/open-questions.md) | Unresolved design questions |

### Architecture Decision Records

| ADR | Title |
|---|---|
| [0001](design/decisions/0001-why-pusdmanager-exists.md) | Why PUSDManager exists as a separate contract |
| [0002](design/decisions/0002-access-control-model.md) | Access control model |

### Agent Context (AI/LLM)

| File | Purpose |
|---|---|
| [repo-map.md](agents/repo-map.md) | File tree with one-line descriptions |
| [pusd.context.md](agents/pusd.context.md) | Dense context for working on PUSD.sol |
| [pusdmanager.context.md](agents/pusdmanager.context.md) | Dense context for working on PUSDManager.sol |
| [invariants.context.md](agents/invariants.context.md) | Machine-readable invariant list for fuzz/formal tools |

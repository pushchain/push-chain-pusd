# Repo Map

One-line description per file. Use this as a navigation index.

```
push-chain-pusd/
│
├── llms.txt                             Agent-facing navigation entry point
├── README.md                            Human-facing repo summary
├── DEPLOYMENT.md                        Deployment runbook
│
├── docs/                                Human-readable design docs
│   ├── README.md                        Docs index
│   ├── design/
│   │   ├── overview.md                  One-page product summary (v2 two-tier)
│   │   ├── architecture.md              Per-contract spec: storage, roles, wiring
│   │   ├── mint-redeem-flow.md          Deposit/wrap/redeem/unwrap flow diagrams
│   │   ├── invariants.md                Safety properties I-01 through I-12
│   │   ├── risks.md                     Failure modes R-01 through R-09
│   │   ├── open-questions.md            Unresolved design questions (OQ-03..OQ-10)
│   │   └── decisions/
│   │       ├── 0001-why-pusdmanager-exists.md       ADR: token/reserve separation
│   │       ├── 0002-access-control-model.md          ADR: role layout for 4 contracts
│   │       └── 0003-product-architecture.md          ADR: two-tier PUSD + PUSD+ (authoritative)
│   └── research/                        Historical ideation — superseded by ADR 0003
│       ├── Evolution.md                 Chronological research log
│       ├── Open-Design-Forks.md         Forks 1–5 (all resolved in ADR 0003)
│       ├── PUSD.md                      v1 single-token framing
│       ├── PUSDManager.md               v1 single-reserve framing
│       ├── PUSDLiquidity.md             v1 stub (empty in v1; real in v2)
│       └── *.md.enc                     AES-256-CBC encrypted versions (committed)
│
├── agents/                              Machine-readable agent context
│   ├── README.md                        Entry for agents
│   ├── repo-map.md                      This file
│   ├── pusd.context.md                  PUSD.sol reference
│   ├── pusdmanager.context.md           PUSDManager.sol reference
│   ├── pusdplus.context.md              PUSDPlus.sol reference (NEW)
│   ├── pusdliquidity.context.md         PUSDLiquidity.sol reference (NEW)
│   └── invariants.context.md            Structured invariant list with Foundry stubs
│
├── contracts/                           Foundry project (Solidity)
│   ├── src/
│   │   ├── PUSD.sol                     Upgradeable ERC-20; mint/burn by role
│   │   ├── PUSDManager.sol              Reserve manager (v2: par + yield-share slices)
│   │   ├── PUSDPlus.sol                 ERC-4626 yield wrapper over PUSD (NEW)
│   │   ├── PUSDLiquidity.sol            Strategy engine owned by PUSD+ (NEW)
│   │   ├── adapters/                    IStrategyAdapter implementations (NEW)
│   │   │   ├── AaveV3SupplyAdapter.sol
│   │   │   ├── Curve3poolLPAdapter.sol
│   │   │   └── MorphoSupplyAdapter.sol
│   │   └── interfaces/
│   │       ├── IPUSD.sol
│   │       ├── IPUSDManager.sol
│   │       ├── IPUSDPlus.sol            (NEW)
│   │       ├── IPUSDLiquidity.sol       (NEW)
│   │       └── IStrategyAdapter.sol     (NEW)
│   ├── script/
│   │   ├── DeployPUSD.s.sol             PUSD only
│   │   ├── DeployAndConfigure.s.sol     All four contracts, roles wired, timelock applied
│   │   ├── AddSupportedTokens.s.sol     Adds initial token list with rateBearingWrapper
│   │   └── AddStrategies.s.sol          Adds initial adapters to PUSDLiquidity (NEW)
│   ├── test/
│   │   ├── unit/                        Per-contract unit tests
│   │   ├── integration/                 Four-contract integration flows
│   │   ├── invariant/                   Foundry invariant tests (I-01 to I-12)
│   │   └── fork/                        Mainnet-fork tests for adapters
│   ├── broadcast/                       Foundry broadcast artefacts
│   ├── foundry.toml                     solc + remappings + ffi config
│   ├── remappings.txt
│   └── deployed.txt                     Human-readable addresses by network
│
├── app/                                 React + Vite frontend (Direction C: brutalist editorial)
│   └── src/
│       ├── App.tsx                      Root; route layout (I. Stablecoin, II. Mint, III. Reserves)
│       ├── main.tsx                     Entry; Wagmi + Push UI-kit providers
│       ├── abi/                         Generated ABIs for all four contracts
│       ├── components/                  UI components (MintCard, UnwrapCard, ReserveTable, ...)
│       ├── hooks/                       useMint, useRedeem, useWrap, useUnwrap, usePPS, ...
│       ├── lib/                         decimal helpers, math helpers, format helpers
│       └── contracts/                   Address book by chain
│
└── scripts/
    ├── setup-encryption.sh              Sets .research.hash
    ├── encrypt-research.sh              Pre-commit encrypt of docs/research/*
    └── decrypt-research.sh              Decrypts docs/research/*.enc
```

## Key entry points by task

| Task | Start here |
|---|---|
| Understand the protocol | `docs/design/overview.md` |
| Understand the two-tier decision | `docs/design/decisions/0003-product-architecture.md` |
| Understand mint/redeem | `docs/design/mint-redeem-flow.md` + `contracts/src/PUSDManager.sol` |
| Understand the wrapper | `agents/pusdplus.context.md` + `contracts/src/PUSDPlus.sol` |
| Understand strategy deployment | `agents/pusdliquidity.context.md` + `contracts/src/PUSDLiquidity.sol` |
| Deploy the protocol | `contracts/script/DeployAndConfigure.s.sol` |
| Add a supported token | `contracts/script/AddSupportedTokens.s.sol` |
| Add a strategy adapter | `contracts/script/AddStrategies.s.sol` + subclass `IStrategyAdapter` |
| Frontend work | `app/src/App.tsx`, `app/src/components/` |
| Check deployed addresses | `contracts/deployed.txt` |
| Write invariant tests | `contracts/test/invariant/` + `agents/invariants.context.md` |

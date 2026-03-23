# Repo Map

One-line description per file. Use this as a navigation index when working in this codebase.

```
push-chain-pusd/
│
├── contracts/                         Foundry project (Solidity contracts)
│   ├── src/
│   │   ├── PUSD.sol                   Upgradeable ERC-20 stablecoin; mint/burn gated by roles
│   │   └── PUSDManager.sol            Reserve manager; deposit/redeem/rebalance/sweep logic
│   │
│   ├── script/
│   │   ├── DeployPUSD.s.sol           Deploys PUSD proxy only
│   │   ├── DeployAndConfigure.s.sol   Deploys both contracts and grants roles
│   │   └── AddSupportedTokens.s.sol   Adds initial token list to a live PUSDManager
│   │
│   ├── broadcast/                     Foundry broadcast artefacts (deployed addresses, tx data)
│   ├── docs/                          Protocol documentation (this tree)
│   ├── foundry.toml                   Foundry config (solc version, remappings, ffi, etc.)
│   ├── remappings.txt                 Import path remappings for OpenZeppelin
│   └── deployed.txt                   Human-readable record of deployed contract addresses
│
└── app/                               React + Vite frontend
    └── src/
        ├── App.tsx                    Root component; tab layout
        ├── main.tsx                   React entry point; WalletConnect / PushChain provider setup
        ├── abi/                       JSON ABI files for PUSD and PUSDManager
        ├── components/                UI components (MintTab, RedeemTab, etc.)
        └── contracts/                 Contract address constants
```

## Key entry points by task

| Task | Start here |
|---|---|
| Understand the protocol | `docs/design/overview.md` |
| Understand mint/redeem logic | `contracts/src/PUSDManager.sol` → `deposit()`, `redeem()` |
| Understand token lifecycle | `PUSDManager.sol` → `TokenStatus` enum, `setTokenStatus()` |
| Understand fee model | `PUSDManager.sol` → `_calculatePreferredFee()`, `_executeRedeem()` |
| Deploy the protocol | `contracts/script/DeployAndConfigure.s.sol` |
| Add a new supported token | `contracts/script/AddSupportedTokens.s.sol` |
| Work on the frontend | `app/src/App.tsx`, `app/src/components/` |
| Check deployed addresses | `contracts/deployed.txt` |

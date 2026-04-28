# PUSD — Push USD

**PUSD** is a par-backed universal stablecoin on Push Chain. Deposit USDC or USDT from any supported chain, receive PUSD 1:1 on Push Chain. Burn PUSD, receive a reserve token back. Rules-based, redeemable, reversible.

- **Chain:** Push Chain Donut Testnet (chain ID 42101)
- **RPC:** `https://evm.donut.rpc.push.org/`
- **Explorer:** [donut.push.network](https://donut.push.network)

## Live contracts

| Contract    | Proxy address                                |
| ----------- | -------------------------------------------- |
| PUSD        | `0x488d080e16386379561a47a4955d22001d8a9d89` |
| PUSDManager | `0x7a24EEa43a1095e9Dc652Ab9Cba156A93eD5Ed46` |

Both are UUPS proxies. Historical deployments are in [`contracts/deployed.txt`](contracts/deployed.txt).

## Repository layout

```
push-chain-pusd/
├── app/          ← React + Vite dApp  (see app/README.md)
├── contracts/    ← Foundry contracts  (see contracts/README.md)
├── docs/         ← Human-readable protocol design specs
├── agents/       ← Machine-readable contract context for AI agents
├── scripts/      ← Utility scripts
├── llms.txt      ← Agent-facing entry point (root)
└── DEPLOYMENT.md ← Deployment runbook
```

## How it works

1. **Mint** — call `PUSDManager.deposit(token, amount, recipient)` after approving the reserve token. PUSD is minted 1:1 minus any `surplusHaircutBps` (currently 0%).
2. **Redeem** — call `PUSDManager.redeem(pusdAmount, preferredAsset, allowBasket, recipient)`. PUSDManager holds `BURNER_ROLE` and burns directly — no PUSD approval needed from the caller. A `baseFee` (currently 5 bps) is deducted.
3. **Basket fallback** — if the preferred asset is short on liquidity and `allowBasket = true`, the manager pays out a proportional basket of all reserve tokens instead of reverting.

Cross-chain mints and redeems (user holds the stablecoin on an external chain) are handled by the Push Chain universal transaction layer — see [`app/README.md`](app/README.md) for the SDK call shapes.

## Quick start

```bash
# Contracts
cd contracts
forge build
forge test

# dApp
cd app
yarn install
yarn dev        # http://localhost:5173
```

## Resources

- [Push Chain docs](https://docs.push.org/chain)
- [Foundry book](https://book.getfoundry.sh/)
- [OpenZeppelin upgradeable contracts](https://docs.openzeppelin.com/contracts/4.x/upgradeable)

## License

MIT

# PUSD — Push USD

**PUSD** is a par-backed universal stablecoin on Push Chain. Deposit USDC or USDT from any supported chain, receive PUSD 1:1 on Push Chain. Burn PUSD, receive a reserve token back. Rules-based, redeemable, reversible.

**PUSD+** is its yield-bearing companion — a 6-decimal NAV-bearing ERC-20 minted by depositing PUSD (or any reserve token in one shot) into `PUSDPlusVault`. NAV grows monotonically as the vault collects LP fees from Uniswap V3 stable/stable pools.

- **Chain:** Push Chain Donut Testnet (chain ID 42101)
- **RPC:** `https://evm.donut.rpc.push.org/`
- **Explorer:** [donut.push.network](https://donut.push.network)

## Live contracts

| Contract       | Proxy address                                |
| -------------- | -------------------------------------------- |
| PUSD           | `0x488d080e16386379561a47A4955D22001d8A9D89` |
| PUSDManager    | `0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46` |
| PUSDPlusVault  | `0xb55a5B36d82D3B7f18Afe42F390De565080A49a1` |
| InsuranceFund  | `0xFF7E741621ad5d39015759E3d606A631Fa319a62` |

All four are UUPS proxies. Historical deployments are in [`contracts/deployed.txt`](contracts/deployed.txt).

## Repository layout

```
push-chain-pusd/
├── app/          ← React + Vite dApp  (see app/README.md)
├── contracts/    ← Foundry contracts  (see contracts/README.md)
├── docs/         ← Protocol design, ADRs, internal research
├── scripts/      ← Utility scripts
└── DEPLOYMENT.md ← Deployment runbook
```

## For AI agents

Agent context is served, not stored in the repo. Point any LLM-based
coding tool at the deployed entry points:

- **llms.txt:** https://pusd.push.org/llms.txt
- **Skill (full integration guide):** https://pusd.push.org/agents/skill/push-pusd/SKILL.md

The Skill is self-contained — addresses, both write paths, every code
example, ABI fragments, common mistakes. One prompt is enough:

```
Read https://pusd.push.org/agents/skill/push-pusd/SKILL.md and
integrate PUSD mint + redeem into my dApp.
```

The source for both files lives in [`app/public/`](app/public/).

## How it works

1. **Mint PUSD** — call `PUSDManager.deposit(token, amount, recipient)` after approving the reserve token. PUSD is minted 1:1 minus any `surplusHaircutBps` (currently 0% on every token; cap is 1000 bps in v2).
2. **Redeem PUSD** — call `PUSDManager.redeem(pusdAmount, preferredAsset, allowBasket, recipient)`. PUSDManager holds `BURNER_ROLE` and burns directly — no PUSD approval needed from the caller. A `baseFee` (currently 5 bps) is deducted.
3. **Basket fallback** — if the preferred asset is short on liquidity and `allowBasket = true`, the manager pays out a proportional basket of all reserve tokens instead of reverting.
4. **Mint PUSD+** — call `PUSDManager.depositToPlus(tokenIn, amount, recipient)`. `tokenIn` may be PUSD (wrap path) or any enabled reserve (direct path). Under **v2.1**, the direct path forwards reserves straight to the vault (no intermediate PUSD mint); the wrap path basket-redeems caller's PUSD into vault inventory. PUSD+ is minted at pre-deposit NAV; quote with `PUSDPlusVault.previewMintPlus`.
5. **Redeem PUSD+** — call `PUSDManager.redeemFromPlus(plusAmount, preferredAsset, allowBasket, recipient)`. The vault burns PUSD+ at current NAV; **v2.1** drains the user's preferred asset first when sourcing PUSD. If the vault can't fulfil instantly, the residual is queued and settled by `PUSDPlusVault.fulfillQueueClaim(queueId)` once liquidity is available. No fees on the compose path.

> **Latest upgrade**: V2.1 (2026-05-06, Deployment 5). PUSDManager.depositToPlus rewritten to send reserves directly to the vault instead of round-tripping through the manager — solves the LP-inventory bootstrap problem. PUSDPlusVault.rebalance is now permissionless after a 1h cooldown (KEEPER bypasses). See [ADR 0006](docs/design/decisions/0006-direct-vault-deposit.md) for the full rationale.

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

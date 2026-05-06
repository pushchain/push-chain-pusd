# PUSD Deployment Information

> Authoritative source: [`contracts/deployed.txt`](contracts/deployed.txt). This
> file mirrors the latest deployment for human reference.

## Current deployment — V2.1 direct-deposit + permissionless rebalance (Deployment 5, 2026-05-06)

> ADR: [docs/design/decisions/0006-direct-vault-deposit.md](docs/design/decisions/0006-direct-vault-deposit.md)

### Contract Addresses (Push Chain Donut Testnet, chain 42101)

| Contract                    | Proxy                                        | Latest impl                                  |
| --------------------------- | -------------------------------------------- | -------------------------------------------- |
| PUSD                        | `0x488d080e16386379561a47A4955D22001d8A9D89` | `0x8b931D2844214E9f654b90A15B572b5d97c8ff8F` (unchanged since v1) |
| PUSDManager (upgraded v2.1) | `0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46` | `0xA1e8D6312fc1BB6B88d9326F6115a7396eCcD487` (v2.1) |
| PUSDPlusVault (upgraded v2.1) | `0xb55a5B36d82D3B7f18Afe42F390De565080A49a1` | `0x6d17846330766f243D3A78A8b1FC7D61a9795D81` (v2.1) |
| InsuranceFund               | `0xFF7E741621ad5d39015759E3d606A631Fa319a62` | `0x5eb7c329B7a178Be60B8770727Add801B3ceC834` (unchanged since v2) |
| V3Math library              | n/a (linked at deploy)                       | `0xc90a042d74fc921405992ab463d03ae2a19eb06a` (unchanged since v2) |
| Admin / Deployer            | `0xA1c1AF949C5752E9714cFE54f444cE80f078069A` |                                              |

All four contracts are UUPS proxies — interact via the proxy address only.

### V2.1 changes summary

- **PUSDManager.depositToPlus rewrite**: direct path forwards reserves directly to vault (no PUSD round-trip); wrap path basket-redeems caller's PUSD into vault inventory. Function-body-only — storage layout below `__gap_v2` unchanged.
- **PUSDPlusVault**: `_convertIdleReservesToPusd` drains preferred asset first; `rebalance` permissionless after a 1h cooldown (KEEPER bypasses); new `setPublicRebalanceCooldown` setter (capped at 24h).
- **Storage**: PUSDPlusVault gained one slot for `(lastRebalanceAt, publicRebalanceCooldown)` packed; `__gap[40]` → `__gap[39]`.
- **Pre-upgrade**: POOL_ADMIN ran `PopulateVaultBasket.s.sol` so all 9 supported tokens are in `vault.basket` (required by direct-deposit defensive `inBasket` check).
- **Post-upgrade**: `setPublicRebalanceCooldown(3600)` called (UUPS swap doesn't re-run `initialize`); legacy 253 PUSD held by vault drained via `UnwrapLegacyPUSD.s.sol` proportional split.

### Explorer Links
- PUSD: https://donut.push.network/address/0x488d080e16386379561a47A4955D22001d8A9D89
- PUSDManager: https://donut.push.network/address/0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46
- PUSDPlusVault: https://donut.push.network/address/0xb55a5B36d82D3B7f18Afe42F390De565080A49a1
- InsuranceFund: https://donut.push.network/address/0xFF7E741621ad5d39015759E3d606A631Fa319a62

### Configuration
- **Chain ID**: 42101
- **RPC URL**: https://evm.donut.rpc.push.org/
- **Base Fee**: 0.05% (5 bps) — capped at 100 bps
- **Surplus Haircut Cap (v2)**: 1000 bps (10%) — currently 0 on every token
- **Supported Tokens**: 9 stablecoins across 5 chains (see below)

### Supported Tokens

All registered with `decimals = 6`, `status = ENABLED`, `surplusHaircutBps = 0`:

| #  | Symbol     | Origin chain     | Address                                       |
| -- | ---------- | ---------------- | --------------------------------------------- |
| 0  | USDT.eth   | Ethereum Sepolia | `0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3`  |
| 1  | USDC.eth   | Ethereum Sepolia | `0x7A58048036206bB898008b5bBDA85697DB1e5d66`  |
| 2  | USDT.sol   | Solana Devnet    | `0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34`  |
| 3  | USDC.sol   | Solana Devnet    | `0x04B8F634ABC7C879763F623e0f0550a4b5c4426F`  |
| 4  | USDT.base  | Base Sepolia     | `0x2C455189D2af6643B924A981a9080CcC63d5a567`  |
| 5  | USDC.base  | Base Sepolia     | `0xD7C6cA1e2c0CE260BE0c0AD39C1540de460e3Be1`  |
| 6  | USDT.arb   | Arbitrum Sepolia | `0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9`  |
| 7  | USDC.arb   | Arbitrum Sepolia | `0x1091cCBA2FF8d2A131AE4B35e34cf3308C48572C`  |
| 8  | USDT.bnb   | BNB Testnet      | `0x2f98B4235FD2BA0173a2B056D722879360B12E7b`  |

> Verify on-chain with `cast call $PUSDManager "getSupportedTokenAt(uint256)(address)" $i --rpc-url https://evm.donut.rpc.push.org/`.

### Build flags

`contracts/foundry.toml` carries `via_ir = true` and `evm_version = "shanghai"` — both required for `PUSDPlusVault` to fit under EIP-170.

## Frontend Setup

The frontend is located in the `app/` directory and uses:
- React + TypeScript
- Vite
- @pushchain/ui-kit for wallet connection
- ethers.js for contract interactions
- Tailwind CSS for styling

### Environment Variables
Create `app/.env.local`:
```
VITE_PUSD_ADDRESS=0x488d080e16386379561a47A4955D22001d8A9D89
VITE_PUSD_MANAGER_ADDRESS=0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46
VITE_PUSD_PLUS_ADDRESS=0xb55a5B36d82D3B7f18Afe42F390De565080A49a1
VITE_INSURANCE_FUND_ADDRESS=0xFF7E741621ad5d39015759E3d606A631Fa319a62
VITE_CHAIN_ID=42101
VITE_RPC_URL=https://evm.donut.rpc.push.org/
```

### Run Frontend
```bash
cd app
npm install
npm run dev
```

## Historical deployments

See [`contracts/deployed.txt`](contracts/deployed.txt) for Deployment 3 (pre-V2)
and earlier entries.

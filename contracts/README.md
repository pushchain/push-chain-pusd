# PUSD — Contracts (`/contracts`)

Foundry project containing the two on-chain contracts that power PUSD on Push Chain Donut Testnet.

## Contracts

| File                  | Proxy address                                | Purpose                                      |
| --------------------- | -------------------------------------------- | -------------------------------------------- |
| `src/PUSD.sol`        | `0x488d080e16386379561a47A4955D22001d8A9D89` | ERC-20 token, 6 decimals, UUPS proxy         |
| `src/PUSDManager.sol` | `0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46` | Reserve orchestrator, UUPS proxy             |

Both verified on [donut.push.network](https://donut.push.network). Historical deployments in [`deployed.txt`](deployed.txt).

## Architecture

`PUSD` is a minimal ERC-20. It exposes `mint` and `burn` gated by `MINTER_ROLE` and `BURNER_ROLE` respectively — both held exclusively by `PUSDManager`.

`PUSDManager` owns all reserve logic:

- `deposit(token, amount, recipient)` — pulls the reserve token from `msg.sender`, mints PUSD 1:1 (minus `surplusHaircutBps`) to `recipient`.
- `redeem(pusdAmount, preferredAsset, allowBasket, recipient)` — burns `pusdAmount` of `msg.sender`'s PUSD via `BURNER_ROLE`, sends the preferred reserve token to `recipient`. If the preferred token is short and `allowBasket = true`, pays out proportionally across all reserve tokens instead of reverting.

### Fee model

| Fee                     | Default      | Max           |
| ----------------------- | ------------ | ------------- |
| Deposit haircut         | 0 bps (0%)   | 4000 bps (40%) |
| Base redemption fee     | 5 bps (0.05%)| 100 bps (1%)  |
| Preferred asset premium | dynamic      | 200 bps (2%)  |

Net PUSD minted  = `amount − floor(amount × haircutBps / 10000)`  
Net token out    = `pusdAmount − floor(pusdAmount × (baseFee + preferredFee) / 10000)`

### Roles

| Role               | Held by         | Permission                           |
| ------------------ | --------------- | ------------------------------------ |
| `MINTER_ROLE`      | PUSDManager     | Call `PUSD.mint`                     |
| `BURNER_ROLE`      | PUSDManager     | Call `PUSD.burn`                     |
| `UPGRADER_ROLE`    | admin multisig  | Call `upgradeToAndCall` on both proxies |
| `DEFAULT_ADMIN_ROLE` | admin multisig | Manage all roles                     |

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

## Build & test

```bash
cd contracts
forge build
forge test          # full suite (~60 tests)
forge test -vvv     # with traces
forge test --gas-report
```

## Deployment

1. Copy and fill in the env file:

```bash
cp .env.example .env
# set ADMIN_ADDRESS and PRIVATE_KEY (or use --account deployer below)
```

2. Import deployer key into Foundry's encrypted wallet store:

```bash
cast wallet import deployer --interactive
```

3. Get Donut testnet gas from the [Push Chain faucet](https://faucet.push.org/).

4. Deploy:

```bash
forge script script/DeployAndConfigure.s.sol \
  --rpc-url https://evm.donut.rpc.push.org/ \
  --chain 42101 \
  --account deployer \
  --broadcast
```

5. Verify:

```bash
forge verify-contract \
  --chain 42101 \
  --verifier blockscout \
  --verifier-url https://donut.push.network/api \
  <IMPL_ADDRESS> src/PUSDManager.sol:PUSDManager
```

## Scripts

| Script                          | Purpose                                         |
| ------------------------------- | ----------------------------------------------- |
| `DeployAndConfigure.s.sol`      | Deploy both proxies, wire roles, add tokens     |
| `DeployPUSDWithManager.s.sol`   | Deploy proxies only (no token configuration)    |
| `AddSupportedTokens.s.sol`      | Add reserve tokens to an existing deployment    |
| `DeployPUSD.s.sol`              | Deploy PUSD token only                          |

## Useful `cast` commands

```bash
# Check PUSD total supply (6 decimals)
cast call 0x488d080e16386379561a47A4955D22001d8A9D89 \
  "totalSupply()(uint256)" \
  --rpc-url https://evm.donut.rpc.push.org/

# Check base fee (bps)
cast call 0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46 \
  "baseFee()(uint256)" \
  --rpc-url https://evm.donut.rpc.push.org/

# Check token status (0=REMOVED 1=ENABLED 2=REDEEM_ONLY 3=EMERGENCY_REDEEM)
cast call 0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46 \
  "getTokenStatus(address)(uint8)" \
  <TOKEN_ADDRESS> \
  --rpc-url https://evm.donut.rpc.push.org/
```

## Pointers

- Protocol overview: [`/README.md`](../README.md)
- Frontend: [`/app/README.md`](../app/README.md)
- Protocol design specs: [`/docs`](../docs/)
- Agent-facing contract context: [`llms.txt`](llms.txt)

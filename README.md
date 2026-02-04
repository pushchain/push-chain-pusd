# PUSD - Push USD

PUSD (Push USD) is a pegged USD stablecoin designed to pool liquidity from USDT and USDC across all chains and honor redeems. This repository contains the smart contract implementation for the PUSD token on Push Chain.

## Overview

PUSD is an upgradeable ERC-20 token with the following features:

- **Upgradeable**: Built using OpenZeppelin's UUPS proxy pattern
- **Access Control**: Role-based permissions for minting, burning, and upgrading
- **6 Decimals**: Matches USDT and USDC standard
- **Protocol-Controlled**: Mint and burn functions restricted to authorized protocol addresses

## Architecture

The contract uses:
- **UUPS Proxy Pattern**: For upgradeability without changing the proxy address
- **Access Control**: Three main roles:
  - `MINTER_ROLE`: Can mint new PUSD tokens
  - `BURNER_ROLE`: Can burn PUSD tokens
  - `UPGRADER_ROLE`: Can upgrade the implementation contract
  - `DEFAULT_ADMIN_ROLE`: Can manage all roles

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Git

## Installation

### 1. Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### 2. Clone and Setup

```bash
git clone <repository-url>
cd push-chain-pusd
```

### 3. Install Dependencies

```bash
forge install OpenZeppelin/openzeppelin-contracts
forge install OpenZeppelin/openzeppelin-contracts-upgradeable
forge install foundry-rs/forge-std
```

### 4. Build

```bash
forge build
```

## Testing

Run the test suite:

```bash
forge test
```

Run tests with verbosity:

```bash
forge test -vvv
```

Run tests with gas reporting:

```bash
forge test --gas-report
```

## Deployment

### 1. Set up Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and set your admin address:

```
ADMIN_ADDRESS=0xYourAdminAddress
```

### 2. Set up Deployer Wallet

Following best security practices, use Foundry's wallet management:

```bash
cast wallet import deployer --interactive
```

You'll be prompted to enter your private key and create a password to encrypt it.

### 3. Get Testnet Tokens

Ensure you have testnet tokens from the [Push Chain faucet](https://faucet.push.org/).

### 4. Deploy to Push Chain Testnet

```bash
forge script script/DeployPUSD.s.sol:DeployPUSD \
  --rpc-url push_testnet \
  --chain 42101 \
  --account deployer \
  --broadcast
```

### 5. Verify Contract

Verify the implementation contract:

```bash
forge verify-contract \
  --chain 42101 \
  --verifier blockscout \
  <IMPLEMENTATION_ADDRESS> \
  src/PUSD.sol:PUSD
```

Verify the proxy contract:

```bash
forge verify-contract \
  --chain 42101 \
  --verifier blockscout \
  <PROXY_ADDRESS> \
  @openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy
```

## Contract Interaction

### Mint Tokens

```bash
cast send <PROXY_ADDRESS> \
  "mint(address,uint256)" \
  <RECIPIENT_ADDRESS> \
  <AMOUNT> \
  --rpc-url push_testnet \
  --account deployer
```

### Burn Tokens

```bash
cast send <PROXY_ADDRESS> \
  "burn(address,uint256)" \
  <FROM_ADDRESS> \
  <AMOUNT> \
  --rpc-url push_testnet \
  --account deployer
```

### Grant Minter Role

```bash
cast send <PROXY_ADDRESS> \
  "grantRole(bytes32,address)" \
  $(cast keccak "MINTER_ROLE") \
  <NEW_MINTER_ADDRESS> \
  --rpc-url push_testnet \
  --account deployer
```

### Check Balance

```bash
cast call <PROXY_ADDRESS> \
  "balanceOf(address)(uint256)" \
  <ADDRESS> \
  --rpc-url push_testnet
```

## Upgrading

To upgrade the contract:

1. Deploy new implementation:

```solidity
// Create new implementation contract (e.g., PUSDv2.sol)
forge create src/PUSDv2.sol:PUSDv2 \
  --rpc-url push_testnet \
  --account deployer
```

2. Upgrade the proxy:

```bash
cast send <PROXY_ADDRESS> \
  "upgradeToAndCall(address,bytes)" \
  <NEW_IMPLEMENTATION_ADDRESS> \
  0x \
  --rpc-url push_testnet \
  --account deployer
```

## Security Considerations

- Never commit private keys or `.env` files
- Use hardware wallets or secure key management for mainnet deployments
- Always test upgrades on testnet first
- Ensure proper role management and access control
- Consider multi-sig for admin roles in production

## Project Structure

```
push-chain-pusd/
├── src/
│   └── PUSD.sol              # Main PUSD contract
├── script/
│   └── DeployPUSD.s.sol      # Deployment script
├── test/
│   └── PUSD.t.sol            # Test suite
├── foundry.toml              # Foundry configuration
├── remappings.txt            # Import remappings
└── README.md                 # This file
```

## Next Steps

- Implement liquidity pooling mechanism for USDT/USDC
- Add cross-chain bridge integration
- Implement redemption logic
- Add pause/unpause functionality for emergency situations
- Implement rate limiting for mints/burns
- Add comprehensive event logging for off-chain tracking

## Resources

- [Push Chain Documentation](https://docs.push.org/chain)
- [Foundry Book](https://book.getfoundry.sh/)
- [OpenZeppelin Upgradeable Contracts](https://docs.openzeppelin.com/contracts/4.x/upgradeable)

## License

MIT

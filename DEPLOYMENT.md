# PUSD Deployment Information

## Deployed Contracts (Push Chain Testnet)

### Contract Addresses
- **PUSD Token**: `0x5eb3Bc0a489C5A8288765d2336659EbCA68FCd00`
- **PUSDManager**: `0x809d550fca64d94Bd9F66E60752A544199cfAC3D`
- **Admin**: `0xB59Cdc85Cacd15097ecE4C77ed9D225014b4D56D`

### Explorer Links
- PUSD: https://donut.push.network/address/0x5eb3Bc0a489C5A8288765d2336659EbCA68FCd00
- PUSDManager: https://donut.push.network/address/0x809d550fca64d94Bd9F66E60752A544199cfAC3D

### Configuration
- **Chain ID**: 42101
- **RPC URL**: https://evm.donut.rpc.push.org/
- **Base Fee**: 0.05%
- **Supported Tokens**: 9 stablecoins across multiple chains

### Supported Tokens
1. USDT.eth (Ethereum Sepolia)
2. USDC.eth (Ethereum Sepolia)
3. USDT.sol (Solana Devnet)
4. USDC.sol (Solana Devnet)
5. USDT.base (Base Testnet)
6. USDC.base (Base Testnet)
7. USDT.arb (Arbitrum Sepolia)
8. USDC.arb (Arbitrum Sepolia)
9. USDT.bnb (BNB Testnet)

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
VITE_PUSD_ADDRESS=0x5eb3Bc0a489C5A8288765d2336659EbCA68FCd00
VITE_PUSD_MANAGER_ADDRESS=0x809d550fca64d94Bd9F66E60752A544199cfAC3D
VITE_CHAIN_ID=42101
VITE_RPC_URL=https://evm.donut.rpc.push.org/
```

### Run Frontend
```bash
cd app
npm install
npm run dev
```

## Features

### Info Tab
- Displays contract addresses
- Lists supported tokens
- Shows protocol features

### Mint Tab
- Select stablecoin to deposit
- Enter amount to mint
- Shows fee calculation
- Mint PUSD tokens

### Redeem Tab
- View PUSD balance
- Select stablecoin to receive
- Enter amount to redeem
- Redeem to any supported stablecoin

### Dashboard Tab
- View your PUSD balance
- Protocol statistics (total supply, supported tokens, fees)
- Your assets overview

## Next Steps

The MintTab.tsx component needs to be recreated. Here's the correct implementation that should be placed in `app/src/components/MintTab.tsx`. You can manually create this file or I can help you fix it.

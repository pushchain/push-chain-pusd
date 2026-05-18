// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Script.sol";
import "../src/PUSDManager.sol";

contract AddSupportedTokens is Script {
    function run() external {
        address managerProxy = vm.envAddress("PUSD_MANAGER_ADDRESS");

        PUSDManager manager = PUSDManager(managerProxy);

        vm.startBroadcast();

        manager.addSupportedToken(0x0f97A213207703923F5f0C613C9827f7C9A0f96B, "USDT.eth", "Ethereum_Sepolia", 6);
        console.log("Added USDT.eth");

        manager.addSupportedToken(0x7A58048036206bB898008b5bBDA85697DB1e5d66, "USDC.eth", "Ethereum_Sepolia", 6);
        console.log("Added USDC.eth");

        manager.addSupportedToken(0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34, "USDT.sol", "Solana_Devnet", 6);
        console.log("Added USDT.sol");

        manager.addSupportedToken(0x04B8F634ABC7C879763F623e0f0550a4b5c4426F, "USDC.sol", "Solana_Devnet", 6);
        console.log("Added USDC.sol");

        manager.addSupportedToken(0x148823809B853e1db187BC09A9ac909BC42F971a, "USDT.base", "Base_Testnet", 6);
        console.log("Added USDT.base");

        manager.addSupportedToken(0xD7C6cA1e2c0CE260BE0c0AD39C1540de460e3Be1, "USDC.base", "Base_Testnet", 6);
        console.log("Added USDC.base");

        manager.addSupportedToken(0xFE6E9DF2BbC9ce05D98b83B1365df6DcA9951891, "USDT.arb", "Arbitrum_Sepolia", 6);
        console.log("Added USDT.arb");

        manager.addSupportedToken(0x1091cCBA2FF8d2A131AE4B35e34cf3308C48572C, "USDC.arb", "Arbitrum_Sepolia", 6);
        console.log("Added USDC.arb");

        manager.addSupportedToken(0x731aF1Da5365259d27528557EE4aFBA4baC90ef2, "USDT.bsc", "BNB_Testnet", 6);
        console.log("Added USDT.bsc");

        manager.addSupportedToken(0x120EBf25Dad7D6a09Ad2316f23f9Be95DBb90639, "USDC.bsc", "BNB_Testnet", 6);
        console.log("Added USDC.bsc");

        vm.stopBroadcast();

        console.log("Successfully added all supported tokens");
        console.log("Total supported tokens:", manager.getSupportedTokensCount());
    }
}

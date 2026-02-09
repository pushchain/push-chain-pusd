// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Script.sol";
import "../src/PUSDManager.sol";

contract AddSupportedTokens is Script {
    function run() external {
        address managerProxy = vm.envAddress("PUSD_MANAGER_ADDRESS");
        
        PUSDManager manager = PUSDManager(managerProxy);
        
        vm.startBroadcast();

        manager.addSupportedToken(
            0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3,
            "USDT.eth",
            "Ethereum_Sepolia",
            6
        );
        console.log("Added USDT.eth");

        manager.addSupportedToken(
            0x387b9C8Db60E74999aAAC5A2b7825b400F12d68E,
            "USDC.eth",
            "Ethereum_Sepolia",
            6
        );
        console.log("Added USDC.eth");

        manager.addSupportedToken(
            0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34,
            "USDT.sol",
            "Solana_Devnet",
            6
        );
        console.log("Added USDT.sol");

        manager.addSupportedToken(
            0x04B8F634ABC7C879763F623e0f0550a4b5c4426F,
            "USDC.sol",
            "Solana_Devnet",
            6
        );
        console.log("Added USDC.sol");

        manager.addSupportedToken(
            0x2C455189D2af6643B924A981a9080CcC63d5a567,
            "USDT.base",
            "Base_Testnet",
            6
        );
        console.log("Added USDT.base");

        manager.addSupportedToken(
            0x84B62e44F667F692F7739Ca6040cD17DA02068A8,
            "USDC.base",
            "Base_Testnet",
            6
        );
        console.log("Added USDC.base");

        manager.addSupportedToken(
            0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9,
            "USDT.arb",
            "Arbitrum_Sepolia",
            6
        );
        console.log("Added USDT.arb");

        manager.addSupportedToken(
            0xa261A10e94aE4bA88EE8c5845CbE7266bD679DD6,
            "USDC.arb",
            "Arbitrum_Sepolia",
            6
        );
        console.log("Added USDC.arb");

        manager.addSupportedToken(
            0x2f98B4235FD2BA0173a2B056D722879360B12E7b,
            "USDT.bnb",
            "BNB_Testnet",
            6
        );
        console.log("Added USDT.bnb");

        vm.stopBroadcast();

        console.log("Successfully added all supported tokens");
        console.log("Total supported tokens:", manager.getSupportedTokensCount());
    }
}

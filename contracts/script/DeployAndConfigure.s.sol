// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/PUSD.sol";
import "../src/PUSDManager.sol";

contract DeployAndConfigure is Script {
    function run() external {
        address finalAdmin = vm.envAddress("ADMIN_ADDRESS");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== Starting PUSD Deployment ===");
        console.log("Final admin address:", finalAdmin);
        console.log("Deployer address:", deployer);

        vm.startBroadcast(deployerKey);

        // 1. Deploy PUSD (initialize with deployer so we can configure)
        console.log("\n1. Deploying PUSD Implementation...");
        address pusdImplementation = address(new PUSD());
        console.log("   PUSD Implementation:", pusdImplementation);

        console.log("\n2. Deploying PUSD Proxy...");
        bytes memory pusdInitData = abi.encodeWithSelector(
            PUSD.initialize.selector,
            deployer
        );
        address pusdProxy = address(new ERC1967Proxy(pusdImplementation, pusdInitData));
        console.log("   PUSD Proxy (Token Address):", pusdProxy);

        // 2. Deploy PUSDManager (initialize with deployer)
        console.log("\n3. Deploying PUSDManager Implementation...");
        address managerImplementation = address(new PUSDManager());
        console.log("   PUSDManager Implementation:", managerImplementation);

        console.log("\n4. Deploying PUSDManager Proxy...");
        bytes memory managerInitData = abi.encodeWithSelector(
            PUSDManager.initialize.selector,
            pusdProxy,
            deployer
        );
        address managerProxy = address(new ERC1967Proxy(managerImplementation, managerInitData));
        console.log("   PUSDManager Proxy:", managerProxy);

        // 3. Configure (deployer has admin rights)
        console.log("\n5. Granting roles to PUSDManager...");
        PUSD pusd = PUSD(pusdProxy);
        pusd.grantRole(pusd.MINTER_ROLE(), managerProxy);
        console.log("   Granted MINTER_ROLE");
        pusd.grantRole(pusd.BURNER_ROLE(), managerProxy);
        console.log("   Granted BURNER_ROLE");

        PUSDManager manager = PUSDManager(managerProxy);

        console.log("\n6. Adding supported tokens...");

        manager.addSupportedToken(
            0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3,
            "USDT.eth",
            "Ethereum_Sepolia",
            6
        );
        console.log("   Added USDT.eth");

        manager.addSupportedToken(
            0x387b9C8Db60E74999aAAC5A2b7825b400F12d68E,
            "USDC.eth",
            "Ethereum_Sepolia",
            6
        );
        console.log("   Added USDC.eth");

        manager.addSupportedToken(
            0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34,
            "USDT.sol",
            "Solana_Devnet",
            6
        );
        console.log("   Added USDT.sol");

        manager.addSupportedToken(
            0x04B8F634ABC7C879763F623e0f0550a4b5c4426F,
            "USDC.sol",
            "Solana_Devnet",
            6
        );
        console.log("   Added USDC.sol");

        manager.addSupportedToken(
            0x2C455189D2af6643B924A981a9080CcC63d5a567,
            "USDT.base",
            "Base_Testnet",
            6
        );
        console.log("   Added USDT.base");

        manager.addSupportedToken(
            0x84B62e44F667F692F7739Ca6040cD17DA02068A8,
            "USDC.base",
            "Base_Testnet",
            6
        );
        console.log("   Added USDC.base");

        manager.addSupportedToken(
            0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9,
            "USDT.arb",
            "Arbitrum_Sepolia",
            6
        );
        console.log("   Added USDT.arb");

        manager.addSupportedToken(
            0xa261A10e94aE4bA88EE8c5845CbE7266bD679DD6,
            "USDC.arb",
            "Arbitrum_Sepolia",
            6
        );
        console.log("   Added USDC.arb");

        manager.addSupportedToken(
            0x2f98B4235FD2BA0173a2B056D722879360B12E7b,
            "USDT.bnb",
            "BNB_Testnet",
            6
        );
        console.log("   Added USDT.bnb");

        console.log("\n7. Setting fees...");
        manager.setBaseFee(5);
        console.log("   Base fee set to 0.05%");

        manager.setPreferredFeeRange(10, 50);
        console.log("   Preferred fee range: 0.1% - 0.5%");

        // 4. Transfer admin to finalAdmin if different from deployer
        if (finalAdmin != deployer) {
            console.log("\n8. Transferring admin roles to final admin...");

            // PUSD: grant roles to finalAdmin, then renounce deployer's
            pusd.grantRole(bytes32(0), finalAdmin);
            pusd.grantRole(pusd.UPGRADER_ROLE(), finalAdmin);
            console.log("   Granted PUSD admin roles to:", finalAdmin);

            pusd.renounceRole(bytes32(0), deployer);
            pusd.renounceRole(pusd.UPGRADER_ROLE(), deployer);
            console.log("   Deployer renounced PUSD admin roles");

            // PUSDManager: grant roles to finalAdmin, then renounce deployer's
            manager.grantRole(bytes32(0), finalAdmin);
            manager.grantRole(manager.UPGRADER_ROLE(), finalAdmin);
            console.log("   Granted PUSDManager admin roles to:", finalAdmin);

            manager.renounceRole(bytes32(0), deployer);
            manager.renounceRole(manager.UPGRADER_ROLE(), deployer);
            console.log("   Deployer renounced PUSDManager admin roles");
        }

        vm.stopBroadcast();

        console.log("\n=== Deployment Complete ===");
        console.log("\nContract Addresses:");
        console.log("-------------------");
        console.log("PUSD Token:", pusdProxy);
        console.log("PUSDManager:", managerProxy);
        console.log("Admin:", finalAdmin);
        console.log("\nSupported Tokens:", manager.getSupportedTokensCount());
        console.log("\nSave these addresses to app/.env.local:");
        console.log("VITE_PUSD_ADDRESS=", pusdProxy);
        console.log("VITE_PUSD_MANAGER_ADDRESS=", managerProxy);
        console.log("VITE_CHAIN_ID=42101");
        console.log("VITE_RPC_URL=https://evm.donut.rpc.push.org/");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/PUSD.sol";
import "../src/PUSDManager.sol";

contract DeployPUSDWithManager is Script {
    function run() external returns (
        address pusdProxy,
        address pusdImplementation,
        address managerProxy,
        address managerImplementation
    ) {
        address admin = vm.envAddress("ADMIN_ADDRESS");
        
        vm.startBroadcast();

        pusdImplementation = address(new PUSD());
        console.log("PUSD Implementation deployed at:", pusdImplementation);

        bytes memory pusdInitData = abi.encodeWithSelector(
            PUSD.initialize.selector,
            admin
        );

        pusdProxy = address(new ERC1967Proxy(pusdImplementation, pusdInitData));
        console.log("PUSD Proxy deployed at:", pusdProxy);

        managerImplementation = address(new PUSDManager());
        console.log("PUSDManager Implementation deployed at:", managerImplementation);

        bytes memory managerInitData = abi.encodeWithSelector(
            PUSDManager.initialize.selector,
            pusdProxy,
            admin
        );

        managerProxy = address(new ERC1967Proxy(managerImplementation, managerInitData));
        console.log("PUSDManager Proxy deployed at:", managerProxy);

        PUSD pusd = PUSD(pusdProxy);
        pusd.grantRole(pusd.MINTER_ROLE(), managerProxy);
        pusd.grantRole(pusd.BURNER_ROLE(), managerProxy);
        console.log("Granted MINTER_ROLE and BURNER_ROLE to PUSDManager");

        console.log("Admin address:", admin);

        vm.stopBroadcast();

        return (pusdProxy, pusdImplementation, managerProxy, managerImplementation);
    }
}

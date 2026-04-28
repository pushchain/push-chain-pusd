// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/PUSD.sol";

contract DeployPUSD is Script {
    function run() external returns (address proxy, address implementation) {
        address admin = vm.envAddress("ADMIN_ADDRESS");
        
        vm.startBroadcast();

        implementation = address(new PUSD());
        console.log("PUSD Implementation deployed at:", implementation);

        bytes memory initData = abi.encodeWithSelector(
            PUSD.initialize.selector,
            admin
        );

        proxy = address(new ERC1967Proxy(implementation, initData));
        console.log("PUSD Proxy deployed at:", proxy);
        console.log("Admin address:", admin);

        vm.stopBroadcast();

        return (proxy, implementation);
    }
}

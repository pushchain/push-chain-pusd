// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../src/PUSD.sol";
import "../src/PUSDManager.sol";
import "../src/PUSDPlusVault.sol";
import "../src/InsuranceFund.sol";

/**
 * @notice Fork test against the live Donut testnet — exercises the V2 deploy
 *         flow against the real deployed proxies, surfacing any issues that
 *         would show up in a real `forge script ... --broadcast`.
 *
 *         Run with:
 *           forge test --match-contract V2DeployFork \
 *             --fork-url https://evm.donut.rpc.push.org/ -vv
 */
contract V2DeployForkTest is Test {
    address constant ADMIN          = 0xA1c1AF949C5752E9714cFE54f444cE80f078069A;
    address constant PUSD_PROXY     = 0x488d080e16386379561a47A4955D22001d8A9D89;
    address constant MANAGER_PROXY  = 0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46;
    address constant UNI_V3_NPM     = 0xf9b3ac66aed14A2C7D9AA7696841aB6B27a6231e;
    address constant UNI_V3_FACTORY = 0x81b8Bca02580C7d6b636051FDb7baAC436bFb454;

    function setUp() public {
        // Skip if not on a fork — `forge test` without --fork-url has block.chainid=31337.
        vm.skip(block.chainid != 42101);
    }

    function testForkV2Deploy() public {
        // Sanity — admin actually holds the roles we need.
        bytes32 UPGRADER_ROLE      = keccak256("UPGRADER_ROLE");
        bytes32 ADMIN_ROLE         = keccak256("ADMIN_ROLE");
        bytes32 DEFAULT_ADMIN_ROLE = bytes32(0);

        PUSDManager m = PUSDManager(MANAGER_PROXY);
        assertTrue(m.hasRole(UPGRADER_ROLE, ADMIN),      "admin lacks UPGRADER_ROLE on PUSDManager");
        assertTrue(m.hasRole(ADMIN_ROLE, ADMIN),         "admin lacks ADMIN_ROLE on PUSDManager");
        assertTrue(m.hasRole(DEFAULT_ADMIN_ROLE, ADMIN), "admin lacks DEFAULT_ADMIN_ROLE on PUSDManager");

        // -------- Step 1 — upgrade PUSDManager to v2 ----------------
        vm.startPrank(ADMIN);

        PUSDManager newImpl = new PUSDManager();
        emit log_named_address("New PUSDManager impl", address(newImpl));

        // upgradeToAndCall — UUPSUpgradeable on the proxy
        (bool ok, bytes memory ret) = MANAGER_PROXY.call(
            abi.encodeWithSignature(
                "upgradeToAndCall(address,bytes)",
                address(newImpl),
                bytes("")
            )
        );
        if (!ok) {
            emit log_bytes(ret);
            revert("upgradeToAndCall reverted");
        }
        emit log("PUSDManager upgraded");

        // -------- Step 2 — deploy vault + IF ------------------------
        PUSDPlusVault vaultImpl = new PUSDPlusVault();
        ERC1967Proxy vaultProxy = new ERC1967Proxy(
            address(vaultImpl),
            abi.encodeCall(
                PUSDPlusVault.initialize,
                (ADMIN, PUSD_PROXY, MANAGER_PROXY, UNI_V3_NPM, UNI_V3_FACTORY)
            )
        );
        PUSDPlusVault vault = PUSDPlusVault(address(vaultProxy));
        emit log_named_address("PUSDPlusVault proxy", address(vault));

        InsuranceFund ifImpl = new InsuranceFund();
        ERC1967Proxy ifProxy = new ERC1967Proxy(
            address(ifImpl),
            abi.encodeCall(InsuranceFund.initialize, (ADMIN, ADMIN, ADMIN))
        );
        InsuranceFund ifund = InsuranceFund(address(ifProxy));
        emit log_named_address("InsuranceFund proxy", address(ifund));

        // -------- Step 3 — atomic config ----------------------------
        vault.grantRole(vault.MANAGER_ROLE(),     MANAGER_PROXY);
        vault.grantRole(vault.KEEPER_ROLE(),      ADMIN);
        vault.grantRole(vault.POOL_ADMIN_ROLE(),  ADMIN);
        vault.grantRole(vault.VAULT_ADMIN_ROLE(), ADMIN);
        vault.grantRole(vault.GUARDIAN_ROLE(),    ADMIN);

        vault.setHaircutBps(200);
        vault.setUnwindCapBps(500);
        vault.setMaxDeploymentBps(7000);
        vault.setMinBootstrapSize(10_000e6);
        vault.setTopUpThreshold(1_000e6);
        vault.setInstantFloorPusd(50_000e6);
        vault.setDefaultFeeTier(500);
        vault.setDefaultTickRange(-20, 20);
        vault.setInsuranceFund(address(ifund));

        ifund.setVault(address(vault));

        // -------- Step 4 — wire manager -----------------------------
        m.setPlusVault(address(vault));
        m.setFeeExempt(address(vault), true);

        vm.stopPrank();

        // -------- Final assertions ----------------------------------
        assertEq(m.plusVault(), address(vault),  "manager.plusVault not set");
        assertTrue(m.feeExempt(address(vault)),  "manager.feeExempt not set");
        assertTrue(vault.hasRole(vault.MANAGER_ROLE(), MANAGER_PROXY), "manager not MANAGER_ROLE");
        assertEq(vault.haircutBps(), 200);
        assertEq(vault.insuranceFund(), address(ifund));
    }
}

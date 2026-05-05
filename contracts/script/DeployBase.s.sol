// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../src/PUSD.sol";
import "../src/PUSDManager.sol";
import "../src/PUSDPlusVault.sol";
import "../src/InsuranceFund.sol";

/**
 * @title  DeployBase
 * @notice Shared helpers for the V1, V2, and Full deploy scripts.
 *
 *         All helpers are `internal` so each subclass can compose its own
 *         `run()` while still using the same building blocks. The atomic
 *         §12 step-3 parameters live here as constants so any tuning lands
 *         in one place.
 */
abstract contract DeployBase is Script {
    // ---- §12 step 3 atomic-proposal parameters (§16 deferred — tunable) ----
    uint16 internal constant HAIRCUT_BPS = 200; // 2%
    uint16 internal constant UNWIND_CAP_BPS = 500; // 5%
    uint16 internal constant MAX_DEPLOYMENT_BPS = 7000; // 70%
    uint24 internal constant DEFAULT_FEE_TIER = 500; // 0.05% (phase 1)
    int24 internal constant DEFAULT_TICK_LOWER = -20; // ~0.998
    int24 internal constant DEFAULT_TICK_UPPER = 20; // ~1.002
    uint256 internal constant MIN_BOOTSTRAP_SIZE = 10_000e6; // $10k per side
    uint256 internal constant TOP_UP_THRESHOLD = 1_000e6; // $1k idle
    uint256 internal constant INSTANT_FLOOR_PUSD = 50_000e6; // §8 — small redeems

    struct V1Result {
        address pusdImpl;
        address pusdProxy;
        address managerImpl;
        address managerProxy;
    }

    struct Wiring {
        address admin;
        address pusdProxy;
        address managerProxy;
        address npm;
        address factory;
        address keeper;
        address poolAdmin;
        address vaultAdmin;
        address guardian;
        bool upgradePusd;
    }

    struct V2Result {
        address vault;
        address insuranceFund;
    }

    // =================================================================
    // V1 helpers
    // =================================================================

    function _deployV1(address tempAdmin, address finalAdmin) internal returns (V1Result memory r) {
        // PUSD impl + proxy
        r.pusdImpl = address(new PUSD());
        bytes memory pusdInit = abi.encodeWithSelector(PUSD.initialize.selector, tempAdmin);
        r.pusdProxy = address(new ERC1967Proxy(r.pusdImpl, pusdInit));
        console.log("PUSD impl:        ", r.pusdImpl);
        console.log("PUSD proxy:       ", r.pusdProxy);

        // PUSDManager impl + proxy
        r.managerImpl = address(new PUSDManager());
        bytes memory mgrInit = abi.encodeWithSelector(PUSDManager.initialize.selector, r.pusdProxy, tempAdmin);
        r.managerProxy = address(new ERC1967Proxy(r.managerImpl, mgrInit));
        console.log("PUSDManager impl: ", r.managerImpl);
        console.log("PUSDManager proxy:", r.managerProxy);

        // Grant mint/burn roles
        PUSD pusd = PUSD(r.pusdProxy);
        pusd.grantRole(pusd.MINTER_ROLE(), r.managerProxy);
        pusd.grantRole(pusd.BURNER_ROLE(), r.managerProxy);

        // Add the supported tokens (the live Donut testnet basket)
        PUSDManager manager = PUSDManager(r.managerProxy);
        _addSupportedTokens(manager);

        // Set the launch fee config
        manager.setBaseFee(5); // 0.05%
        manager.setPreferredFeeRange(10, 50); // 0.1% - 0.5%

        // Optionally hand admin off
        if (finalAdmin != tempAdmin) {
            _transferAdmin(pusd, manager, tempAdmin, finalAdmin);
        }
    }

    function _addSupportedTokens(PUSDManager m) internal {
        m.addSupportedToken(0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3, "USDT.eth", "Ethereum_Sepolia", 6);
        m.addSupportedToken(0x7A58048036206bB898008b5bBDA85697DB1e5d66, "USDC.eth", "Ethereum_Sepolia", 6);
        m.addSupportedToken(0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34, "USDT.sol", "Solana_Devnet", 6);
        m.addSupportedToken(0x04B8F634ABC7C879763F623e0f0550a4b5c4426F, "USDC.sol", "Solana_Devnet", 6);
        m.addSupportedToken(0x2C455189D2af6643B924A981a9080CcC63d5a567, "USDT.base", "Base_Testnet", 6);
        m.addSupportedToken(0xD7C6cA1e2c0CE260BE0c0AD39C1540de460e3Be1, "USDC.base", "Base_Testnet", 6);
        m.addSupportedToken(0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9, "USDT.arb", "Arbitrum_Sepolia", 6);
        m.addSupportedToken(0x1091cCBA2FF8d2A131AE4B35e34cf3308C48572C, "USDC.arb", "Arbitrum_Sepolia", 6);
        m.addSupportedToken(0x2f98B4235FD2BA0173a2B056D722879360B12E7b, "USDT.bnb", "BNB_Testnet", 6);
        console.log("Supported tokens: 9 added");
    }

    function _transferAdmin(PUSD pusd, PUSDManager manager, address from, address to) internal {
        pusd.grantRole(bytes32(0), to);
        pusd.grantRole(pusd.UPGRADER_ROLE(), to);
        pusd.renounceRole(bytes32(0), from);
        pusd.renounceRole(pusd.UPGRADER_ROLE(), from);

        manager.grantRole(bytes32(0), to);
        manager.grantRole(manager.UPGRADER_ROLE(), to);
        manager.grantRole(manager.ADMIN_ROLE(), to);
        manager.renounceRole(bytes32(0), from);
        manager.renounceRole(manager.UPGRADER_ROLE(), from);
        manager.renounceRole(manager.ADMIN_ROLE(), from);

        console.log("Admin roles transferred to:", to);
    }

    // =================================================================
    // V2 helpers
    // =================================================================

    function _upgradeManager(address managerProxy, address deployer) internal {
        // Fail-fast role precheck — clearer error than an opaque revert mid-upgrade.
        _assertHasRole(managerProxy, keccak256("UPGRADER_ROLE"), deployer, "PUSDManager UPGRADER_ROLE");
        _assertHasRole(managerProxy, bytes32(0), deployer, "PUSDManager DEFAULT_ADMIN_ROLE");
        _assertHasRole(managerProxy, keccak256("ADMIN_ROLE"), deployer, "PUSDManager ADMIN_ROLE");

        PUSDManager newImpl = new PUSDManager();
        console.log("New PUSDManager impl:    ", address(newImpl));
        (bool ok, bytes memory ret) =
            managerProxy.call(abi.encodeWithSignature("upgradeToAndCall(address,bytes)", address(newImpl), bytes("")));
        require(ok, _revertReason(ret, "PUSDManager upgrade failed"));
        console.log("PUSDManager proxy upgraded to v2");
    }

    function _upgradePusd(address pusdProxy, address deployer) internal {
        _assertHasRole(pusdProxy, keccak256("UPGRADER_ROLE"), deployer, "PUSD UPGRADER_ROLE");

        PUSD newImpl = new PUSD();
        console.log("New PUSD impl:           ", address(newImpl));
        (bool ok, bytes memory ret) =
            pusdProxy.call(abi.encodeWithSignature("upgradeToAndCall(address,bytes)", address(newImpl), bytes("")));
        require(ok, _revertReason(ret, "PUSD upgrade failed"));
        console.log("PUSD proxy upgraded");
    }

    /// @dev Reverts with a friendly message if `account` doesn't hold `role` on
    ///      `target`. Used as a precheck on the deployer key BEFORE we do any
    ///      destructive work (impl deploy, upgrade, atomic config), so a
    ///      misconfigured PRIVATE_KEY surfaces as an obvious error instead of a
    ///      mid-flight revert.
    function _assertHasRole(address target, bytes32 role, address account, string memory roleLabel) internal view {
        (bool ok, bytes memory ret) =
            target.staticcall(abi.encodeWithSignature("hasRole(bytes32,address)", role, account));
        require(ok && ret.length == 32, string.concat("DeployBase: hasRole call failed for ", roleLabel));
        bool hasIt = abi.decode(ret, (bool));
        require(
            hasIt,
            string.concat("DeployBase: deployer lacks ", roleLabel, " - check PRIVATE_KEY matches the chain admin")
        );
    }

    function _deployVault(Wiring memory w) internal returns (PUSDPlusVault) {
        PUSDPlusVault impl = new PUSDPlusVault();
        bytes memory initData =
            abi.encodeCall(PUSDPlusVault.initialize, (w.admin, w.pusdProxy, w.managerProxy, w.npm, w.factory));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        console.log("PUSDPlusVault impl:      ", address(impl));
        console.log("PUSDPlusVault proxy:     ", address(proxy));
        return PUSDPlusVault(address(proxy));
    }

    function _deployInsuranceFund(Wiring memory w) internal returns (InsuranceFund) {
        InsuranceFund impl = new InsuranceFund();
        bytes memory initData = abi.encodeCall(InsuranceFund.initialize, (w.admin, w.vaultAdmin, w.guardian));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        console.log("InsuranceFund impl:      ", address(impl));
        console.log("InsuranceFund proxy:     ", address(proxy));
        return InsuranceFund(address(proxy));
    }

    function _atomicConfigure(PUSDPlusVault vault, InsuranceFund ifund, Wiring memory w) internal {
        vault.grantRole(vault.MANAGER_ROLE(), w.managerProxy);
        vault.grantRole(vault.KEEPER_ROLE(), w.keeper);
        vault.grantRole(vault.POOL_ADMIN_ROLE(), w.poolAdmin);
        vault.grantRole(vault.VAULT_ADMIN_ROLE(), w.vaultAdmin);
        vault.grantRole(vault.GUARDIAN_ROLE(), w.guardian);
        vault.grantRole(vault.POOL_ADMIN_ROLE(), w.keeper); // keeper auto-open

        vault.setHaircutBps(HAIRCUT_BPS);
        vault.setUnwindCapBps(UNWIND_CAP_BPS);
        vault.setMaxDeploymentBps(MAX_DEPLOYMENT_BPS);
        vault.setMinBootstrapSize(MIN_BOOTSTRAP_SIZE);
        vault.setTopUpThreshold(TOP_UP_THRESHOLD);
        vault.setInstantFloorPusd(INSTANT_FLOOR_PUSD);
        vault.setDefaultFeeTier(DEFAULT_FEE_TIER);
        vault.setDefaultTickRange(DEFAULT_TICK_LOWER, DEFAULT_TICK_UPPER);
        vault.setInsuranceFund(address(ifund));

        ifund.setVault(address(vault));
        console.log("Vault roles granted, knobs set, IF wired.");
    }

    function _wireManager(address managerProxy, address vaultAddr) internal {
        PUSDManager m = PUSDManager(managerProxy);
        m.setPlusVault(vaultAddr);
        m.setFeeExempt(vaultAddr, true);
        console.log("PUSDManager wired: plusVault + feeExempt set.");
    }

    /// @dev Combined V2 step — deploy vault + IF, run atomic config, wire manager.
    function _deployV2(Wiring memory w) internal returns (V2Result memory r) {
        PUSDPlusVault vault = _deployVault(w);
        InsuranceFund ifund = _deployInsuranceFund(w);
        _atomicConfigure(vault, ifund, w);
        _wireManager(w.managerProxy, address(vault));
        r.vault = address(vault);
        r.insuranceFund = address(ifund);
    }

    // =================================================================
    // Env + reporting helpers
    // =================================================================

    function _readWiringForV2() internal view returns (Wiring memory w) {
        w.admin = vm.envAddress("ADMIN_ADDRESS");
        w.pusdProxy = vm.envAddress("PUSD_PROXY");
        w.managerProxy = vm.envAddress("PUSD_MANAGER_PROXY");
        w.npm = vm.envAddress("UNI_V3_NPM");
        w.factory = vm.envAddress("UNI_V3_FACTORY");
        w.keeper = vm.envAddress("KEEPER_BOT");
        w.poolAdmin = vm.envAddress("POOL_ADMIN_MULTISIG");
        w.vaultAdmin = vm.envAddress("VAULT_ADMIN_MULTISIG");
        w.guardian = vm.envAddress("GUARDIAN_MULTISIG");
        try vm.envBool("UPGRADE_PUSD") returns (bool v) {
            w.upgradePusd = v;
        }
            catch {
            w.upgradePusd = false;
        }
    }

    function _logV1(V1Result memory r, address finalAdmin) internal pure {
        console.log("");
        console.log("=== V1 deploy complete ===");
        console.log("PUSD Token:       ", r.pusdProxy);
        console.log("PUSDManager:      ", r.managerProxy);
        console.log("Admin:            ", finalAdmin);
    }

    function _logV2(Wiring memory w, V2Result memory r) internal pure {
        console.log("");
        console.log("=== V2 deploy complete ===");
        console.log("PUSD:                    ", w.pusdProxy);
        console.log("PUSDManager:             ", w.managerProxy);
        console.log("PUSDPlusVault:           ", r.vault);
        console.log("InsuranceFund:           ", r.insuranceFund);
        console.log("");
        console.log("Frontend env:");
        console.log("  VITE_PUSD_ADDRESS=          ", w.pusdProxy);
        console.log("  VITE_PUSD_MANAGER_ADDRESS=  ", w.managerProxy);
        console.log("  VITE_PUSD_PLUS_ADDRESS=     ", r.vault);
        console.log("  VITE_INSURANCE_FUND_ADDRESS=", r.insuranceFund);
        console.log("  VITE_CHAIN_ID=               42101");
    }

    function _revertReason(bytes memory ret, string memory fallbackMsg) internal pure returns (string memory) {
        if (ret.length < 68) return fallbackMsg;
        assembly { ret := add(ret, 0x04) }
        return string(abi.decode(ret, (string)));
    }
}

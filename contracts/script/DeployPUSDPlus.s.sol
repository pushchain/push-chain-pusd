// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../src/PUSDPlusVault.sol";
import "../src/InsuranceFund.sol";

/**
 * @title  DeployPUSDPlus
 * @notice Implements PUSD+ design doc §12: deploy the vault + insurance fund
 *         behind UUPS proxies and run the §12 step-3 atomic configuration. Every
 *         role grant and setter MUST land in the same timelock-executed batch
 *         so the vault is never live with a misconfigured set of caps.
 *
 *         Run modes:
 *           PRIVATE_KEY=0x... forge script script/DeployPUSDPlus.s.sol:DeployPUSDPlus \
 *             --rpc-url $PUSH_RPC --broadcast
 *
 *         Required env vars:
 *           ADMIN_TIMELOCK         DEFAULT_ADMIN holder on every contract
 *           PUSD_PROXY             existing PUSD ERC-20 (deployed v2)
 *           PUSD_MANAGER_PROXY     existing PUSDManager (already upgraded to v2 src)
 *           UNI_V3_NPM             Push Chain Uniswap V3 NonfungiblePositionManager
 *           UNI_V3_FACTORY         Push Chain Uniswap V3 Factory
 *           KEEPER_BOT             keeper hot wallet
 *           POOL_ADMIN_MULTISIG
 *           VAULT_ADMIN_MULTISIG
 *           GUARDIAN_MULTISIG
 *
 * @dev    Function bodies are intentionally split into _deployVault, _deployIF,
 *         and _atomicConfigure so each frame stays under the EVM stack limit
 *         even without `via_ir`. Storing addresses in struct fields would also
 *         work but adds a layer; explicit helpers keep the call sites readable.
 */
contract DeployPUSDPlus is Script {
    // ---- §12 step 3 atomic-proposal parameters (§16 deferred — tunable) ----
    uint16  internal constant HAIRCUT_BPS         = 200;        // 2%
    uint16  internal constant UNWIND_CAP_BPS      = 500;        // 5%
    uint16  internal constant MAX_DEPLOYMENT_BPS  = 7000;       // 70%
    uint24  internal constant DEFAULT_FEE_TIER    = 500;        // 0.05% (phase 1)
    int24   internal constant DEFAULT_TICK_LOWER  = -20;        // ~0.998
    int24   internal constant DEFAULT_TICK_UPPER  =  20;        // ~1.002
    uint256 internal constant MIN_BOOTSTRAP_SIZE  = 10_000e6;   // $10k per side, 6 dec
    uint256 internal constant TOP_UP_THRESHOLD    = 1_000e6;    // $1k idle to trigger top-up
    uint256 internal constant INSTANT_FLOOR_PUSD  = 50_000e6;   // §8 — small redeems never throttled

    /// @dev Bag of addresses passed between the helpers. Using a struct keeps
    ///      function signatures small and the stack frames shallow.
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
    }

    function run() external {
        Wiring memory w = _readEnv();
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        PUSDPlusVault vault = _deployVault(w);
        InsuranceFund ifund = _deployInsuranceFund(w);

        _atomicConfigure(vault, ifund, w);
        _wireManager(w.managerProxy, address(vault));

        vm.stopBroadcast();

        console.log("Deploy + atomic configuration complete.");
        console.log("Vault:           ", address(vault));
        console.log("InsuranceFund:   ", address(ifund));
        console.log("PUSDManager (v2):", w.managerProxy);
    }

    // -----------------------------------------------------------------
    // §12 step 1 — vault proxy
    // -----------------------------------------------------------------
    function _deployVault(Wiring memory w) internal returns (PUSDPlusVault) {
        PUSDPlusVault impl = new PUSDPlusVault();
        bytes memory initData = abi.encodeCall(
            PUSDPlusVault.initialize,
            (w.admin, w.pusdProxy, w.managerProxy, w.npm, w.factory)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        console.log("PUSDPlusVault impl :", address(impl));
        console.log("PUSDPlusVault proxy:", address(proxy));
        return PUSDPlusVault(address(proxy));
    }

    // -----------------------------------------------------------------
    // Insurance fund proxy (passive haircut destination)
    // -----------------------------------------------------------------
    function _deployInsuranceFund(Wiring memory w) internal returns (InsuranceFund) {
        InsuranceFund impl = new InsuranceFund();
        bytes memory initData = abi.encodeCall(
            InsuranceFund.initialize,
            (w.admin, w.vaultAdmin, w.guardian)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        console.log("InsuranceFund impl :", address(impl));
        console.log("InsuranceFund proxy:", address(proxy));
        return InsuranceFund(address(proxy));
    }

    // -----------------------------------------------------------------
    // §12 step 3 — atomic role grants + knob setters + IF wiring.
    // For mainnet this body is encoded into a TimelockController batch.
    // -----------------------------------------------------------------
    function _atomicConfigure(PUSDPlusVault vault, InsuranceFund ifund, Wiring memory w) internal {
        // Role grants
        vault.grantRole(vault.MANAGER_ROLE(),     w.managerProxy);
        vault.grantRole(vault.KEEPER_ROLE(),      w.keeper);
        vault.grantRole(vault.POOL_ADMIN_ROLE(),  w.poolAdmin);
        vault.grantRole(vault.VAULT_ADMIN_ROLE(), w.vaultAdmin);
        vault.grantRole(vault.GUARDIAN_ROLE(),    w.guardian);
        // Keeper also needs POOL_ADMIN — auto-open pools during rebalance (§6 step 5).
        vault.grantRole(vault.POOL_ADMIN_ROLE(),  w.keeper);

        // Vault knobs (every setter has an in-body hard cap that reverts on overshoot)
        vault.setHaircutBps(HAIRCUT_BPS);
        vault.setUnwindCapBps(UNWIND_CAP_BPS);
        vault.setMaxDeploymentBps(MAX_DEPLOYMENT_BPS);
        vault.setMinBootstrapSize(MIN_BOOTSTRAP_SIZE);
        vault.setTopUpThreshold(TOP_UP_THRESHOLD);
        vault.setInstantFloorPusd(INSTANT_FLOOR_PUSD);
        vault.setDefaultFeeTier(DEFAULT_FEE_TIER);
        vault.setDefaultTickRange(DEFAULT_TICK_LOWER, DEFAULT_TICK_UPPER);
        vault.setInsuranceFund(address(ifund));

        // Wire vault address into IF (only DEFAULT_ADMIN can set this)
        ifund.setVault(address(vault));
    }

    // -----------------------------------------------------------------
    // PUSDManager v2 wiring — low-level so this script doesn't import the
    // upgraded PUSDManager source (works against the deployed proxy ABI).
    // -----------------------------------------------------------------
    function _wireManager(address managerProxy, address vaultAddr) internal {
        (bool ok1, ) = managerProxy.call(
            abi.encodeWithSignature("setPlusVault(address)", vaultAddr)
        );
        require(ok1, "DeployPUSDPlus: setPlusVault failed");
        (bool ok2, ) = managerProxy.call(
            abi.encodeWithSignature("setFeeExempt(address,bool)", vaultAddr, true)
        );
        require(ok2, "DeployPUSDPlus: setFeeExempt failed");
    }

    // -----------------------------------------------------------------
    // Env helpers
    // -----------------------------------------------------------------
    function _readEnv() internal view returns (Wiring memory w) {
        w.admin        = vm.envAddress("ADMIN_TIMELOCK");
        w.pusdProxy    = vm.envAddress("PUSD_PROXY");
        w.managerProxy = vm.envAddress("PUSD_MANAGER_PROXY");
        w.npm          = vm.envAddress("UNI_V3_NPM");
        w.factory      = vm.envAddress("UNI_V3_FACTORY");
        w.keeper       = vm.envAddress("KEEPER_BOT");
        w.poolAdmin    = vm.envAddress("POOL_ADMIN_MULTISIG");
        w.vaultAdmin   = vm.envAddress("VAULT_ADMIN_MULTISIG");
        w.guardian     = vm.envAddress("GUARDIAN_MULTISIG");
    }
}

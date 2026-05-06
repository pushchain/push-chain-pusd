// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../src/PUSD.sol";
import "../src/PUSDManager.sol";
import "../src/PUSDPlusVault.sol";
import "../src/InsuranceFund.sol";
import "../src/interfaces/INonfungiblePositionManager.sol";

import {MockERC20, MockNPM, MockUniV3Factory, MockUniV3Pool} from "./PUSDPlusVault.t.sol";

/// @dev Bounded variants of sweepAllSurplus and rebalance — exercised once
///      the supported-token list / position list grows.
contract BoundedBatchVariantsTest is Test {
    PUSD public pusd;
    PUSDManager public manager;
    PUSDPlusVault public vault;
    InsuranceFund public ifund;

    MockNPM public npm;
    MockUniV3Pool public pool;
    MockUniV3Factory public factory;

    address public admin = address(0xA1);
    address public keeper = address(0xA2);
    address public poolAdmin = address(0xA3);
    address public vaultAdmin = address(0xA4);
    address public guardian = address(0xA5);
    address public treasury = address(0xA6);
    address public alice = address(0xB1);

    MockERC20[] public tokens;

    uint256 internal constant ONE_M = 1_000_000e6;

    function setUp() public {
        // ---- PUSD + PUSDManager ----
        PUSD pusdImpl = new PUSD();
        ERC1967Proxy pusdProxy =
            new ERC1967Proxy(address(pusdImpl), abi.encodeWithSelector(PUSD.initialize.selector, admin));
        pusd = PUSD(address(pusdProxy));

        PUSDManager mgrImpl = new PUSDManager();
        ERC1967Proxy mgrProxy = new ERC1967Proxy(
            address(mgrImpl), abi.encodeWithSelector(PUSDManager.initialize.selector, address(pusd), admin)
        );
        manager = PUSDManager(address(mgrProxy));

        vm.startPrank(admin);
        pusd.grantRole(keccak256("MINTER_ROLE"), address(manager));
        pusd.grantRole(keccak256("BURNER_ROLE"), address(manager));
        manager.setTreasuryReserve(treasury);
        vm.stopPrank();

        // ---- 5 reserve tokens. tokens[0..1] are vault basket reserves (no
        //      haircut so the rebalance fixture can mint clean PUSD+);
        //      tokens[2..4] carry a 5% haircut so deposits accrue surplus
        //      that sweepSurplusBatch can drain.
        for (uint256 i; i < 5; i++) {
            string memory s = string.concat("T", vm.toString(i));
            MockERC20 t = new MockERC20(s, s, 6);
            tokens.push(t);
            t.mint(alice, ONE_M);
            vm.startPrank(admin);
            manager.addSupportedToken(address(t), s, "eth", 6);
            if (i >= 2) manager.setSurplusHaircutBps(address(t), 500);
            vm.stopPrank();
        }

        // ---- Vault stack (only needed for rebalanceBatch tests) ----
        factory = new MockUniV3Factory();
        npm = new MockNPM();
        pool = new MockUniV3Pool();
        npm.setFactory(address(factory));

        PUSDPlusVault vImpl = new PUSDPlusVault();
        ERC1967Proxy vProxy = new ERC1967Proxy(
            address(vImpl),
            abi.encodeCall(
                PUSDPlusVault.initialize, (admin, address(pusd), address(manager), address(npm), address(factory))
            )
        );
        vault = PUSDPlusVault(address(vProxy));

        InsuranceFund iImpl = new InsuranceFund();
        ERC1967Proxy iProxy =
            new ERC1967Proxy(address(iImpl), abi.encodeCall(InsuranceFund.initialize, (admin, vaultAdmin, guardian)));
        ifund = InsuranceFund(address(iProxy));
        vm.prank(admin);
        ifund.setVault(address(vault));

        vm.startPrank(admin);
        vault.grantRole(vault.MANAGER_ROLE(), address(manager));
        vault.grantRole(vault.KEEPER_ROLE(), keeper);
        vault.grantRole(vault.POOL_ADMIN_ROLE(), poolAdmin);
        vault.grantRole(vault.VAULT_ADMIN_ROLE(), vaultAdmin);
        vault.grantRole(vault.GUARDIAN_ROLE(), guardian);
        vm.stopPrank();

        vm.startPrank(vaultAdmin);
        vault.setHaircutBps(200);
        vault.setUnwindCapBps(500);
        vault.setMaxDeploymentBps(7000);
        vault.setInsuranceFund(address(ifund));
        vm.stopPrank();

        vm.startPrank(poolAdmin);
        vault.addBasketToken(address(tokens[0]));
        vault.addBasketToken(address(tokens[1]));
        factory.setPool(address(tokens[0]), address(tokens[1]), 500, address(pool));
        vm.stopPrank();

        vm.startPrank(admin);
        manager.setPlusVault(address(vault));
        manager.setFeeExempt(address(vault), true);
        vm.stopPrank();
    }

    // -------------------------------------------------------------------
    // sweepSurplusBatch
    // -------------------------------------------------------------------

    function _accruedSurplus(MockERC20 t) internal view returns (uint256) {
        return manager.accruedFees(address(t)) + manager.accruedHaircut(address(t));
    }

    function _depositOnHaircutTokens(uint256 amount) internal {
        // Generate haircut surplus on tokens[2..4] (the haircut-bearing set).
        vm.startPrank(alice);
        for (uint256 i = 2; i < tokens.length; i++) {
            tokens[i].approve(address(manager), amount);
            manager.deposit(address(tokens[i]), amount, alice);
        }
        vm.stopPrank();
    }

    function testSweepSurplusBatch_partialPage() public {
        _depositOnHaircutTokens(1_000e6);

        // Sweep tokens[2..3] only (count=2 starting at index 2).
        vm.prank(admin);
        manager.sweepSurplusBatch(2, 2);

        assertEq(_accruedSurplus(tokens[2]), 0, "tokens[2] swept");
        assertEq(_accruedSurplus(tokens[3]), 0, "tokens[3] swept");
        assertGt(_accruedSurplus(tokens[4]), 0, "tokens[4] untouched");
    }

    function testSweepSurplusBatch_secondPageCompletesSweep() public {
        _depositOnHaircutTokens(1_000e6);

        vm.prank(admin);
        manager.sweepSurplusBatch(2, 2);
        vm.prank(admin);
        manager.sweepSurplusBatch(4, 1);

        for (uint256 i = 2; i < tokens.length; i++) {
            assertEq(_accruedSurplus(tokens[i]), 0, "remaining surplus");
        }
    }

    function testSweepSurplusBatch_clampsCountToTokenCount() public {
        _depositOnHaircutTokens(1_000e6);

        // Ask for 100 from index 3 — only 2 left, but should not revert.
        vm.prank(admin);
        manager.sweepSurplusBatch(3, 100);

        assertEq(_accruedSurplus(tokens[3]), 0);
        assertEq(_accruedSurplus(tokens[4]), 0);
        assertGt(_accruedSurplus(tokens[2]), 0);
    }

    function testSweepSurplusBatch_revertsOnStartOutOfRange() public {
        _depositOnHaircutTokens(1_000e6);
        vm.prank(admin);
        vm.expectRevert(bytes("PUSDManager: startIdx out of range"));
        manager.sweepSurplusBatch(5, 1);
    }

    function testSweepSurplusBatch_revertsWhenNoSurplusInRange() public {
        _depositOnHaircutTokens(1_000e6);

        // tokens[0..1] have zero haircut so a sweep of [0,2) finds nothing.
        vm.prank(admin);
        vm.expectRevert(bytes("PUSDManager: no surplus to sweep"));
        manager.sweepSurplusBatch(0, 2);
    }

    function testSweepSurplusBatch_onlyAdminRole() public {
        _depositOnHaircutTokens(1_000e6);
        vm.prank(alice);
        vm.expectRevert(); // AccessControl revert
        manager.sweepSurplusBatch(2, 2);
    }

    // -------------------------------------------------------------------
    // rebalanceBatch
    // -------------------------------------------------------------------

    function _seedPositions(uint256 n) internal {
        // v2.1 — direct deposits put reserves into the vault directly. No
        // keeper conversion step needed before opening pools.
        for (uint256 i; i < n; i++) {
            vm.startPrank(alice);
            tokens[0].approve(address(manager), 200e6);
            manager.depositToPlus(address(tokens[0]), 200e6, alice);
            tokens[1].approve(address(manager), 200e6);
            manager.depositToPlus(address(tokens[1]), 200e6, alice);
            vm.stopPrank();

            vm.prank(poolAdmin);
            vault.openPool(
                INonfungiblePositionManager.MintParams({
                    token0: address(tokens[0]),
                    token1: address(tokens[1]),
                    fee: 500,
                    tickLower: -20,
                    tickUpper: 20,
                    amount0Desired: 100e6,
                    amount1Desired: 100e6,
                    amount0Min: 0,
                    amount1Min: 0,
                    recipient: address(vault),
                    deadline: block.timestamp + 60
                })
            );
        }
    }

    function testRebalanceBatch_revertsOnStartOutOfRange() public {
        _seedPositions(1);
        vm.prank(keeper);
        vm.expectRevert(bytes("Vault: startIdx out of range"));
        vault.rebalanceBatch(1, 1);
    }

    function testRebalanceBatch_clampsCountToPositionCount() public {
        _seedPositions(2);
        // Asking 100 from idx 1 → only 1 to harvest; must not revert.
        vm.prank(keeper);
        vault.rebalanceBatch(1, 100);
    }

    function testRebalanceBatch_partialThenFull() public {
        _seedPositions(3);

        // Page 1: positions 0..1 (count=2)
        vm.prank(keeper);
        vault.rebalanceBatch(0, 2);

        // Page 2: position 2..end (count=10 — clamped)
        vm.prank(keeper);
        vault.rebalanceBatch(2, 10);
    }

    function testRebalanceBatch_haircutAppliedPerPosition() public {
        _seedPositions(2);

        // Accrue mock fees so the harvest path mints non-zero amounts.
        npm.accrueFees(1, 100e6, 100e6);
        npm.accrueFees(2, 100e6, 100e6);

        // Stage tokens so the mock NPM has something to send.
        deal(address(tokens[0]), address(npm), 1_000e6);
        deal(address(tokens[1]), address(npm), 1_000e6);

        uint256 ifBefore0 = tokens[0].balanceOf(address(ifund));
        uint256 ifBefore1 = tokens[1].balanceOf(address(ifund));

        vm.prank(keeper);
        vault.rebalanceBatch(0, 2);

        // 2% haircut on 200e6 (sum across both positions per side) = 4e6.
        assertEq(tokens[0].balanceOf(address(ifund)) - ifBefore0, 4e6, "haircut leg0");
        assertEq(tokens[1].balanceOf(address(ifund)) - ifBefore1, 4e6, "haircut leg1");
    }

    function testRebalanceBatch_onlyKeeper() public {
        _seedPositions(1);
        vm.prank(alice);
        vm.expectRevert();
        vault.rebalanceBatch(0, 1);
    }

    function testRebalanceBatch_pausedReverts() public {
        _seedPositions(1);
        vm.prank(guardian);
        vault.pause();
        vm.prank(keeper);
        vm.expectRevert();
        vault.rebalanceBatch(0, 1);
    }
}

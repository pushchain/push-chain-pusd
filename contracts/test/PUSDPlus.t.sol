// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../src/PUSD.sol";
import "../src/PUSDManager.sol";
import "../src/PUSDPlus.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockLiquidity.sol";

/**
 * @notice Full integration of Manager + PUSD+ where the LP engine is the lightweight mock.
 *         The test harness exercises four key behaviours of PUSDPlus:
 *          - depositStable / redeemToStable round-trip (Manager.mintForVault → mintShares → burnShares → Manager.redeemForVault)
 *          - HWM-based performance fee crystallisation
 *          - Pause semantics
 *          - ERC-4626 standard entrypoints (deposit / withdraw with PUSD as `assets`)
 */
contract PUSDPlusTest is Test {
    PUSD public pusd;
    PUSDManager public manager;
    PUSDPlus public plus;

    MockERC20 public usdc;
    MockLiquidity public liquidity;

    address public admin   = address(0xA11CE);
    address public pauser  = address(0xB0B);
    address public feeRcv  = address(0xFEE);
    address public alice   = address(0x1111);
    address public bob     = address(0x2222);

    bytes32 internal constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 internal constant BURNER_ROLE = keccak256("BURNER_ROLE");

    uint256 internal constant ONE_PUSD = 1e6;

    function setUp() public {
        // PUSD
        PUSD pusdImpl = new PUSD();
        bytes memory pusdInit = abi.encodeWithSelector(PUSD.initialize.selector, admin);
        pusd = PUSD(address(new ERC1967Proxy(address(pusdImpl), pusdInit)));

        // Manager
        PUSDManager mImpl = new PUSDManager();
        bytes memory mInit = abi.encodeWithSelector(PUSDManager.initialize.selector, address(pusd), admin);
        manager = PUSDManager(address(new ERC1967Proxy(address(mImpl), mInit)));

        // PUSDPlus
        PUSDPlus pImpl = new PUSDPlus();
        bytes memory pInit = abi.encodeWithSelector(
            PUSDPlus.initialize.selector,
            address(pusd), address(manager), admin, feeRcv
        );
        plus = PUSDPlus(address(new ERC1967Proxy(address(pImpl), pInit)));

        // Wire roles
        vm.startPrank(admin);
        pusd.grantRole(MINTER_ROLE, address(manager));
        pusd.grantRole(BURNER_ROLE, address(manager));
        manager.setPUSDPlus(address(plus));
        plus.grantRole(plus.PAUSER_ROLE(), pauser);
        vm.stopPrank();

        // Token + liquidity stub
        usdc = new MockERC20("USDC", "USDC", 6);
        vm.prank(admin);
        manager.addSupportedToken(address(usdc), "USDC", "Push", 6);

        liquidity = new MockLiquidity();
        vm.prank(admin);
        manager.setPUSDLiquidity(address(liquidity));
        // PUSDPlus also points at the liquidity for NAV; not strictly required for these tests.
        vm.prank(admin);
        plus.setPUSDLiquidity(address(liquidity));

        // Funding
        usdc.mint(alice, 100_000 * 1e6);
        usdc.mint(bob,   100_000 * 1e6);
    }

    // =========================================================================
    //                        Initialisation
    // =========================================================================

    function testInitialState() public view {
        assertEq(plus.asset(), address(pusd));
        assertEq(plus.pusdManager(), address(manager));
        assertEq(plus.pusdLiquidity(), address(liquidity));
        assertEq(plus.performanceFeeBps(), 1000);
        assertEq(plus.performanceFeeRecipient(), feeRcv);
        assertEq(plus.totalSupply(), 0);
        assertEq(plus.totalAssets(), 0);
        assertEq(plus.pricePerShare(), 1e18);
        assertTrue(plus.hasRole(plus.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(plus.hasRole(plus.LIQUIDITY_ROLE(), address(liquidity)));
        assertFalse(plus.paused());
    }

    function testCannotInitializeTwice() public {
        vm.expectRevert();
        plus.initialize(address(pusd), address(manager), admin, feeRcv);
    }

    // =========================================================================
    //                        depositStable
    // =========================================================================

    function testDepositStable_HappyPath() public {
        uint256 amt = 1_000 * 1e6;
        vm.startPrank(alice);
        usdc.approve(address(plus), amt);
        uint256 shares = plus.depositStable(address(usdc), amt, alice);
        vm.stopPrank();

        // PUSD minted into PUSDPlus, shares minted to alice.
        assertEq(pusd.balanceOf(address(plus)), amt);
        assertEq(plus.balanceOf(alice), shares);
        assertGt(shares, 0);

        // Manager booked the deposit on the yield slice.
        assertEq(manager.yieldShareReserve(address(usdc)), amt);
        assertEq(manager.parReserve(address(usdc)), 0);

        // pps starts at 1.0 (with virtual-shares offset, conversion is exact).
        assertEq(plus.totalAssets(), amt);
    }

    function testDepositStable_ZeroAmountReverts() public {
        vm.startPrank(alice);
        usdc.approve(address(plus), 1);
        vm.expectRevert(PUSDPlus.ZeroAmount.selector);
        plus.depositStable(address(usdc), 0, alice);
        vm.stopPrank();
    }

    function testDepositStable_ZeroReceiverReverts() public {
        vm.startPrank(alice);
        usdc.approve(address(plus), 100);
        vm.expectRevert(PUSDPlus.ZeroAddress.selector);
        plus.depositStable(address(usdc), 100, address(0));
        vm.stopPrank();
    }

    function testDepositStable_PausedReverts() public {
        vm.prank(pauser); plus.pause();
        vm.startPrank(alice);
        usdc.approve(address(plus), 100);
        vm.expectRevert();
        plus.depositStable(address(usdc), 100, alice);
        vm.stopPrank();
    }

    // =========================================================================
    //                        redeemToStable
    // =========================================================================

    function _alistDeposit(uint256 amt) internal returns (uint256 shares) {
        vm.startPrank(alice);
        usdc.approve(address(plus), amt);
        shares = plus.depositStable(address(usdc), amt, alice);
        vm.stopPrank();
    }

    function testRedeemToStable_HappyPath() public {
        uint256 amt = 1_000 * 1e6;
        uint256 shares = _alistDeposit(amt);

        vm.startPrank(alice);
        uint256 out = plus.redeemToStable(shares, address(usdc), alice);
        vm.stopPrank();

        // Round-trip with no fees: alice gets her USDC back (minus 0 base fee), shares burned.
        assertEq(out, amt);
        assertEq(plus.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(alice), 100_000 * 1e6); // back to starting balance
        assertEq(pusd.balanceOf(address(plus)), 0);
        assertEq(manager.yieldShareReserve(address(usdc)), 0);
    }

    function testRedeemToStable_WithBaseFee() public {
        // 5 bp redemption fee on the Manager-side base fee.
        vm.prank(admin); manager.setBaseFee(5);

        uint256 amt = 1_000 * 1e6;
        uint256 shares = _alistDeposit(amt);

        vm.startPrank(alice);
        uint256 out = plus.redeemToStable(shares, address(usdc), alice);
        vm.stopPrank();

        uint256 expectedFee = (amt * 5) / 10000;
        assertEq(out, amt - expectedFee);
        assertEq(manager.accruedFees(address(usdc)), expectedFee);
    }

    function testRedeemToStable_ZeroSharesReverts() public {
        vm.expectRevert(PUSDPlus.ZeroAmount.selector);
        vm.prank(alice);
        plus.redeemToStable(0, address(usdc), alice);
    }

    // =========================================================================
    //                        ERC-4626 standard paths
    // =========================================================================

    function testStandardDeposit_FromExistingPUSD() public {
        // Mint PUSD directly to alice via plain Manager.deposit.
        vm.startPrank(alice);
        usdc.approve(address(manager), 500 * 1e6);
        manager.deposit(address(usdc), 500 * 1e6, alice);
        vm.stopPrank();

        assertEq(pusd.balanceOf(alice), 500 * 1e6);

        // She wraps into PUSD+ via vanilla ERC-4626 deposit.
        vm.startPrank(alice);
        pusd.approve(address(plus), 500 * 1e6);
        uint256 shares = plus.deposit(500 * 1e6, alice);
        vm.stopPrank();

        assertGt(shares, 0);
        assertEq(plus.balanceOf(alice), shares);
        assertEq(pusd.balanceOf(address(plus)), 500 * 1e6);
        assertEq(plus.totalAssets(), 500 * 1e6);
    }

    function testStandardRedeem_BackToPUSD() public {
        vm.startPrank(alice);
        usdc.approve(address(manager), 500 * 1e6);
        manager.deposit(address(usdc), 500 * 1e6, alice);
        pusd.approve(address(plus), 500 * 1e6);
        uint256 shares = plus.deposit(500 * 1e6, alice);
        uint256 assets = plus.redeem(shares, alice, alice);
        vm.stopPrank();

        assertEq(assets, 500 * 1e6);
        assertEq(pusd.balanceOf(alice), 500 * 1e6);
        assertEq(plus.balanceOf(alice), 0);
    }

    // =========================================================================
    //                        HWM performance fee
    // =========================================================================

    function testHWMFee_AccruesOnNAVGrowth() public {
        // alice deposits 1_000 USDC.
        uint256 amt = 1_000 * 1e6;
        uint256 aliceShares = _alistDeposit(amt);

        // Simulate yield: liquidity engine reports an NAV bump of 100 PUSD.
        liquidity.setNAV(100 * 1e6);

        // Trigger crystallisation explicitly.
        plus.crystalliseFees();

        // Fee = 10% of 100 = 10 PUSD; minted as shares to feeRcv at the *current* pps.
        uint256 feeShares = plus.balanceOf(feeRcv);
        assertGt(feeShares, 0);

        // Alice's shares are unchanged in count.
        assertEq(plus.balanceOf(alice), aliceShares);

        // After fee: total assets = 1_100 (idle 1_000 + reported 100).
        assertEq(plus.totalAssets(), amt + 100 * 1e6);

        // pps must remain >= 1.0 (I-01b).
        uint256 pps = plus.pricePerShare();
        assertGe(pps, 1e18);
    }

    function testHWMFee_DoesNotChargeOnDrawdown() public {
        _alistDeposit(1_000 * 1e6);
        // First gain: NAV +100. Crystallise.
        liquidity.setNAV(100 * 1e6);
        plus.crystalliseFees();
        uint256 feeSharesAfterGain = plus.balanceOf(feeRcv);

        // Now NAV draws down (goes back to 0 reported). HWM should hold; no new fee.
        liquidity.setNAV(0);
        plus.crystalliseFees();
        assertEq(plus.balanceOf(feeRcv), feeSharesAfterGain);

        // Second gain back to +100 — still no NEW fee because HWM was already at 1_100.
        liquidity.setNAV(100 * 1e6);
        plus.crystalliseFees();
        assertEq(plus.balanceOf(feeRcv), feeSharesAfterGain);

        // A FRESH gain past the prior HWM does crystallise.
        liquidity.setNAV(200 * 1e6);
        plus.crystalliseFees();
        assertGt(plus.balanceOf(feeRcv), feeSharesAfterGain);
    }

    function testHWMFee_RespectsCap() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(PUSDPlus.PerformanceFeeTooHigh.selector, uint16(2001), uint16(2000)));
        plus.setPerformanceFeeBps(2001);
    }

    function testHWMFee_SettingFeeCrystallisesFirst() public {
        _alistDeposit(1_000 * 1e6);
        liquidity.setNAV(100 * 1e6);

        // Change fee from 10% to 20%; old earnings should crystallise at 10% rate first.
        vm.prank(admin); plus.setPerformanceFeeBps(2000);

        uint256 feeShares = plus.balanceOf(feeRcv);
        assertGt(feeShares, 0);
        assertEq(plus.performanceFeeBps(), 2000);
    }

    // =========================================================================
    //                        Pause
    // =========================================================================

    function testPause_BlocksAllUserPaths() public {
        _alistDeposit(500 * 1e6);
        vm.prank(pauser); plus.pause();

        vm.startPrank(alice);
        usdc.approve(address(plus), 100);
        vm.expectRevert();
        plus.depositStable(address(usdc), 100, alice);

        vm.expectRevert();
        plus.redeemToStable(1, address(usdc), alice);

        pusd.approve(address(plus), 1);
        vm.expectRevert();
        plus.deposit(1, alice);
        vm.stopPrank();
    }

    // =========================================================================
    //                        pps invariant (I-01b)
    // =========================================================================

    function testInvariant_PPSAtLeastOne() public {
        // Series of operations: deposit, NAV grow, fee crystallise, partial redeem, drawdown.
        _alistDeposit(1_000 * 1e6);
        liquidity.setNAV(50 * 1e6);
        plus.crystalliseFees();
        assertGe(plus.pricePerShare(), 1e18);

        uint256 sharesHalf = plus.balanceOf(alice) / 2;
        vm.prank(alice);
        plus.redeemToStable(sharesHalf, address(usdc), alice);
        assertGe(plus.pricePerShare(), 1e18);
    }

    // =========================================================================
    //                        Fuzz
    // =========================================================================

    function testFuzz_DepositRedeemRoundTrip(uint128 amount) public {
        // Bound to a plausible deposit window: 1 PUSD → 50_000 PUSD.
        amount = uint128(bound(uint256(amount), 1e6, 50_000 * 1e6));

        usdc.mint(alice, amount);

        uint256 startUSDC = usdc.balanceOf(alice);
        vm.startPrank(alice);
        usdc.approve(address(plus), amount);
        uint256 shares = plus.depositStable(address(usdc), amount, alice);
        uint256 out = plus.redeemToStable(shares, address(usdc), alice);
        vm.stopPrank();

        assertEq(out, amount, "round trip should be lossless when fees=0");
        assertEq(usdc.balanceOf(alice), startUSDC, "alice's USDC restored");
        assertEq(plus.balanceOf(alice), 0);
        assertGe(plus.pricePerShare(), 1e18);
    }
}

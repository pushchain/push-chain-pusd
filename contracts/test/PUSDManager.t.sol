// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../src/PUSD.sol";
import "../src/PUSDManager.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockLiquidity.sol";

contract PUSDManagerTest is Test {
    PUSD public pusd;
    PUSDManager public manager;

    MockERC20 public usdc;   // 6 decimals
    MockERC20 public usdt;   // 6 decimals
    MockERC20 public dai;    // 18 decimals
    MockLiquidity public liquidity;

    address public admin    = address(0xA11CE);
    address public pauser   = address(0xB0B);
    address public vault    = address(0xCAFE);   // mock PUSDPlus
    address public treasury = address(0xDEAD);
    address public user     = address(0xBEEF);
    address public alice    = address(0x1111);

    bytes32 internal constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 internal constant BURNER_ROLE = keccak256("BURNER_ROLE");

    uint256 internal constant ONE_PUSD = 1e6;

    // -------------------------------------------------------------------------
    function setUp() public {
        // Deploy PUSD via UUPS
        PUSD pusdImpl = new PUSD();
        bytes memory pusdInit = abi.encodeWithSelector(PUSD.initialize.selector, admin);
        ERC1967Proxy pusdProxy = new ERC1967Proxy(address(pusdImpl), pusdInit);
        pusd = PUSD(address(pusdProxy));

        // Deploy Manager via UUPS
        PUSDManager mImpl = new PUSDManager();
        bytes memory mInit = abi.encodeWithSelector(
            PUSDManager.initialize.selector, address(pusd), admin
        );
        ERC1967Proxy mProxy = new ERC1967Proxy(address(mImpl), mInit);
        manager = PUSDManager(address(mProxy));

        // Wire roles
        vm.startPrank(admin);
        pusd.grantRole(MINTER_ROLE, address(manager));
        pusd.grantRole(BURNER_ROLE, address(manager));
        manager.grantRole(manager.PAUSER_ROLE(), pauser);
        manager.setPUSDPlus(vault);
        manager.setTreasuryReserve(treasury);
        vm.stopPrank();

        // Tokens
        usdc = new MockERC20("USDC", "USDC", 6);
        usdt = new MockERC20("USDT", "USDT", 6);
        dai  = new MockERC20("DAI",  "DAI",  18);

        vm.startPrank(admin);
        manager.addSupportedToken(address(usdc), "USDC", "Push", 6);
        manager.addSupportedToken(address(usdt), "USDT", "Push", 6);
        manager.addSupportedToken(address(dai),  "DAI",  "Push", 18);
        vm.stopPrank();

        // Mock liquidity engine — a simple pull/push contract Manager talks to.
        liquidity = new MockLiquidity();
        vm.prank(admin);
        manager.setPUSDLiquidity(address(liquidity));

        // Fund users
        usdc.mint(user, 10_000 * 1e6);
        usdc.mint(vault, 10_000 * 1e6);
        usdt.mint(user, 10_000 * 1e6);
        usdt.mint(vault, 10_000 * 1e6);
        dai.mint(user, 10_000 * 1e18);
        dai.mint(vault, 10_000 * 1e18);
    }

    // =========================================================================
    //                            Initialisation
    // =========================================================================

    function testInitialState() public view {
        assertEq(address(manager.pusd()), address(pusd));
        assertTrue(manager.hasRole(manager.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(manager.hasRole(manager.ADMIN_ROLE(), admin));
        assertTrue(manager.hasRole(manager.UPGRADER_ROLE(), admin));
        assertTrue(manager.hasRole(manager.PAUSER_ROLE(), admin));
        assertTrue(manager.hasRole(manager.PAUSER_ROLE(), pauser));
        assertTrue(manager.hasRole(manager.VAULT_ROLE(), vault));
        assertEq(manager.pusdPlus(), vault);
        assertEq(manager.pusdLiquidity(), address(liquidity));
        assertEq(manager.tokenCount(), 3);
        assertFalse(manager.paused());
    }

    function testCannotInitializeTwice() public {
        vm.expectRevert();
        manager.initialize(address(pusd), admin);
    }

    function testRejectsZeroAdmin() public {
        PUSDManager mImpl = new PUSDManager();
        bytes memory init = abi.encodeWithSelector(
            PUSDManager.initialize.selector, address(pusd), address(0)
        );
        vm.expectRevert(bytes("PUSDManager: admin address cannot be zero"));
        new ERC1967Proxy(address(mImpl), init);
    }

    // =========================================================================
    //                          Token registry
    // =========================================================================

    function testAddSupportedToken_TokenInfoFields() public {
        PUSDManager.TokenInfo memory info = manager.getTokenInfo(address(usdc));
        assertTrue(info.exists);
        assertEq(uint256(info.status), uint256(PUSDManager.TokenStatus.ENABLED));
        assertEq(info.decimals, 6);
        assertEq(info.surplusHaircutBps, 0);
        assertEq(info.rateBearingWrapper, address(0));
        assertEq(info.unwrapAdapter, address(0));
    }

    function testAddSupportedToken_DuplicateReverts() public {
        vm.prank(admin);
        vm.expectRevert(bytes("PUSDManager: token already added"));
        manager.addSupportedToken(address(usdc), "USDC", "Push", 6);
    }

    function testAddSupportedToken_MaxTokens() public {
        // Already 3 tokens added in setUp — add up to 25, then expect revert.
        vm.startPrank(admin);
        for (uint256 i = manager.tokenCount(); i < manager.MAX_TOKENS(); i++) {
            MockERC20 t = new MockERC20("X", "X", 6);
            manager.addSupportedToken(address(t), "X", "X", 6);
        }
        MockERC20 extra = new MockERC20("Y", "Y", 6);
        vm.expectRevert(bytes("PUSDManager: token cap reached"));
        manager.addSupportedToken(address(extra), "Y", "Y", 6);
        vm.stopPrank();
    }

    function testSetTokenStatusTransitions() public {
        vm.startPrank(admin);
        manager.setTokenStatus(address(dai), PUSDManager.TokenStatus.REDEEM_ONLY);
        assertEq(uint256(manager.getTokenStatus(address(dai))), uint256(PUSDManager.TokenStatus.REDEEM_ONLY));
        manager.setTokenStatus(address(dai), PUSDManager.TokenStatus.EMERGENCY_REDEEM);
        manager.setTokenStatus(address(dai), PUSDManager.TokenStatus.REMOVED);
        vm.stopPrank();
    }

    // =========================================================================
    //                       Plain PUSD: deposit
    // =========================================================================

    function testDeposit_HappyPath_CreditsParReserveAndMints() public {
        uint256 amount = 1_000 * 1e6;
        vm.startPrank(user);
        usdc.approve(address(manager), amount);
        manager.deposit(address(usdc), amount, user);
        vm.stopPrank();

        assertEq(pusd.balanceOf(user), amount); // 6→6 dec
        assertEq(manager.parReserve(address(usdc)), amount);
        assertEq(manager.yieldShareReserve(address(usdc)), 0);
        assertEq(usdc.balanceOf(address(manager)), amount);
        _assertI01(address(usdc));
    }

    function testDeposit_WithSurplusHaircut() public {
        vm.prank(admin);
        manager.setSurplusHaircutBps(address(usdc), 100); // 1%

        uint256 amount = 1_000 * 1e6;
        uint256 surplus = (amount * 100) / 10000;
        uint256 net = amount - surplus;

        vm.startPrank(user);
        usdc.approve(address(manager), amount);
        manager.deposit(address(usdc), amount, user);
        vm.stopPrank();

        assertEq(pusd.balanceOf(user), net);
        assertEq(manager.parReserve(address(usdc)), net);
        assertEq(manager.accruedHaircut(address(usdc)), surplus);
        _assertI01(address(usdc));
    }

    function testDeposit_18Dec_NormalisesTo6() public {
        uint256 amount = 1_000 * 1e18;

        vm.startPrank(user);
        dai.approve(address(manager), amount);
        manager.deposit(address(dai), amount, user);
        vm.stopPrank();

        assertEq(pusd.balanceOf(user), 1_000 * 1e6);
        assertEq(manager.parReserve(address(dai)), amount);
        _assertI01(address(dai));
    }

    function testDeposit_NotEnabledReverts() public {
        vm.prank(admin);
        manager.setTokenStatus(address(usdc), PUSDManager.TokenStatus.REDEEM_ONLY);

        vm.startPrank(user);
        usdc.approve(address(manager), 1e6);
        vm.expectRevert(bytes("PUSDManager: token not enabled for deposits"));
        manager.deposit(address(usdc), 1e6, user);
        vm.stopPrank();
    }

    function testDeposit_PausedReverts() public {
        vm.prank(pauser);
        manager.pause();
        vm.startPrank(user);
        usdc.approve(address(manager), 1e6);
        vm.expectRevert();
        manager.deposit(address(usdc), 1e6, user);
        vm.stopPrank();
    }

    // =========================================================================
    //                       Plain PUSD: redeem
    // =========================================================================

    function _seedPar(address token, uint256 amount, address recipient) internal {
        vm.startPrank(user);
        MockERC20(token).approve(address(manager), amount);
        manager.deposit(token, amount, recipient);
        vm.stopPrank();
    }

    function testRedeem_PreferredAvailable() public {
        _seedPar(address(usdc), 1_000 * 1e6, user);

        // 5 bp base fee
        vm.prank(admin);
        manager.setBaseFee(5);

        vm.startPrank(user);
        manager.redeem(500 * ONE_PUSD, address(usdc), false, user);
        vm.stopPrank();

        // Net out = 500 - 0.25 = 499.75
        uint256 expectedFee = (500 * 1e6 * 5) / 10000;
        assertEq(usdc.balanceOf(user), 10_000 * 1e6 - 1_000 * 1e6 + (500 * 1e6 - expectedFee));
        assertEq(pusd.balanceOf(user), 500 * 1e6);
        assertEq(manager.accruedFees(address(usdc)), expectedFee);
        _assertI01(address(usdc));
    }

    function testRedeem_BasketFallback() public {
        _seedPar(address(usdc), 100 * 1e6, user);
        _seedPar(address(usdt), 400 * 1e6, user);

        // Burn 200 PUSD: prefer usdc but only 100 available, allow basket.
        vm.prank(user);
        manager.redeem(200 * ONE_PUSD, address(usdc), true, user);

        // After: total reserve was 500, redeemed 200 across both proportionally.
        assertEq(pusd.balanceOf(user), 300 * 1e6);
        _assertI01(address(usdc));
        _assertI01(address(usdt));
    }

    function testRedeem_EmergencyForcedProportional() public {
        _seedPar(address(usdc), 500 * 1e6, user);
        _seedPar(address(usdt), 500 * 1e6, user);

        vm.prank(admin);
        manager.setTokenStatus(address(usdt), PUSDManager.TokenStatus.EMERGENCY_REDEEM);

        // Even though preferred=usdc has full liquidity, emergency mode forces proportional.
        vm.prank(user);
        manager.redeem(200 * ONE_PUSD, address(usdc), false, user);

        assertEq(pusd.balanceOf(user), 800 * 1e6);
        _assertI01(address(usdc));
        _assertI01(address(usdt));
    }

    function testRedeem_OnlyTouchesParSlice() public {
        // Seed yield slice via mintForVault — should be invisible to plain redeem.
        _vaultMint(500 * 1e6);
        // Plain user has 100 PUSD backed by parReserve only.
        _seedPar(address(usdc), 100 * 1e6, user);

        // Sanity: yield slice is 500, par is 100, total balance is 600.
        assertEq(manager.yieldShareReserve(address(usdc)), 500 * 1e6);
        assertEq(manager.parReserve(address(usdc)), 100 * 1e6);
        assertEq(usdc.balanceOf(address(manager)), 600 * 1e6);

        // Plain redeem of 100 PUSD against usdc must succeed against par slice only;
        // yield slice must be untouched.
        vm.prank(user);
        manager.redeem(100 * ONE_PUSD, address(usdc), false, user);

        assertEq(manager.parReserve(address(usdc)), 0);
        assertEq(manager.yieldShareReserve(address(usdc)), 500 * 1e6);
        _assertI01(address(usdc));

        // Sanity: a plain redeem cannot reach into the yield slice even if the user holds enough PUSD
        // (it would fail because parReserve is empty and basket finds no other par tokens).
        // First top up user's PUSD by minting via mintForVault (admin path: send PUSD directly).
        vm.startPrank(vault);
        pusd.transfer(user, 100 * 1e6);
        vm.stopPrank();
        vm.startPrank(user);
        vm.expectRevert(bytes("PUSDManager: insufficient total liquidity"));
        manager.redeem(100 * ONE_PUSD, address(usdc), true, user);
        vm.stopPrank();
    }

    function testRedeem_PausedReverts() public {
        _seedPar(address(usdc), 100 * 1e6, user);
        vm.prank(pauser); manager.pause();
        vm.startPrank(user);
        vm.expectRevert();
        manager.redeem(50 * ONE_PUSD, address(usdc), false, user);
        vm.stopPrank();
    }

    // =========================================================================
    //                       Vault path: mintForVault
    // =========================================================================

    function testMintForVault_OnlyVaultRole() public {
        vm.startPrank(user);
        usdc.approve(address(manager), 1e6);
        vm.expectRevert();
        manager.mintForVault(address(usdc), 1e6, user);
        vm.stopPrank();
    }

    function testMintForVault_CreditsYieldSlice() public {
        uint256 amount = 1_000 * 1e6;
        vm.startPrank(vault);
        usdc.approve(address(manager), amount);
        uint256 minted = manager.mintForVault(address(usdc), amount, vault);
        vm.stopPrank();

        assertEq(minted, amount); // 6→6 dec, no haircut
        assertEq(pusd.balanceOf(vault), amount);
        assertEq(manager.yieldShareReserve(address(usdc)), amount);
        assertEq(manager.parReserve(address(usdc)), 0);
        _assertI01(address(usdc));
    }

    function testMintForVault_AppliesVaultHaircut() public {
        vm.prank(admin);
        manager.setVaultHaircutBps(50); // 0.5%

        uint256 amount = 1_000 * 1e6;
        uint256 hc = (amount * 50) / 10000;
        uint256 net = amount - hc;

        vm.startPrank(vault);
        usdc.approve(address(manager), amount);
        uint256 minted = manager.mintForVault(address(usdc), amount, vault);
        vm.stopPrank();

        assertEq(minted, net);
        assertEq(manager.yieldShareReserve(address(usdc)), net);
        assertEq(manager.accruedHaircut(address(usdc)), hc);
        _assertI01(address(usdc));
    }

    function testMintForVault_VaultHaircutCap() public {
        vm.prank(admin);
        vm.expectRevert(bytes("PUSDManager: vault haircut too high"));
        manager.setVaultHaircutBps(501);
    }

    function testMintForVault_PausedReverts() public {
        vm.prank(pauser);
        manager.pause();
        vm.startPrank(vault);
        usdc.approve(address(manager), 1e6);
        vm.expectRevert();
        manager.mintForVault(address(usdc), 1e6, vault);
        vm.stopPrank();
    }

    // =========================================================================
    //                       Vault path: redeemForVault
    // =========================================================================

    function _vaultMint(uint256 amount) internal {
        vm.startPrank(vault);
        usdc.approve(address(manager), amount);
        manager.mintForVault(address(usdc), amount, vault);
        vm.stopPrank();
    }

    function testRedeemForVault_FromIdleSlice() public {
        _vaultMint(1_000 * 1e6);

        vm.prank(admin); manager.setBaseFee(5);

        vm.startPrank(vault);
        uint256 out = manager.redeemForVault(500 * ONE_PUSD, address(usdc), alice);
        vm.stopPrank();

        uint256 expectedFee = (500 * 1e6 * 5) / 10000;
        assertEq(out, 500 * 1e6 - expectedFee);
        assertEq(usdc.balanceOf(alice), out);
        assertEq(manager.yieldShareReserve(address(usdc)), 500 * 1e6);
        assertEq(pusd.balanceOf(vault), 500 * 1e6);
        _assertI01(address(usdc));
    }

    function testRedeemForVault_OnlyVaultRole() public {
        _vaultMint(500 * 1e6);
        vm.startPrank(user);
        vm.expectRevert();
        manager.redeemForVault(100 * ONE_PUSD, address(usdc), user);
        vm.stopPrank();
    }

    function testRedeemForVault_PullsFromLiquidityWhenShort() public {
        // Vault mints against 500 USDC — holds 500 PUSD; yield slice = 500.
        _vaultMint(500 * 1e6);

        // Admin "deploys" 400 USDC into the liquidity engine (idle slice falls to 100).
        vm.prank(admin);
        manager.transferYieldToLiquidity(address(usdc), 400 * 1e6);
        assertEq(manager.yieldShareReserve(address(usdc)), 100 * 1e6);
        assertEq(usdc.balanceOf(address(liquidity)), 400 * 1e6);

        // Liquidity engine is willing to return everything it holds.
        liquidity.setReturnable(address(usdc), 400 * 1e6);

        vm.startPrank(vault);
        uint256 out = manager.redeemForVault(500 * ONE_PUSD, address(usdc), alice);
        vm.stopPrank();

        assertEq(out, 500 * 1e6); // baseFee = 0 by default
        assertEq(usdc.balanceOf(alice), 500 * 1e6);
        assertEq(manager.yieldShareReserve(address(usdc)), 0);
        assertEq(liquidity.totalPulled(address(usdc)), 400 * 1e6);
    }

    function testRedeemForVault_RevertsOnInsufficientLiquidity() public {
        _vaultMint(100 * 1e6);
        // Liquidity engine returns nothing.
        vm.startPrank(vault);
        vm.expectRevert(); // InsufficientLiquidity error
        manager.redeemForVault(500 * ONE_PUSD, address(usdc), alice);
        vm.stopPrank();
    }

    // =========================================================================
    //                          Reclassify
    // =========================================================================

    function testReclassify_ParToYield() public {
        _seedPar(address(usdc), 1_000 * 1e6, user);
        vm.prank(admin);
        manager.reclassify(address(usdc), true, 400 * 1e6);

        assertEq(manager.parReserve(address(usdc)), 600 * 1e6);
        assertEq(manager.yieldShareReserve(address(usdc)), 400 * 1e6);
        _assertI01(address(usdc));
    }

    function testReclassify_YieldToPar() public {
        _vaultMint(1_000 * 1e6);
        vm.prank(admin);
        manager.reclassify(address(usdc), false, 300 * 1e6);

        assertEq(manager.parReserve(address(usdc)), 300 * 1e6);
        assertEq(manager.yieldShareReserve(address(usdc)), 700 * 1e6);
        _assertI01(address(usdc));
    }

    function testReclassify_OnlyAdmin() public {
        _seedPar(address(usdc), 100 * 1e6, user);
        vm.prank(user);
        vm.expectRevert();
        manager.reclassify(address(usdc), true, 50 * 1e6);
    }

    // =========================================================================
    //                          Rebalance (per slice)
    // =========================================================================

    function testRebalance_ParSlice() public {
        _seedPar(address(usdc), 1_000 * 1e6, user);

        // Admin needs USDT to swap in
        usdt.mint(admin, 500 * 1e6);
        vm.startPrank(admin);
        usdt.approve(address(manager), 500 * 1e6);
        manager.rebalance(PUSDManager.Slice.PAR, address(usdt), 500 * 1e6, address(usdc), 500 * 1e6);
        vm.stopPrank();

        assertEq(manager.parReserve(address(usdc)), 500 * 1e6);
        assertEq(manager.parReserve(address(usdt)), 500 * 1e6);
        assertEq(manager.yieldShareReserve(address(usdc)), 0);
        assertEq(manager.yieldShareReserve(address(usdt)), 0);
        _assertI01(address(usdc));
        _assertI01(address(usdt));
    }

    function testRebalance_RejectsCrossSlice() public {
        _seedPar(address(usdc), 1_000 * 1e6, user);

        // Try to rebalance YIELD slice but yield is empty — should revert.
        usdt.mint(admin, 500 * 1e6);
        vm.startPrank(admin);
        usdt.approve(address(manager), 500 * 1e6);
        vm.expectRevert(bytes("PUSDManager: yield slice insufficient"));
        manager.rebalance(PUSDManager.Slice.YIELD, address(usdt), 500 * 1e6, address(usdc), 500 * 1e6);
        vm.stopPrank();
    }

    // =========================================================================
    //                          Sweep
    // =========================================================================

    function testSweep_SweepsAccruedFeesAndHaircut() public {
        vm.prank(admin); manager.setSurplusHaircutBps(address(usdc), 50); // 0.5%
        vm.prank(admin); manager.setBaseFee(10);                          // 0.1%

        uint256 amount = 1_000 * 1e6;
        vm.startPrank(user);
        usdc.approve(address(manager), amount);
        manager.deposit(address(usdc), amount, user);
        manager.redeem(500 * ONE_PUSD, address(usdc), false, user);
        vm.stopPrank();

        uint256 hc = (amount * 50) / 10000;       // 5
        uint256 fee = (500 * 1e6 * 10) / 10000;   // 0.5
        assertEq(manager.accruedHaircut(address(usdc)), hc);
        assertEq(manager.accruedFees(address(usdc)), fee);

        vm.prank(admin); manager.sweepAllSurplus();
        assertEq(usdc.balanceOf(treasury), hc + fee);
        assertEq(manager.accruedFees(address(usdc)), 0);
        assertEq(manager.accruedHaircut(address(usdc)), 0);
        _assertI01(address(usdc));
    }

    // =========================================================================
    //                          Pause / Unpause
    // =========================================================================

    function testPause_OnlyPauser() public {
        vm.prank(user);
        vm.expectRevert();
        manager.pause();
    }

    function testUnpauseRestoresFlow() public {
        vm.prank(pauser); manager.pause();
        assertTrue(manager.paused());
        vm.prank(pauser); manager.unpause();
        assertFalse(manager.paused());

        // Deposits work again.
        vm.startPrank(user);
        usdc.approve(address(manager), 1e6);
        manager.deposit(address(usdc), 1e6, user);
        vm.stopPrank();
    }

    // =========================================================================
    //                          Invariant assertion helper (I-01)
    // =========================================================================

    function _assertI01(address token) internal view {
        uint256 bal = MockERC20(token).balanceOf(address(manager));
        uint256 sum = manager.parReserve(token)
                    + manager.yieldShareReserve(token)
                    + manager.accruedFees(token)
                    + manager.accruedHaircut(token);
        assertEq(bal, sum, "I-01 broken: balance != sum of slices");
    }
}

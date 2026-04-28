// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../../src/PUSD.sol";
import "../../src/PUSDManager.sol";
import "../../src/PUSDPlus.sol";
import "../../src/PUSDLiquidity.sol";

import "../mocks/MockERC20.sol";
import "../mocks/MockUniV3Pool.sol";
import "../mocks/MockUniV3Factory.sol";
import "../mocks/MockNonfungiblePositionManager.sol";
import "../mocks/MockSwapRouter.sol";

/**
 * @title FourContractFlow
 * @notice End-to-end happy-path test exercising PUSD + PUSDManager + PUSDPlus + PUSDLiquidity in a
 *         realistic multi-pool, multi-asset cross-chain stable scenario:
 *
 *           1. Alice deposits both USDC.eth and USDC.sol into PUSD+ (vault path → yield slice).
 *           2. Bob mints PUSD directly via the plain path (par slice).
 *           3. Admin pushes capital to Liquidity and the rebalancer opens an LP position on the
 *              cross-chain USDC pool.
 *           4. Alice redeems part of her PUSD+ to USDC.eth — pullForWithdraw must serve from idle
 *              + the position; the remainder may walk the multi-hop fallback.
 *           5. Bob redeems his plain PUSD back to USDC.sol — par slice unchanged on the yield side.
 *
 *         The test asserts:
 *           * Slice isolation: Manager.parReserve and yieldShareReserve never cross-pollute.
 *           * Conservation: total USDC tokens out of users == amount they deposited net of fees.
 *           * NAV monotonicity: PUSD+.totalAssets stays >= what alice paid in (no value lost).
 */
contract FourContractFlowTest is Test {
    PUSD public pusd;
    PUSDManager public manager;
    PUSDPlus public plus;
    PUSDLiquidity public liq;

    MockERC20 public usdcEth;
    MockERC20 public usdcSol;

    MockUniV3Factory public factory;
    MockNonfungiblePositionManager public npm;
    MockSwapRouter public router;
    MockUniV3Pool public poolUSDCxC; // USDC.eth ↔ USDC.sol

    address public admin    = address(0xA11CE);
    address public reb      = address(0xBEE);
    address public treasury = address(0xCAFE);
    address public feeRcpt  = address(0xFEED);
    address public alice    = address(0x1111);
    address public bob      = address(0x2222);

    bytes32 internal constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 internal constant BURNER_ROLE = keccak256("BURNER_ROLE");

    function setUp() public {
        usdcEth = new MockERC20("USDC.eth", "USDC", 6);
        usdcSol = new MockERC20("USDC.sol", "USDC", 6);

        // Core stack
        pusd = PUSD(address(new ERC1967Proxy(
            address(new PUSD()),
            abi.encodeWithSelector(PUSD.initialize.selector, admin)
        )));

        manager = PUSDManager(address(new ERC1967Proxy(
            address(new PUSDManager()),
            abi.encodeWithSelector(PUSDManager.initialize.selector, address(pusd), admin)
        )));

        plus = PUSDPlus(address(new ERC1967Proxy(
            address(new PUSDPlus()),
            abi.encodeWithSelector(PUSDPlus.initialize.selector, address(pusd), address(manager), admin, feeRcpt)
        )));

        // UniV3 mocks
        factory = new MockUniV3Factory();
        npm     = new MockNonfungiblePositionManager();
        router  = new MockSwapRouter();
        poolUSDCxC = MockUniV3Pool(factory.createPool(address(usdcEth), address(usdcSol), 100));

        liq = PUSDLiquidity(address(new ERC1967Proxy(
            address(new PUSDLiquidity()),
            abi.encodeWithSelector(
                PUSDLiquidity.initialize.selector,
                admin, address(manager), address(npm), address(router), address(factory)
            )
        )));

        vm.startPrank(admin);
        pusd.grantRole(pusd.MINTER_ROLE(), address(manager));
        pusd.grantRole(pusd.BURNER_ROLE(), address(manager));
        manager.setPUSDPlus(address(plus));
        manager.setPUSDLiquidity(address(liq));
        manager.setTreasuryReserve(treasury);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcSol), "USDC.sol", "Solana_Devnet", 6);
        plus.setPUSDLiquidity(address(liq));
        liq.setPUSDPlus(address(plus));
        liq.addPool(address(poolUSDCxC));
        liq.grantRole(liq.REBALANCER_ROLE(), reb);
        // Headroom for fixtures that push >30% of plus assets to Liquidity in a single shot.
        liq.setMaxDeployableBps(5000);
        vm.stopPrank();

        // Pre-fund router with both legs so any swap fallback clears.
        usdcEth.mint(address(router), 1_000_000 * 1e6);
        usdcSol.mint(address(router), 1_000_000 * 1e6);

        usdcEth.mint(alice, 100_000 * 1e6);
        usdcSol.mint(alice, 100_000 * 1e6);
        usdcSol.mint(bob,   100_000 * 1e6);
    }

    function testFullLifecycle_DepositDeployUnwindRedeem() public {
        // -------- 1. alice deposits 20k USDC.eth + 10k USDC.sol into PUSD+ --------
        uint256 aDepEth = 20_000 * 1e6;
        uint256 aDepSol = 10_000 * 1e6;
        vm.startPrank(alice);
        usdcEth.approve(address(plus), aDepEth);
        usdcSol.approve(address(plus), aDepSol);
        uint256 sharesA1 = plus.depositStable(address(usdcEth), aDepEth, alice);
        uint256 sharesA2 = plus.depositStable(address(usdcSol), aDepSol, alice);
        vm.stopPrank();
        assertGt(sharesA1, 0);
        assertGt(sharesA2, 0);

        // After alice: yieldShareReserve has both.
        assertEq(manager.yieldShareReserve(address(usdcEth)), aDepEth);
        assertEq(manager.yieldShareReserve(address(usdcSol)), aDepSol);
        assertEq(manager.parReserve(address(usdcEth)), 0);
        assertEq(manager.parReserve(address(usdcSol)), 0);

        // -------- 2. bob mints plain PUSD with 5k USDC.sol --------
        uint256 bDepSol = 5_000 * 1e6;
        vm.startPrank(bob);
        usdcSol.approve(address(manager), bDepSol);
        manager.deposit(address(usdcSol), bDepSol, bob);
        vm.stopPrank();
        uint256 pusdMintedBob = pusd.balanceOf(bob);
        assertGt(pusdMintedBob, 0);

        // After bob: parReserve gets a bump on USDC.sol; yieldShareReserve unchanged.
        assertEq(manager.parReserve(address(usdcSol)), bDepSol);
        assertEq(manager.yieldShareReserve(address(usdcSol)), aDepSol); // unchanged from alice

        // -------- 3. admin pushes 7k of each USDC into Liquidity (= 14k / 30k = 47%, inside the
        //          50% deploy cap). --------
        vm.startPrank(admin);
        manager.transferYieldToLiquidity(address(usdcEth), 7_000 * 1e6);
        manager.transferYieldToLiquidity(address(usdcSol), 7_000 * 1e6);
        vm.stopPrank();

        assertEq(usdcEth.balanceOf(address(liq)), 7_000 * 1e6);
        assertEq(usdcSol.balanceOf(address(liq)), 7_000 * 1e6);
        assertEq(manager.yieldShareReserve(address(usdcEth)), aDepEth - 7_000 * 1e6);

        // -------- 4. rebalancer opens position --------
        vm.prank(reb);
        uint256 tokenId = liq.mintPosition(
            address(poolUSDCxC), -100, 100, 5_000 * 1e6, 5_000 * 1e6, 0, 0, block.timestamp
        );
        assertEq(liq.positionCount(), 1);
        assertGt(tokenId, 0);

        // Idle after position: 2k each (7k - 5k).
        assertEq(usdcEth.balanceOf(address(liq)), 2_000 * 1e6);
        assertEq(usdcSol.balanceOf(address(liq)), 2_000 * 1e6);

        // -------- 5. alice redeems half her shares back to USDC.eth --------
        uint256 totalShares = plus.balanceOf(alice);
        uint256 halfShares  = totalShares / 2;
        uint256 startEth    = usdcEth.balanceOf(alice);

        vm.prank(alice);
        uint256 ethOut = plus.redeemToStable(halfShares, address(usdcEth), alice);
        assertGt(ethOut, 0);
        assertEq(usdcEth.balanceOf(alice), startEth + ethOut);

        // -------- 6. bob redeems plain PUSD to USDC.sol --------
        uint256 startSol = usdcSol.balanceOf(bob);
        vm.prank(bob);
        manager.redeem(pusdMintedBob, address(usdcSol), false, bob);
        uint256 solOut = usdcSol.balanceOf(bob) - startSol;
        assertGt(solOut, 0);

        // -------- Invariants --------

        // a) Slice isolation: par reserve never crossed into yield (bob's deposit was par).
        //    After bob's redeem, parReserve[USDC.sol] should be ~0 (modulo fees swept on redeem).
        assertLe(manager.parReserve(address(usdcSol)), bDepSol); // never grew beyond what bob put in
        // Yield slice for USDC.sol may have shrunk via alice's redeem, never via bob's.
        assertLe(manager.yieldShareReserve(address(usdcSol)), aDepSol);

        // b) Conservation: bob's gross USDC.sol round-trip loses no more than the combined fee
        //    floor (haircut + base/preferred fee). 1% slack is generous for the launch tariff.
        assertGe(solOut * 100, bDepSol * 99);

        // c) PUSD totalSupply integrity: equals (alice's remaining shares-equivalent + bob's 0).
        //    More importantly: every user-held PUSD is backed.
        uint256 totalPusd = pusd.totalSupply();
        // PUSD held by alice (none — she deposited via vault path which forwards PUSD into plus and burns on redeem)
        assertEq(pusd.balanceOf(alice), 0);
        assertEq(pusd.balanceOf(bob),   0); // fully redeemed
        // The remaining supply lives in PUSDPlus (one large lump backing alice's remaining shares).
        assertEq(pusd.balanceOf(address(plus)), totalPusd);
    }

    /// @notice Regression test for the previously-broken NAV accounting.
    ///         When admin calls `transferYieldToLiquidity`, the tokens move from
    ///         `Manager.yieldShareReserve` into `Liquidity` idle inventory — they remain collateral
    ///         for the SAME PUSD that plus already holds. The fix tracks `deployedPrincipalInPUSD`
    ///         in Liquidity and subtracts it inside `netAssetsInPUSD`, so `PUSDPlus.totalAssets`
    ///         (= `plus.PUSD` + `Liquidity.netAssetsInPUSD`) stays flat across the re-parking.
    ///
    ///         Before the fix: `totalAssets` would jump by the pushed amount, crystallising phantom
    ///         performance fees against the HWM at the very next interaction.
    function testNAV_PushedReserveIsNotDoubleCounted() public {
        vm.startPrank(alice);
        usdcEth.approve(address(plus), 10_000 * 1e6);
        plus.depositStable(address(usdcEth), 10_000 * 1e6, alice);
        vm.stopPrank();

        uint256 navBefore = plus.totalAssets();
        assertEq(navBefore, 10_000 * 1e6, "NAV should match deposit pre-push");

        // Admin moves 4k from Manager.yieldShareReserve → Liquidity idle (40%, inside 50% cap).
        vm.prank(admin);
        manager.transferYieldToLiquidity(address(usdcEth), 4_000 * 1e6);

        // Liquidity holds 4k as principal, so netAssetsInPUSD is 0 and totalAssets is flat.
        assertEq(liq.deployedPrincipalInPUSD(), 4_000 * 1e6);
        assertEq(liq.grossValueInPUSD(),        4_000 * 1e6);
        assertEq(liq.netAssetsInPUSD(),         0);
        assertEq(plus.totalAssets(), navBefore, "NAV must not change from admin re-parking of collateral");

        // Now simulate an actual LP fee landing in Liquidity (e.g. collected swap fees) and verify
        // it flows through as real yield exactly once.
        usdcEth.mint(address(liq), 50 * 1e6);
        assertEq(liq.netAssetsInPUSD(), 50 * 1e6,         "fee shows up in NAV exactly once");
        assertEq(plus.totalAssets(), navBefore + 50 * 1e6, "totalAssets reflects actual yield");
    }

    function testRedeem_FallbackThroughLiquidity() public {
        // alice deposits both stables, admin pushes inside the cap, rebalancer opens a position
        // → alice redeems half of her shares to USDC.eth, forcing the pull path to walk through
        // Manager idle + Liquidity unwind.
        vm.startPrank(alice);
        usdcEth.approve(address(plus), 10_000 * 1e6);
        plus.depositStable(address(usdcEth), 10_000 * 1e6, alice);
        vm.stopPrank();

        // After alice's first deposit: plus.totalAssets = 10k, cap = 50% * 10k = 5k.
        vm.prank(admin);
        manager.transferYieldToLiquidity(address(usdcEth), 4_000 * 1e6);

        usdcSol.mint(alice, 10_000 * 1e6);
        vm.startPrank(alice);
        usdcSol.approve(address(plus), 10_000 * 1e6);
        plus.depositStable(address(usdcSol), 10_000 * 1e6, alice);
        vm.stopPrank();
        // After second deposit: plus.totalAssets = 20k, cap = 10k. Already deployed 4k usdcEth.
        vm.prank(admin);
        manager.transferYieldToLiquidity(address(usdcSol), 4_000 * 1e6);

        // Open a position consuming all idle USDC.eth so the pull path must unwind.
        vm.prank(reb);
        liq.mintPosition(address(poolUSDCxC), -100, 100, 4_000 * 1e6, 4_000 * 1e6, 0, 0, block.timestamp);
        assertEq(usdcEth.balanceOf(address(liq)), 0);

        uint256 startEth   = usdcEth.balanceOf(alice);
        uint256 aliceShares = plus.balanceOf(alice);
        vm.prank(alice);
        uint256 out = plus.redeemToStable(aliceShares / 2, address(usdcEth), alice);
        assertGt(out, 0);
        assertEq(usdcEth.balanceOf(alice), startEth + out);
    }
}

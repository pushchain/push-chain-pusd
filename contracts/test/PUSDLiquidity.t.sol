// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../src/PUSD.sol";
import "../src/PUSDManager.sol";
import "../src/PUSDPlus.sol";
import "../src/PUSDLiquidity.sol";

import "./mocks/MockERC20.sol";
import "./mocks/MockUniV3Pool.sol";
import "./mocks/MockUniV3Factory.sol";
import "./mocks/MockNonfungiblePositionManager.sol";
import "./mocks/MockSwapRouter.sol";

import "../src/libs/TickMath.sol";
import "../src/libs/LiquidityAmounts.sol";

/// @notice PUSDLiquidity v2.1 — multi-pool, multi-asset stable LP engine, including the
///         multi-hop swap fallback in `pullForWithdraw`.
contract PUSDLiquidityTest is Test {
    PUSD public pusd;
    PUSDManager public manager;
    PUSDPlus public plus;
    PUSDLiquidity public liq;

    // 4 cross-chain stable mocks: USDC.eth, USDC.sol, USDT.eth, USDT.sol — enough for multi-hop.
    MockERC20 public usdcEth;
    MockERC20 public usdcSol;
    MockERC20 public usdtEth;
    MockERC20 public usdtSol;

    MockUniV3Factory public factory;
    MockNonfungiblePositionManager public npm;
    MockSwapRouter public router;

    // Two launch pools (same-currency cross-chain):
    //   poolUSDCxC: USDC.eth ↔ USDC.sol
    //   poolUSDTxC: USDT.eth ↔ USDT.sol
    MockUniV3Pool public poolUSDCxC;
    MockUniV3Pool public poolUSDTxC;
    // A third pool (USDC.eth ↔ USDT.eth) bridges between the two for multi-hop tests.
    MockUniV3Pool public poolEthCC;

    address public admin = address(0xA11CE);
    address public reb   = address(0xBEE);
    address public alice = address(0x1111);

    bytes32 internal constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 internal constant BURNER_ROLE = keccak256("BURNER_ROLE");

    function setUp() public {
        usdcEth = new MockERC20("USDC.eth", "USDC", 6);
        usdcSol = new MockERC20("USDC.sol", "USDC", 6);
        usdtEth = new MockERC20("USDT.eth", "USDT", 6);
        usdtSol = new MockERC20("USDT.sol", "USDT", 6);

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
            abi.encodeWithSelector(PUSDPlus.initialize.selector, address(pusd), address(manager), admin, admin)
        )));

        // UniV3 mocks
        factory = new MockUniV3Factory();
        npm     = new MockNonfungiblePositionManager();
        router  = new MockSwapRouter();
        poolUSDCxC = MockUniV3Pool(factory.createPool(address(usdcEth), address(usdcSol), 100));
        poolUSDTxC = MockUniV3Pool(factory.createPool(address(usdtEth), address(usdtSol), 100));
        poolEthCC  = MockUniV3Pool(factory.createPool(address(usdcEth), address(usdtEth), 100));

        // PUSDLiquidity (v2.1 — no usdc/usdt args)
        liq = PUSDLiquidity(address(new ERC1967Proxy(
            address(new PUSDLiquidity()),
            abi.encodeWithSelector(
                PUSDLiquidity.initialize.selector,
                admin, address(manager), address(npm), address(router), address(factory)
            )
        )));

        // Wire roles + dependencies.
        vm.startPrank(admin);
        pusd.grantRole(MINTER_ROLE, address(manager));
        pusd.grantRole(BURNER_ROLE, address(manager));
        manager.setPUSDPlus(address(plus));
        manager.setPUSDLiquidity(address(liq));
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcSol), "USDC.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdtSol), "USDT.sol", "Solana_Devnet", 6);

        plus.setPUSDLiquidity(address(liq));

        liq.setPUSDPlus(address(plus));
        liq.addPool(address(poolUSDCxC));
        liq.addPool(address(poolUSDTxC));
        liq.addPool(address(poolEthCC));
        liq.grantRole(liq.REBALANCER_ROLE(), reb);
        // Bump deployment cap to the hard ceiling so `_seedDeployableInventory` (40% of plus
        // assets) stays inside the cap; the launch default is 30% but tests need headroom.
        liq.setMaxDeployableBps(5000);
        vm.stopPrank();

        // Pre-fund the swap router with all four legs so multi-hop swaps clear at the mock.
        usdcEth.mint(address(router), 1_000_000 * 1e6);
        usdcSol.mint(address(router), 1_000_000 * 1e6);
        usdtEth.mint(address(router), 1_000_000 * 1e6);
        usdtSol.mint(address(router), 1_000_000 * 1e6);

        // Fund alice
        usdcEth.mint(alice, 100_000 * 1e6);
        usdcSol.mint(alice, 100_000 * 1e6);
        usdtEth.mint(alice, 100_000 * 1e6);
        usdtSol.mint(alice, 100_000 * 1e6);
    }

    // -------------------------------------------------------------------------
    //                              Initialisation
    // -------------------------------------------------------------------------

    function testInitialState() public view {
        assertEq(address(liq.npm()), address(npm));
        assertEq(address(liq.router()), address(router));
        // setUp bumps to the hard cap to give the seed fixture headroom.
        assertEq(liq.maxDeployableBps(), 5000);
        assertEq(liq.emergencyLiquidityBps(), 3000);
        assertEq(liq.lpSwapSlippageBps(), 50);
        assertEq(liq.pusdPlus(), address(plus));
        assertEq(liq.poolsLength(), 3);
        assertTrue(liq.isPoolActive(address(poolUSDCxC)));
        assertTrue(liq.isPoolActive(address(poolUSDTxC)));
        assertTrue(liq.isPoolActive(address(poolEthCC)));
        assertTrue(liq.hasRole(liq.REBALANCER_ROLE(), reb));
        assertTrue(liq.hasRole(liq.VAULT_ROLE(), address(plus)));
        assertTrue(liq.hasRole(liq.VAULT_ROLE(), address(manager)));
    }

    // -------------------------------------------------------------------------
    //                              Pool registry
    // -------------------------------------------------------------------------

    function testAddPool_RejectsNonStablePair() public {
        // DAI is NOT registered as a Manager-supported stable.
        MockERC20 dai = new MockERC20("DAI", "DAI", 18);
        address bad = factory.createPool(address(usdcEth), address(dai), 100);
        vm.prank(admin);
        vm.expectRevert(); // "PUSDLiquidity: token1 not stable" (or token0, depending on ordering)
        liq.addPool(bad);
    }

    function testAddPool_RejectsDuplicate() public {
        vm.prank(admin);
        vm.expectRevert(PUSDLiquidity.PoolAlreadyRegistered.selector);
        liq.addPool(address(poolUSDCxC));
    }

    function testAddPool_RejectsForeignFactory() public {
        // Build a rogue pool that isn't in the factory's registry.
        MockUniV3Pool rogue = new MockUniV3Pool(address(usdcEth), address(usdcSol), 100);
        vm.prank(admin);
        vm.expectRevert(bytes("PUSDLiquidity: pool not from factory"));
        liq.addPool(address(rogue));
    }

    function testDeactivatePool_BlocksNewPositions() public {
        vm.prank(admin);
        liq.deactivatePool(address(poolUSDCxC));

        _seedDeployableInventory();
        vm.prank(reb);
        vm.expectRevert(PUSDLiquidity.PoolNotActive.selector);
        liq.mintPosition(address(poolUSDCxC), -100, 100, 1_000 * 1e6, 1_000 * 1e6, 0, 0, block.timestamp);
    }

    function testActivatePool_RestoresMint() public {
        vm.prank(admin); liq.deactivatePool(address(poolUSDCxC));
        vm.prank(admin); liq.activatePool(address(poolUSDCxC));
        _seedDeployableInventory();
        vm.prank(reb);
        liq.mintPosition(address(poolUSDCxC), -100, 100, 1_000 * 1e6, 1_000 * 1e6, 0, 0, block.timestamp);
        assertEq(liq.positionCount(), 1);
    }

    function testRemovePool_RejectsWhenPositionsExist() public {
        _seedDeployableInventory();
        _mintPositionOn(address(poolUSDCxC), 1_000 * 1e6, 1_000 * 1e6);
        vm.prank(admin);
        vm.expectRevert(PUSDLiquidity.PoolHasActivePositions.selector);
        liq.removePool(address(poolUSDCxC));
    }

    function testRemovePool_HappyPath() public {
        // No positions on poolEthCC; remove it.
        vm.prank(admin);
        liq.removePool(address(poolEthCC));
        assertEq(liq.poolsLength(), 2);
        assertFalse(liq.isPoolActive(address(poolEthCC)));
    }

    // -------------------------------------------------------------------------
    //                              Admin caps
    // -------------------------------------------------------------------------

    function testSetMaxDeployable_RespectsHardCap() public {
        vm.prank(admin);
        vm.expectRevert(bytes("PUSDLiquidity: > HARD_CAP_BPS"));
        liq.setMaxDeployableBps(5001);

        vm.prank(admin); liq.setMaxDeployableBps(5000);
        assertEq(liq.maxDeployableBps(), 5000);
    }

    function testSetSlippage_RespectsCeiling() public {
        vm.prank(admin);
        vm.expectRevert(bytes("PUSDLiquidity: slippage > 1%"));
        liq.setLpSwapSlippageBps(101);

        vm.prank(admin); liq.setLpSwapSlippageBps(100);
        assertEq(liq.lpSwapSlippageBps(), 100);
    }

    function testRecoverDust_CannotDrainSupportedReserve() public {
        vm.prank(admin);
        vm.expectRevert(bytes("PUSDLiquidity: cannot drain reserve"));
        liq.recoverDust(address(usdcEth), admin, 1);
    }

    function testRecoverDust_AllowsUnsupportedToken() public {
        MockERC20 dust = new MockERC20("DUST", "DUST", 18);
        dust.mint(address(liq), 100 ether);
        vm.prank(admin);
        liq.recoverDust(address(dust), admin, 100 ether);
        assertEq(dust.balanceOf(admin), 100 ether);
    }

    // -------------------------------------------------------------------------
    //                              Position lifecycle
    // -------------------------------------------------------------------------

    /// @dev PUSD+ deposits + Manager.transferYieldToLiquidity to seed Liquidity with idle.
    function _seedDeployableInventory() internal {
        // Alice deposits a chunk of every reserve token into PUSD+.
        vm.startPrank(alice);
        usdcEth.approve(address(plus), 30_000 * 1e6); plus.depositStable(address(usdcEth), 30_000 * 1e6, alice);
        usdcSol.approve(address(plus), 30_000 * 1e6); plus.depositStable(address(usdcSol), 30_000 * 1e6, alice);
        usdtEth.approve(address(plus), 30_000 * 1e6); plus.depositStable(address(usdtEth), 30_000 * 1e6, alice);
        usdtSol.approve(address(plus), 30_000 * 1e6); plus.depositStable(address(usdtSol), 30_000 * 1e6, alice);
        vm.stopPrank();

        // Admin pushes 12k of every token into Liquidity (40% of yield slice on each).
        vm.startPrank(admin);
        manager.transferYieldToLiquidity(address(usdcEth), 12_000 * 1e6);
        manager.transferYieldToLiquidity(address(usdcSol), 12_000 * 1e6);
        manager.transferYieldToLiquidity(address(usdtEth), 12_000 * 1e6);
        manager.transferYieldToLiquidity(address(usdtSol), 12_000 * 1e6);
        vm.stopPrank();
    }

    function _mintPositionOn(address pool, uint256 amt0, uint256 amt1) internal returns (uint256 tokenId) {
        // The mintPosition signature requires amounts in pool's token0/token1 ordering. The
        // stable-stable mocks all start at 6 dec & the same value, so the exact ordering doesn't
        // matter for the test outcome — but we still respect the invariant for correctness.
        vm.prank(reb);
        tokenId = liq.mintPosition(pool, -100, 100, amt0, amt1, 0, 0, block.timestamp);
    }

    function testMintPosition_HappyPath() public {
        _seedDeployableInventory();
        uint256 tokenId = _mintPositionOn(address(poolUSDCxC), 5_000 * 1e6, 5_000 * 1e6);
        assertEq(liq.positionCount(), 1);

        (uint256 stored, address pool, , , bool active) = liq.positions(0);
        assertEq(stored, tokenId);
        assertEq(pool, address(poolUSDCxC));
        assertTrue(active);
    }

    function testMintPosition_OnlyRebalancer() public {
        _seedDeployableInventory();
        vm.prank(alice);
        vm.expectRevert();
        liq.mintPosition(address(poolUSDCxC), -100, 100, 1, 1, 0, 0, block.timestamp);
    }

    function testMintPosition_RejectsBadTickRange() public {
        _seedDeployableInventory();
        vm.prank(reb);
        vm.expectRevert(PUSDLiquidity.InvalidTickRange.selector);
        liq.mintPosition(address(poolUSDCxC), 100, -100, 1, 1, 0, 0, block.timestamp);
    }

    function testMintPosition_PausedReverts() public {
        _seedDeployableInventory();
        vm.prank(admin); liq.pause();
        vm.prank(reb);
        vm.expectRevert();
        liq.mintPosition(address(poolUSDCxC), -100, 100, 1, 1, 0, 0, block.timestamp);
    }

    function testMintPosition_PositionCap() public {
        _seedDeployableInventory();
        for (uint256 i = 0; i < liq.MAX_POSITIONS(); i++) {
            _mintPositionOn(address(poolUSDCxC), 1 * 1e6, 1 * 1e6);
        }
        vm.prank(reb);
        vm.expectRevert(PUSDLiquidity.PositionCapReached.selector);
        liq.mintPosition(address(poolUSDCxC), -100, 100, 1, 1, 0, 0, block.timestamp);
    }

    function testMintPosition_RejectsUnregisteredPool() public {
        _seedDeployableInventory();
        MockUniV3Pool foreign = MockUniV3Pool(factory.createPool(address(usdcEth), address(usdtSol), 100));
        vm.prank(reb);
        vm.expectRevert(PUSDLiquidity.PoolNotRegistered.selector);
        liq.mintPosition(address(foreign), -100, 100, 1, 1, 0, 0, block.timestamp);
    }

    // -------------------------------------------------------------------------
    //                              pullForWithdraw — basic
    // -------------------------------------------------------------------------

    function testPullForWithdraw_FromIdleOnly() public {
        _seedDeployableInventory();
        // Idle holds 12k of each. Vault asks for 5k USDC.eth.
        vm.prank(address(plus));
        uint256 delivered = liq.pullForWithdraw(address(usdcEth), 5_000 * 1e6, alice);
        assertEq(delivered, 5_000 * 1e6);
        assertEq(usdcEth.balanceOf(address(liq)), 7_000 * 1e6);
    }

    function testPullForWithdraw_OnlyVault() public {
        _seedDeployableInventory();
        vm.prank(alice);
        vm.expectRevert();
        liq.pullForWithdraw(address(usdcEth), 1, alice);
    }

    function testPullForWithdraw_UnwindsPositionWhenIdleShort() public {
        _seedDeployableInventory();
        // Lock 10k of each USDC variant into a position; that drains idle USDC.eth to 2k.
        _mintPositionOn(address(poolUSDCxC), 10_000 * 1e6, 10_000 * 1e6);
        assertEq(usdcEth.balanceOf(address(liq)), 2_000 * 1e6);

        // Vault requests 8k USDC.eth — must be served by idle (2k) + position unwind (6k).
        uint256 startAlice = usdcEth.balanceOf(alice);
        vm.prank(address(plus));
        uint256 delivered = liq.pullForWithdraw(address(usdcEth), 8_000 * 1e6, alice);
        assertEq(delivered, 8_000 * 1e6);
        assertEq(usdcEth.balanceOf(alice) - startAlice, 8_000 * 1e6);
    }

    function testPullForWithdraw_RevertsWhenInsufficient() public {
        _seedDeployableInventory();
        // Lock all USDC.eth + USDC.sol into a position; ask for an absurd amount so even
        // multi-hop fallback through USDT.eth/USDT.sol can't service it (router only has 1M of
        // each, but the request bumps right past available cross-chain inventory).
        _mintPositionOn(address(poolUSDCxC), 12_000 * 1e6, 12_000 * 1e6);
        vm.prank(address(plus));
        vm.expectRevert();
        liq.pullForWithdraw(address(usdcEth), 1_000_000 * 1e6, alice);
    }

    // -------------------------------------------------------------------------
    //                              pullForWithdraw — multi-hop swap
    // -------------------------------------------------------------------------

    function testPullForWithdraw_OneHopSwap() public {
        _seedDeployableInventory();
        // Lock all USDC.eth + USDC.sol idle into a single LP position so the only way to deliver
        // MORE than the position's USDC.eth principal is via the swap fallback.
        _mintPositionOn(address(poolUSDCxC), 12_000 * 1e6, 12_000 * 1e6);
        assertEq(usdcEth.balanceOf(address(liq)), 0);

        // Position has 12k USDC.eth principal. Asking for 13k forces:
        //   step 2 (unwind): recovers 12k USDC.eth (delivered) + 12k USDC.sol (idle leftover).
        //   step 3 (swap):   need 1k more — USDC.sol → USDC.eth via poolUSDCxC, 1-hop direct.
        vm.prank(address(plus));
        uint256 delivered = liq.pullForWithdraw(address(usdcEth), 13_000 * 1e6, alice);
        assertEq(delivered, 13_000 * 1e6);
        assertEq(usdcEth.balanceOf(alice), 100_000 * 1e6 - 30_000 * 1e6 + 13_000 * 1e6);

        // Path must be 1-hop (43 bytes) ending at USDC.eth.
        bytes memory path = router.lastPath();
        assertEq(path.length, 43, "expected 1-hop path encoding");
        address src = _firstToken(path);
        address dst = _lastToken(path);
        assertEq(src, address(usdcSol), "swap source should be USDC.sol");
        assertEq(dst, address(usdcEth), "swap destination should be USDC.eth");
    }

    function testPullForWithdraw_TwoHopSwap() public {
        _seedDeployableInventory();
        // We need a scenario where the request can ONLY be satisfied via a 2-hop route. Strategy:
        //   * Drain Liquidity of USDC.eth, USDT.eth, USDT.sol via positions or admin moves.
        //   * Leave only USDC.sol idle.
        //   * Request USDT.eth → must route USDC.sol → USDC.eth → USDT.eth (poolUSDCxC + poolEthCC).

        // Lock all USDC.eth + USDT.eth + USDT.sol into positions on their respective pools.
        _mintPositionOn(address(poolUSDCxC), 12_000 * 1e6, 12_000 * 1e6); // both USDCs gone
        // After this position, USDC.sol idle is also 0. Mint USDC.sol back into idle by faking a
        // direct mint (the test fixture funds the test contract with USDC.sol, so we transfer).
        usdcSol.mint(address(liq), 5_000 * 1e6);
        // Drain USDT.eth + USDT.sol via the rebalancer mint.
        _mintPositionOn(address(poolUSDTxC), 12_000 * 1e6, 12_000 * 1e6);

        assertEq(usdcEth.balanceOf(address(liq)), 0);
        assertEq(usdtEth.balanceOf(address(liq)), 0);
        assertEq(usdtSol.balanceOf(address(liq)), 0);
        assertEq(usdcSol.balanceOf(address(liq)), 5_000 * 1e6);

        // Ask for 1k USDT.eth. No idle. The USDT.eth/USDT.sol position can serve this directly,
        // but to force the multi-hop path we deactivate that pool first so the position can't be
        // touched? No — pullForWithdraw still unwinds inactive-pool positions. Instead, request
        // an amount LARGER than the position can supply, and remove the USDT.sol idle so the
        // shortfall must come from USDC.sol via 2 hops.
        // Position USDT.eth principal = 12k. Ask for 13k. Position serves 12k → still need 1k.
        // Idle USDT.sol = 0. Idle USDT.eth = 0. Idle USDC.eth = 0. Idle USDC.sol = 5k.
        // Route: USDC.sol → USDC.eth (poolUSDCxC) → USDT.eth (poolEthCC). 2 hops. ✓
        vm.prank(address(plus));
        uint256 delivered = liq.pullForWithdraw(address(usdtEth), 13_000 * 1e6, alice);
        assertEq(delivered, 13_000 * 1e6);

        // Verify the router executed a 2-hop path on the swap leg.
        bytes memory path = router.lastPath();
        // 2-hop encoding = 20 (token) + 3 (fee) + 20 (mid) + 3 (fee) + 20 (token) = 66 bytes.
        assertEq(path.length, 66, "expected 2-hop path encoding");
        address src = _firstToken(path);
        address dst = _lastToken(path);
        assertEq(src, address(usdcSol), "swap source should be USDC.sol");
        assertEq(dst, address(usdtEth), "swap destination should be USDT.eth");
    }

    // ----- shared path-decoding helpers -----

    function _firstToken(bytes memory path) internal pure returns (address out) {
        assembly { out := shr(96, mload(add(path, 32))) }
    }

    function _lastToken(bytes memory path) internal pure returns (address) {
        uint256 len = path.length;
        uint256 word;
        assembly { word := mload(add(path, len)) }
        return address(uint160(word));
    }

    function testPullForWithdraw_NoRouteRevertsWhenIsolated() public {
        // Construct a totally isolated supported token — register it with Manager but don't
        // create any pool that references it. Liquidity must NOT find a route to it.
        MockERC20 isolated = new MockERC20("USDC.iso", "USDC", 6);
        vm.prank(admin);
        manager.addSupportedToken(address(isolated), "USDC.iso", "Isolated", 6);

        _seedDeployableInventory();
        // Drain isolated balance just to be explicit (none to start with).
        vm.prank(address(plus));
        // No idle of `isolated`, no positions, no route — must revert.
        vm.expectRevert();
        liq.pullForWithdraw(address(isolated), 1_000 * 1e6, alice);
    }

    // -------------------------------------------------------------------------
    //                              NAV reporting
    // -------------------------------------------------------------------------

    function testNetAssetsInPUSD_IdleOnly() public {
        _seedDeployableInventory();
        // After seeding, total value (gross) is 12k * 4 = 48k PUSD, but ALL of it is principal
        // pushed by Manager — net yield (NAV) is 0 until LP earns fees or sees price drift.
        assertEq(liq.grossValueInPUSD(), 48_000 * 1e6);
        assertEq(liq.deployedPrincipalInPUSD(), 48_000 * 1e6);
        assertEq(liq.netAssetsInPUSD(), 0, "NAV should be 0 with only principal in Liquidity");
    }

    function testNetAssetsInPUSD_AcrossMultiplePools() public {
        _seedDeployableInventory();
        _mintPositionOn(address(poolUSDCxC), 5_000 * 1e6, 5_000 * 1e6);
        _mintPositionOn(address(poolUSDTxC), 5_000 * 1e6, 5_000 * 1e6);

        // Gross = idle + position implied + uncollected fees (matches the canonical reconstruction).
        assertEq(liq.grossValueInPUSD(), _expectedNAV());

        // Net = gross - principal. With no fees earned and equal-priced stables, the position
        // implied amounts roughly equal the principals consumed, so NAV stays at (or just below)
        // 0 after subtraction. We allow up to 1 wei of rounding tolerance.
        uint256 gross = liq.grossValueInPUSD();
        uint256 principal = liq.deployedPrincipalInPUSD();
        uint256 expectedNet = gross > principal ? gross - principal : 0;
        assertEq(liq.netAssetsInPUSD(), expectedNet);
    }

    function testNetAssetsInPUSD_ReportsActualYield() public {
        _seedDeployableInventory();
        // Simulate fee accrual: directly mint extra tokens to liq's idle balance to simulate a
        // realised LP fee that wasn't pushed by Manager (i.e., it's pure yield).
        usdcEth.mint(address(liq), 100 * 1e6);

        assertEq(liq.grossValueInPUSD(), 48_100 * 1e6);
        assertEq(liq.deployedPrincipalInPUSD(), 48_000 * 1e6);
        assertEq(liq.netAssetsInPUSD(), 100 * 1e6, "NAV should equal realised yield only");
    }

    function testNetAssetsInPUSD_PullDecrementsPrincipal() public {
        _seedDeployableInventory();
        assertEq(liq.deployedPrincipalInPUSD(), 48_000 * 1e6);

        vm.prank(address(plus));
        liq.pullForWithdraw(address(usdcEth), 5_000 * 1e6, alice);

        // Principal drops by the delivered amount (in PUSD units, 1:1 for 6-dec stable).
        assertEq(liq.deployedPrincipalInPUSD(), 43_000 * 1e6);
        assertEq(liq.grossValueInPUSD(),       43_000 * 1e6);
        assertEq(liq.netAssetsInPUSD(), 0);
    }

    function _expectedNAV() internal view returns (uint256 nav) {
        nav += usdcEth.balanceOf(address(liq));
        nav += usdcSol.balanceOf(address(liq));
        nav += usdtEth.balanceOf(address(liq));
        nav += usdtSol.balanceOf(address(liq));

        uint256 plen = liq.positionCount();
        for (uint256 i = 0; i < plen; i++) {
            (uint256 tokenId, address pool, int24 tl, int24 tu, bool active) = liq.positions(i);
            if (!active) continue;
            (uint160 sqrtP, , , , , , ) = MockUniV3Pool(pool).slot0();
            (, , , , , , , uint128 L, , , uint128 owed0, uint128 owed1) = npm.positions(tokenId);
            (uint256 a0, uint256 a1) = LiquidityAmounts.getAmountsForLiquidity(
                sqrtP,
                TickMath.getSqrtRatioAtTick(tl),
                TickMath.getSqrtRatioAtTick(tu),
                L
            );
            nav += a0 + a1 + uint256(owed0) + uint256(owed1);
        }
    }

    // -------------------------------------------------------------------------
    //                              Pause behaviour
    // -------------------------------------------------------------------------

    function testPause_BlocksNewDeployment() public {
        _seedDeployableInventory();
        vm.prank(admin); liq.pause();
        vm.prank(reb);
        vm.expectRevert();
        liq.mintPosition(address(poolUSDCxC), -100, 100, 1, 1, 0, 0, block.timestamp);
    }

    function testPause_DoesNotBlockUnwind() public {
        _seedDeployableInventory();
        _mintPositionOn(address(poolUSDCxC), 5_000 * 1e6, 5_000 * 1e6);
        vm.prank(admin); liq.pause();

        vm.prank(address(plus));
        uint256 delivered = liq.pullForWithdraw(address(usdcEth), 1_000 * 1e6, alice);
        assertEq(delivered, 1_000 * 1e6);
    }
}

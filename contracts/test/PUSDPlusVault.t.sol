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

// =============================================================================
// Mocks
// =============================================================================

contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _decimals = d;
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Mock V3 pool — slot0 returns sqrtPriceX96 = 2^96 (price = 1.0).
contract MockUniV3Pool {
    function slot0() external pure returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (uint160(79228162514264337593543950336), int24(0), 0, 0, 0, 0, true);
    }
}

/// @dev Mock V3 factory — keys pools by (sortedPair, fee).
contract MockUniV3Factory {
    mapping(bytes32 => address) public pools;

    function setPool(address t0, address t1, uint24 fee, address pool) external {
        if (t0 > t1) (t0, t1) = (t1, t0);
        pools[keccak256(abi.encode(t0, t1, fee))] = pool;
    }

    function getPool(address t0, address t1, uint24 fee) external view returns (address) {
        if (t0 > t1) (t0, t1) = (t1, t0);
        return pools[keccak256(abi.encode(t0, t1, fee))];
    }
}

/// @dev Mock NPM — accounts the position via tokensOwed only (returns
///      `liquidity = 0` from `positions()`), so the vault's NAV math skips
///      the V3 LiquidityAmounts path. Real V3 liquidity ≠ amount0+amount1;
///      mocking it would require real tick math. Reporting underlyings via
///      tokensOwed gives the same value at price=1 in tight ranges.
contract MockNPM {
    struct PosData {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 totalAmount0; // raw underlying (excluding fees)
        uint128 totalAmount1;
        uint128 fees0; // accrued fees, on top of underlying
        uint128 fees1;
    }

    mapping(uint256 => PosData) public posData;
    uint256 public nextId = 1;
    address public factoryAddr;

    function setFactory(address f) external {
        factoryAddr = f;
    }

    function factory() external view returns (address) {
        return factoryAddr;
    }

    function mint(INonfungiblePositionManager.MintParams calldata p)
        external
        returns (uint256 tokenId, uint128 liquidity, uint256 a0, uint256 a1)
    {
        if (p.amount0Desired > 0) {
            ERC20(p.token0).transferFrom(msg.sender, address(this), p.amount0Desired);
        }
        if (p.amount1Desired > 0) {
            ERC20(p.token1).transferFrom(msg.sender, address(this), p.amount1Desired);
        }

        tokenId = nextId++;
        posData[tokenId] = PosData({
            token0: p.token0,
            token1: p.token1,
            fee: p.fee,
            tickLower: p.tickLower,
            tickUpper: p.tickUpper,
            totalAmount0: uint128(p.amount0Desired),
            totalAmount1: uint128(p.amount1Desired),
            fees0: 0,
            fees1: 0
        });
        // Return liquidity == amount0+amount1 for the openPool event only.
        liquidity = uint128(p.amount0Desired + p.amount1Desired);
        return (tokenId, liquidity, p.amount0Desired, p.amount1Desired);
    }

    function increaseLiquidity(INonfungiblePositionManager.IncreaseLiquidityParams calldata p)
        external
        returns (uint128 liquidity, uint256, uint256)
    {
        PosData storage pd = posData[p.tokenId];
        if (p.amount0Desired > 0) ERC20(pd.token0).transferFrom(msg.sender, address(this), p.amount0Desired);
        if (p.amount1Desired > 0) ERC20(pd.token1).transferFrom(msg.sender, address(this), p.amount1Desired);
        pd.totalAmount0 += uint128(p.amount0Desired);
        pd.totalAmount1 += uint128(p.amount1Desired);
        liquidity = uint128(p.amount0Desired + p.amount1Desired);
        return (liquidity, p.amount0Desired, p.amount1Desired);
    }

    /// @dev Treats `liquidity` argument as PUSD-equivalent (amount0+amount1) to
    ///      withdraw, splitting it 50/50. Sufficient for tests.
    function decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams calldata p)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        PosData storage pd = posData[p.tokenId];
        uint256 share0 = uint256(p.liquidity) / 2;
        uint256 share1 = uint256(p.liquidity) - share0;
        if (share0 > pd.totalAmount0) share0 = pd.totalAmount0;
        if (share1 > pd.totalAmount1) share1 = pd.totalAmount1;
        pd.totalAmount0 -= uint128(share0);
        pd.totalAmount1 -= uint128(share1);
        // Move into "owed" so the next collect sweeps them.
        pd.fees0 += uint128(share0);
        pd.fees1 += uint128(share1);
        return (share0, share1);
    }

    /// @dev In real V3, `collect` only sweeps `tokensOwed` (which holds fees,
    ///      and post-`decreaseLiquidity`, the freed underlying). Our mock
    ///      reports both via `tokensOwed` already. To keep `rebalance` (which
    ///      calls `collect` repeatedly without `decreaseLiquidity`) from
    ///      draining underlying, we only sweep `fees0/fees1` here.
    function collect(INonfungiblePositionManager.CollectParams calldata p)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        PosData storage pd = posData[p.tokenId];
        amount0 = pd.fees0;
        amount1 = pd.fees1;
        pd.fees0 = 0;
        pd.fees1 = 0;
        if (amount0 > 0) ERC20(pd.token0).transfer(p.recipient, amount0);
        if (amount1 > 0) ERC20(pd.token1).transfer(p.recipient, amount1);
        return (amount0, amount1);
    }

    function burn(uint256 tokenId) external {
        delete posData[tokenId];
    }

    /// @dev Test helper — drains the position underlying back to the vault.
    ///      Real V3 routes this through `decreaseLiquidity → collect`; our
    ///      mock returns `liquidity = 0` from `positions()` (so the vault's
    ///      `closePool` skips `decreaseLiquidity`), so we expose this helper
    ///      directly. The vault's NAV math sees the position value drop to
    ///      zero immediately after, matching real-V3 closure semantics.
    function unwindAll(uint256 tokenId, address recipient) external {
        PosData storage pd = posData[tokenId];
        uint256 a0 = pd.totalAmount0;
        uint256 a1 = pd.totalAmount1;
        pd.totalAmount0 = 0;
        pd.totalAmount1 = 0;
        if (a0 > 0) ERC20(pd.token0).transfer(recipient, a0);
        if (a1 > 0) ERC20(pd.token1).transfer(recipient, a1);
    }

    /// @dev Test helper — accrue fees on a position. Caller must have first
    ///      transferred the matching reserves into this contract (mock simulates
    ///      how a real V3 pool would have already received those tokens from swaps).
    function accrueFees(uint256 tokenId, uint128 a0, uint128 a1) external {
        PosData storage pd = posData[tokenId];
        pd.fees0 += a0;
        pd.fees1 += a1;
    }

    /// @dev Returns `liquidity = 0` so the vault's NAV math goes straight to
    ///      `tokensOwed0+tokensOwed1`. We expose the position underlying via
    ///      `tokensOwed*` (real V3 separates underlying from fees, but for the
    ///      vault's sum-at-$1 valuation that distinction doesn't matter).
    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96,
            address,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256,
            uint256,
            uint128 owed0,
            uint128 owed1
        )
    {
        PosData storage pd = posData[tokenId];
        return (
            0,
            address(0),
            pd.token0,
            pd.token1,
            pd.fee,
            pd.tickLower,
            pd.tickUpper,
            0, // liquidity = 0 — bypass V3Math
            0,
            0,
            pd.totalAmount0 + pd.fees0, // underlying + uncollected fees
            pd.totalAmount1 + pd.fees1
        );
    }
}

// =============================================================================
// Test
// =============================================================================

contract PUSDPlusVaultTest is Test {
    PUSD public pusd;
    PUSDManager public manager;
    PUSDPlusVault public vault;
    InsuranceFund public ifund;

    MockERC20 public usdc;
    MockERC20 public usdt;
    MockNPM public npm;
    MockUniV3Pool public pool;
    MockUniV3Factory public factory;

    address public admin = address(0xA1);
    address public keeper = address(0xA2);
    address public poolAdmin = address(0xA3);
    address public vaultAdmin = address(0xA4);
    address public guardian = address(0xA5);
    address public alice = address(0xB1);
    address public bob = address(0xB2);

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
        vm.stopPrank();

        // ---- Reserve tokens ----
        usdc = new MockERC20("USDC.eth", "USDC.eth", 6);
        usdt = new MockERC20("USDT.eth", "USDT.eth", 6);

        vm.startPrank(admin);
        manager.addSupportedToken(address(usdc), "USDC.eth", "eth", 6);
        manager.addSupportedToken(address(usdt), "USDT.eth", "eth", 6);
        vm.stopPrank();

        // ---- V3 mocks ----
        factory = new MockUniV3Factory();
        npm = new MockNPM();
        pool = new MockUniV3Pool();
        npm.setFactory(address(factory));
        factory.setPool(address(usdc), address(usdt), 500, address(pool));

        // ---- Vault ----
        PUSDPlusVault vImpl = new PUSDPlusVault();
        ERC1967Proxy vProxy = new ERC1967Proxy(
            address(vImpl),
            abi.encodeCall(
                PUSDPlusVault.initialize, (admin, address(pusd), address(manager), address(npm), address(factory))
            )
        );
        vault = PUSDPlusVault(address(vProxy));

        // ---- Insurance fund ----
        InsuranceFund iImpl = new InsuranceFund();
        ERC1967Proxy iProxy =
            new ERC1967Proxy(address(iImpl), abi.encodeCall(InsuranceFund.initialize, (admin, vaultAdmin, guardian)));
        ifund = InsuranceFund(address(iProxy));
        vm.prank(admin);
        ifund.setVault(address(vault));

        // ---- Atomic config (mirrors §12 step 3) ----
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
        vault.addBasketToken(address(usdc));
        vault.addBasketToken(address(usdt));
        vm.stopPrank();

        // Wire vault into PUSDManager
        vm.startPrank(admin);
        manager.setPlusVault(address(vault));
        manager.setFeeExempt(address(vault), true);
        vm.stopPrank();

        // ---- Fund users ----
        usdc.mint(alice, ONE_M);
        usdt.mint(alice, ONE_M);
        usdc.mint(bob, ONE_M);
        usdt.mint(bob, ONE_M);
    }

    // -----------------------------------------------------------------
    // Wiring + roles
    // -----------------------------------------------------------------

    function testInitialization() public {
        assertEq(vault.name(), "PUSD Plus");
        assertEq(vault.symbol(), "PUSD+");
        assertEq(vault.decimals(), 6);
        assertEq(vault.haircutBps(), 200);
        assertEq(vault.unwindCapBps(), 500);
        assertEq(vault.maxDeploymentBps(), 7000);
        assertEq(address(vault.pusd()), address(pusd));
        assertEq(address(vault.manager()), address(manager));
        assertEq(vault.insuranceFund(), address(ifund));
        assertTrue(vault.hasRole(vault.MANAGER_ROLE(), address(manager)));
        assertTrue(manager.feeExempt(address(vault)));
        assertEq(manager.plusVault(), address(vault));
    }

    function testInitialNAVIsOne() public {
        assertEq(vault.nav(), 1e18);
        assertEq(vault.totalAssets(), 0);
    }

    // -----------------------------------------------------------------
    // Mint paths
    // -----------------------------------------------------------------

    function testDepositToPlus_reservePath() public {
        uint256 amount = 1_000e6;

        vm.startPrank(alice);
        usdc.approve(address(manager), amount);
        manager.depositToPlus(address(usdc), amount, alice);
        vm.stopPrank();

        // PUSD+ minted 1:1 at bootstrap NAV
        assertEq(vault.balanceOf(alice), amount);
        // PUSD now sits in the vault as idle reserve
        assertEq(pusd.balanceOf(address(vault)), amount);
        // USDC moved to manager as reserve
        assertEq(usdc.balanceOf(address(manager)), amount);
        assertEq(vault.idleReservesPusd(), amount);
        assertEq(vault.totalAssets(), amount);
        assertEq(vault.nav(), 1e18);
    }

    function testDepositToPlus_wrapPath() public {
        // Alice first mints PUSD via manager.deposit
        vm.startPrank(alice);
        usdc.approve(address(manager), 500e6);
        manager.deposit(address(usdc), 500e6, alice);
        assertEq(pusd.balanceOf(alice), 500e6);

        // Now wrap PUSD into PUSD+
        pusd.approve(address(manager), 500e6);
        manager.depositToPlus(address(pusd), 500e6, alice);
        vm.stopPrank();

        assertEq(vault.balanceOf(alice), 500e6);
        assertEq(pusd.balanceOf(alice), 0);
        assertEq(pusd.balanceOf(address(vault)), 500e6);
    }

    function testMintPlus_onlyManager() public {
        vm.expectRevert();
        vault.mintPlus(100e6, alice);
    }

    function testMintPlus_zeroAmountReverts() public {
        vm.prank(address(manager));
        vm.expectRevert(PUSDPlusVault.Vault_ZeroAmount.selector);
        vault.mintPlus(0, alice);
    }

    function testMintPlus_zeroRecipientReverts() public {
        vm.prank(address(manager));
        vm.expectRevert(PUSDPlusVault.Vault_ZeroAddress.selector);
        vault.mintPlus(100e6, address(0));
    }

    // -----------------------------------------------------------------
    // Burn — instant tier (idle PUSD ≥ owed)
    // -----------------------------------------------------------------

    function testRedeemFromPlus_instant_USDCpayout() public {
        vm.startPrank(alice);
        usdc.approve(address(manager), 1_000e6);
        manager.depositToPlus(address(usdc), 1_000e6, alice);

        uint256 plusIn = 500e6;
        uint256 usdcBefore = usdc.balanceOf(alice);
        manager.redeemFromPlus(plusIn, address(usdc), true, alice);
        vm.stopPrank();

        // Alice burned 500 PUSD+, received 500 USDC at NAV=1, zero fee on the compose path.
        assertEq(vault.balanceOf(alice), 500e6);
        assertEq(usdc.balanceOf(alice) - usdcBefore, 500e6);
        // Vault retained 500 PUSD idle.
        assertEq(pusd.balanceOf(address(vault)), 500e6);
        // No fees accrued (zero-fee compose path).
        assertEq(manager.accruedFees(address(usdc)), 0);
    }

    function testRedeemFromPlus_unwrapPath() public {
        vm.startPrank(alice);
        usdc.approve(address(manager), 1_000e6);
        manager.depositToPlus(address(usdc), 1_000e6, alice);

        uint256 pusdBefore = pusd.balanceOf(alice);
        manager.redeemFromPlus(500e6, address(pusd), true, alice);
        vm.stopPrank();

        // PUSD direct path — alice gets PUSD, no reserve leg.
        assertEq(pusd.balanceOf(alice) - pusdBefore, 500e6);
        assertEq(vault.balanceOf(alice), 500e6);
    }

    // -----------------------------------------------------------------
    // Burn — convert idle non-PUSD via fee-exempt manager.deposit (tier 2)
    // -----------------------------------------------------------------

    function testRedeemFromPlus_convertsIdleNonPusd() public {
        // Alice mints 1k PUSD+ via USDC.
        vm.startPrank(alice);
        usdc.approve(address(manager), 1_000e6);
        manager.depositToPlus(address(usdc), 1_000e6, alice);
        vm.stopPrank();

        // Keeper converts 600 of the vault's PUSD → 600 USDC (fee-exempt).
        // Vault now: 400 PUSD idle + 600 USDC idle. Manager: 400 USDC.
        vm.prank(keeper);
        vault.redeemPusdForToken(600e6, address(usdc));
        assertEq(pusd.balanceOf(address(vault)), 400e6);
        assertEq(usdc.balanceOf(address(vault)), 600e6);

        // Alice redeems 800 PUSD+ → vault has only 400 PUSD; needs to convert
        // 400 worth of idle USDC back to PUSD via fee-exempt manager.deposit.
        uint256 usdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        manager.redeemFromPlus(800e6, address(usdc), true, alice);

        // After tier-2 conversion, vault sourced full 800 PUSD → manager →
        // _payoutToUser → preferred USDC path (manager has 800 USDC = 400 leftover
        // + 400 just received via tier-2 deposit).
        assertEq(usdc.balanceOf(alice) - usdcBefore, 800e6);
        assertEq(vault.balanceOf(alice), 200e6);
        // Vault retained 200 USDC + 0 PUSD idle.
        assertEq(usdc.balanceOf(address(vault)), 200e6);
        assertEq(pusd.balanceOf(address(vault)), 0);
    }

    // -----------------------------------------------------------------
    // Burn — queue tier (residual when LP locks idle reserves)
    // -----------------------------------------------------------------

    function testRedeemFromPlus_queueAndFulfill() public {
        // alice + bob each deposit 1000 PUSD+ via different reserves so the
        // vault holds idle for both basket tokens.
        vm.startPrank(alice);
        usdc.approve(address(manager), 1_000e6);
        manager.depositToPlus(address(usdc), 1_000e6, alice);
        vm.stopPrank();
        vm.startPrank(bob);
        usdt.approve(address(manager), 1_000e6);
        manager.depositToPlus(address(usdt), 1_000e6, bob);
        vm.stopPrank();
        // Vault: 2000 PUSD idle, supply 2000 PUSD+. Manager: 1000 USDC + 1000 USDT.

        // Keeper redeems all PUSD into reserves to seed pools.
        vm.startPrank(keeper);
        vault.redeemPusdForToken(1_000e6, address(usdc));
        vault.redeemPusdForToken(1_000e6, address(usdt));
        vm.stopPrank();
        // Vault: 0 PUSD + 1000 USDC + 1000 USDT. Manager: 0 USDC + 0 USDT.

        // POOL_ADMIN locks 800+800 = 1600 PUSD-equivalent into LP.
        vm.prank(poolAdmin);
        (uint256 tokenId,) = vault.openPool(
            INonfungiblePositionManager.MintParams({
                token0: address(usdc),
                token1: address(usdt),
                fee: 500,
                tickLower: -20,
                tickUpper: 20,
                amount0Desired: 800e6,
                amount1Desired: 800e6,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(vault),
                deadline: block.timestamp + 60
            })
        );
        // Vault: 0 PUSD + 200 USDC + 200 USDT idle + 1600 in LP. NAV = 1.

        // Alice redeems 800 PUSD+ for USDC. pusdOwed = 800 (NAV unchanged).
        // Tier 1: idle PUSD = 0, short.
        // Tier 2: convert 200 USDC + 200 USDT → 400 PUSD via fee-exempt
        //         manager.deposit. Still 400 short of 800.
        // Tier 3: queue 400 residual.
        uint256 totalQueuedBefore = vault.totalQueuedPusd();
        vm.prank(alice);
        manager.redeemFromPlus(800e6, address(usdc), true, alice);

        // 400 PUSD residual queued, alice's PUSD+ already burned for the full 800.
        assertEq(vault.totalQueuedPusd() - totalQueuedBefore, 400e6);
        assertEq(vault.balanceOf(alice), 200e6);

        // Keeper drains the position back into the vault. (Mock helper —
        // real V3 would use `decreaseLiquidity` + `collect`, which our mock's
        // `closePool` would also handle for non-zero liquidity, but the mock
        // intentionally reports `liquidity = 0` to bypass V3 tick math.)
        npm.unwindAll(tokenId, address(vault));
        assertGt(usdc.balanceOf(address(vault)), 0);
        assertGt(usdt.balanceOf(address(vault)), 0);

        // Anyone can call fulfillQueueClaim — vault converts idle USDC → PUSD,
        // then redeems PUSD → USDC for alice (fee-exempt internal manager.redeem).
        uint256 alicePre = usdc.balanceOf(alice);
        vault.fulfillQueueClaim(1);

        // Queue cleared, alice received the residual 400 USDC.
        assertEq(vault.totalQueuedPusd(), 0);
        assertEq(usdc.balanceOf(alice) - alicePre, 400e6);
    }

    // -----------------------------------------------------------------
    // NAV monotonicity — fees harvested grow NAV; haircut → IF
    // -----------------------------------------------------------------

    function testNAVAccruesFromHarvest() public {
        // Two depositors so we have enough reserves to seed a pool.
        vm.startPrank(alice);
        usdc.approve(address(manager), 1_000e6);
        manager.depositToPlus(address(usdc), 1_000e6, alice);
        vm.stopPrank();
        vm.startPrank(bob);
        usdt.approve(address(manager), 1_000e6);
        manager.depositToPlus(address(usdt), 1_000e6, bob);
        vm.stopPrank();

        // Convert PUSD → reserves.
        vm.startPrank(keeper);
        vault.redeemPusdForToken(500e6, address(usdc));
        vault.redeemPusdForToken(500e6, address(usdt));
        vm.stopPrank();

        // Open a 400+400 LP position.
        vm.prank(poolAdmin);
        (uint256 tokenId,) = vault.openPool(
            INonfungiblePositionManager.MintParams({
                token0: address(usdc),
                token1: address(usdt),
                fee: 500,
                tickLower: -20,
                tickUpper: 20,
                amount0Desired: 400e6,
                amount1Desired: 400e6,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(vault),
                deadline: block.timestamp + 60
            })
        );

        uint256 supplyBefore = vault.totalSupply();
        uint256 navAtMintTime = vault.nav();

        // Mock fee accrual: pool gives 10 USDC + 10 USDT in fees. Real V3 would
        // have these tokens already in the pool from swaps; we mint to the NPM
        // mock to mirror that. Per design §4, uncollected fees are part of
        // position value, so NAV jumps as soon as accrual happens.
        usdc.mint(address(npm), 10e6);
        usdt.mint(address(npm), 10e6);
        npm.accrueFees(tokenId, 10e6, 10e6);
        uint256 navWithUncollected = vault.nav();
        assertGt(navWithUncollected, navAtMintTime); // NAV grew with fees

        // Keeper harvests. 2% haircut → 0.2 USDC + 0.2 USDT to IF; the rest
        // (9.8 USDC + 9.8 USDT) stays in the vault as idle. Net NAV after
        // harvest is below the pre-harvest peak (we paid the haircut) but
        // STRICTLY above the at-mint NAV — fees less haircut accrued to NAV.
        vm.prank(keeper);
        vault.rebalance();

        // Insurance fund got 0.4 in 6-dec aggregated.
        assertEq(ifund.balanceOf(address(usdc)), 0.2e6);
        assertEq(ifund.balanceOf(address(usdt)), 0.2e6);

        // Supply unchanged.
        assertEq(vault.totalSupply(), supplyBefore);
        // NAV after harvest is above the at-mint NAV by ~98% of accrued fees.
        assertGt(vault.nav(), navAtMintTime);
    }

    // -----------------------------------------------------------------
    // Hard caps
    // -----------------------------------------------------------------

    function testHaircutCapEnforced() public {
        vm.prank(vaultAdmin);
        vm.expectRevert(); // MAX_HAIRCUT_BPS = 500
        vault.setHaircutBps(501);
    }

    function testUnwindCapBoundsEnforced() public {
        vm.startPrank(vaultAdmin);
        vm.expectRevert();
        vault.setUnwindCapBps(99);
        vm.expectRevert();
        vault.setUnwindCapBps(5001);
        vault.setUnwindCapBps(2500);
        vm.stopPrank();
        assertEq(vault.unwindCapBps(), 2500);
    }

    function testMaxDeploymentCapEnforced() public {
        vm.prank(vaultAdmin);
        vm.expectRevert();
        vault.setMaxDeploymentBps(8501);
    }

    function testManagerSurplusHaircutCapReducedTo1000() public {
        vm.startPrank(admin);
        vm.expectRevert("PUSDManager: haircut too high");
        manager.setSurplusHaircutBps(address(usdc), 1001);
        manager.setSurplusHaircutBps(address(usdc), 1000);
        vm.stopPrank();

        PUSDManager.TokenInfo memory info = manager.getTokenInfo(address(usdc));
        assertEq(info.surplusHaircutBps, 1000);
    }

    // -----------------------------------------------------------------
    // Role gating
    // -----------------------------------------------------------------

    function testOnlyKeeperCanRebalance() public {
        vm.expectRevert();
        vault.rebalance();
        vm.prank(keeper);
        vault.rebalance(); // no-op when no positions; must not revert
    }

    function testOnlyPoolAdminCanOpenPool() public {
        INonfungiblePositionManager.MintParams memory p = INonfungiblePositionManager.MintParams({
            token0: address(usdc),
            token1: address(usdt),
            fee: 500,
            tickLower: -20,
            tickUpper: 20,
            amount0Desired: 100,
            amount1Desired: 100,
            amount0Min: 0,
            amount1Min: 0,
            recipient: address(vault),
            deadline: block.timestamp + 60
        });
        vm.prank(alice);
        vm.expectRevert();
        vault.openPool(p);
    }

    function testOnlyDefaultAdminCanSetPlusVault() public {
        vm.prank(alice);
        vm.expectRevert();
        manager.setPlusVault(address(0xDEAD));
    }

    function testGuardianCanPauseButNotUnpause() public {
        vm.prank(guardian);
        vault.pause();
        assertTrue(vault.paused());

        vm.prank(guardian);
        vm.expectRevert();
        vault.unpause();

        vm.prank(admin);
        vault.unpause();
        assertFalse(vault.paused());
    }

    // -----------------------------------------------------------------
    // Fee-exempt branch: vault calls public manager.redeem directly
    // -----------------------------------------------------------------

    function testVaultPublicRedeemIsFeeExempt() public {
        // Set non-zero base fee so we'd notice if it's charged.
        vm.prank(admin);
        manager.setBaseFee(50); // 0.5% — well below 1% cap

        // Get reserves into manager via a normal user deposit.
        vm.startPrank(alice);
        usdc.approve(address(manager), 1_000e6);
        manager.depositToPlus(address(usdc), 1_000e6, alice);
        vm.stopPrank();
        // Vault: 1000 PUSD idle. Manager: 1000 USDC.

        uint256 vaultUsdcBefore = usdc.balanceOf(address(vault));
        vm.prank(keeper);
        vault.redeemPusdForToken(500e6, address(usdc));

        // Vault received exactly 500 USDC for 500 PUSD — no fee.
        assertEq(usdc.balanceOf(address(vault)) - vaultUsdcBefore, 500e6);
        assertEq(manager.accruedFees(address(usdc)), 0);
    }

    function testNonVaultRedeemStillChargesFee() public {
        vm.prank(admin);
        manager.setBaseFee(50); // 0.5%

        // Alice deposits via plain deposit, then redeems via plain redeem (NOT
        // through the vault path) — the fee-exempt branch must NOT fire.
        vm.startPrank(alice);
        usdc.approve(address(manager), 1_000e6);
        manager.deposit(address(usdc), 1_000e6, alice);

        manager.redeem(500e6, address(usdc), true, alice);
        vm.stopPrank();

        // Fee accrued: 0.5% of 500 USDC = 2.5 USDC.
        assertEq(manager.accruedFees(address(usdc)), 2.5e6);
    }

    // -----------------------------------------------------------------
    // Pause halts user-facing paths
    // -----------------------------------------------------------------

    function testPauseHaltsRedeem() public {
        vm.startPrank(alice);
        usdc.approve(address(manager), 1_000e6);
        manager.depositToPlus(address(usdc), 1_000e6, alice);
        vm.stopPrank();

        vm.prank(guardian);
        vault.pause();

        vm.prank(alice);
        vm.expectRevert();
        manager.redeemFromPlus(100e6, address(usdc), true, alice);
    }

    function testPauseHaltsMint() public {
        vm.prank(guardian);
        vault.pause();

        vm.startPrank(alice);
        usdc.approve(address(manager), 1_000e6);
        vm.expectRevert();
        manager.depositToPlus(address(usdc), 1_000e6, alice);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------
    // Bootstrap-NAV invariant: 1:1 mint when totalSupply == 0
    // -----------------------------------------------------------------

    function testBootstrapMintIsOneToOne() public {
        vm.startPrank(alice);
        usdc.approve(address(manager), 1234e6);
        manager.depositToPlus(address(usdc), 1234e6, alice);
        vm.stopPrank();

        assertEq(vault.balanceOf(alice), 1234e6);
        assertEq(vault.nav(), 1e18);
    }

    // -----------------------------------------------------------------
    // UUPS upgrade — confirms the deploy script's upgrade flow works on
    // the deployed PUSDManager (v2 src is the current impl; we upgrade to a
    // freshly-deployed copy of the same source as a smoke test for the
    // upgradeToAndCall mechanics + storage preservation).
    // -----------------------------------------------------------------

    function testManagerUpgradePreservesState() public {
        // Pre-upgrade: alice has 1k PUSD+. State to preserve includes
        // plusVault, feeExempt, accruedHaircut, supportedTokens, etc.
        vm.startPrank(alice);
        usdc.approve(address(manager), 1_000e6);
        manager.depositToPlus(address(usdc), 1_000e6, alice);
        vm.stopPrank();

        address plusVaultBefore = manager.plusVault();
        bool feeExemptBefore = manager.feeExempt(address(vault));
        uint256 supplyBefore = vault.totalSupply();

        // Deploy a new impl (same source) and upgrade the proxy. Caller is
        // `admin` who holds UPGRADER_ROLE in setUp().
        PUSDManager newImpl = new PUSDManager();
        vm.prank(admin);
        (bool ok,) = address(manager)
            .call(abi.encodeWithSignature("upgradeToAndCall(address,bytes)", address(newImpl), bytes("")));
        assertTrue(ok, "upgrade failed");

        // Post-upgrade: storage preserved.
        assertEq(manager.plusVault(), plusVaultBefore);
        assertEq(manager.feeExempt(address(vault)), feeExemptBefore);
        assertEq(vault.totalSupply(), supplyBefore);

        // And the v2 surface still works after the upgrade.
        vm.startPrank(alice);
        usdc.approve(address(manager), 100e6);
        manager.depositToPlus(address(usdc), 100e6, alice);
        vm.stopPrank();
        assertEq(vault.balanceOf(alice), 1_100e6);
    }

    // -----------------------------------------------------------------
    // Two depositors share a single NAV
    // -----------------------------------------------------------------

    function testTwoDepositorsShareNAV() public {
        vm.startPrank(alice);
        usdc.approve(address(manager), 1_000e6);
        manager.depositToPlus(address(usdc), 1_000e6, alice);
        vm.stopPrank();

        vm.startPrank(bob);
        usdt.approve(address(manager), 500e6);
        manager.depositToPlus(address(usdt), 500e6, bob);
        vm.stopPrank();

        assertEq(vault.balanceOf(alice), 1_000e6);
        assertEq(vault.balanceOf(bob), 500e6);
        assertEq(vault.totalSupply(), 1_500e6);
        assertEq(vault.totalAssets(), 1_500e6);
        assertEq(vault.nav(), 1e18);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../../src/PUSD.sol";
import "../../src/PUSDManager.sol";
import "../../src/PUSDPlus.sol";
import "../../src/PUSDLiquidity.sol";
import "../../src/interfaces/IUniswapV3Factory.sol";
import "../../src/interfaces/IUniswapV3Pool.sol";

import "../mocks/MockERC20.sol";

/**
 * @title  InvariantsForkTest
 * @notice I-13 (LP drift) regression — runs against a real Push Chain Donut fork so the deploy
 *         touches the canonical Uniswap V3 factory / NPM / router (the unit suite uses mocks
 *         that don't model price math).
 *
 *         What we assert at fork-test scale:
 *           - A freshly minted position around tick 0 with stable-stable inputs reports a
 *             principal-equivalent gross value within `MAX_DRIFT_BPS`.
 *           - `grossValueInPUSD` matches `deployedPrincipalInPUSD` ± `MAX_DRIFT_BPS` immediately
 *             post-mint (no swaps, no fee accrual yet).
 *           - The integration with the live UniV3 contracts succeeds end-to-end (factory.createPool,
 *             pool.initialize, npm.mint). This is the smoke-test half of the value here.
 *
 *         How to run:
 *           FORK_RPC_URL=https://evm.donut.rpc.push.org/ \
 *           UNIV3_FACTORY=0x81b8Bca02580C7d6b636051FDb7baAC436bFb454 \
 *           UNIV3_NPM=0xf9b3ac66aed14A2C7D9AA7696841aB6B27a6231e \
 *           UNIV3_ROUTER=0x5D548bB9E305AAe0d6dc6e6fdc3ab419f6aC0037 \
 *           forge test --match-contract InvariantsForkTest -vv
 *
 *         When `FORK_RPC_URL` is unset the test exits cleanly with a log line — that's the
 *         default `forge test` behaviour so CI doesn't break on offline runs.
 */
contract InvariantsForkTest is Test {
    /// @notice Tolerance for the gross/principal drift check, in basis points (10 = 0.10%).
    ///         Real UniV3 LiquidityAmounts rounds DOWN on mint and UP on read-back, leaving a few
    ///         wei of drift even with a tight ±1-tick range. 10bps is generous; expect ≤1 wei in
    ///         practice for a 1k-stable test position.
    uint256 internal constant MAX_DRIFT_BPS = 10;

    /// @notice 0.05% pool fee tier — lowest tier enabled on Push Chain Donut's UniV3 factory.
    ///         Querying `feeAmountTickSpacing(100)` returns 0 (disabled); 500 → 10 (enabled).
    ///         tickSpacing=10 means valid ticks must be multiples of 10.
    uint24 internal constant POOL_FEE = 500;

    /// @notice sqrt(1.0) * 2^96 — initial price for a 1:1 stable-stable pool.
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    PUSD          public pusd;
    PUSDManager   public manager;
    PUSDPlus      public plus;
    PUSDLiquidity public liq;

    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public admin   = address(0xA11CE);
    address public feeRcpt = address(0xFEED);
    address public reb     = address(0xBEEF);

    function _maybeFork() internal returns (bool ok) {
        string memory rpc = vm.envOr("FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            emit log_string("[skip] FORK_RPC_URL not set; LP-drift fork test skipped");
            return false;
        }
        try vm.createSelectFork(rpc) {
            return true;
        } catch (bytes memory err) {
            emit log_string("[skip] fork init failed; LP-drift fork test skipped");
            emit log_bytes(err);
            return false;
        }
    }

    /// @notice I-13 LP-drift fork test. Deploys the v2 stack on a real Push Chain Donut fork,
    ///         creates a 0.01% stable-stable pool via the live UniV3 factory, opens a tight
    ///         position, and asserts the LP-implied gross value matches deployed principal
    ///         within tolerance.
    function testFork_I13_LPDriftBoundedAfterMint() public {
        if (!_maybeFork()) return;

        address factoryAddr = vm.envOr("UNIV3_FACTORY", address(0x81b8Bca02580C7d6b636051FDb7baAC436bFb454));
        address npmAddr     = vm.envOr("UNIV3_NPM",     address(0xf9b3ac66aed14A2C7D9AA7696841aB6B27a6231e));
        address routerAddr  = vm.envOr("UNIV3_ROUTER",  address(0x5D548bB9E305AAe0d6dc6e6fdc3ab419f6aC0037));

        require(factoryAddr.code.length > 0, "fork: factory has no code at expected address");
        require(npmAddr.code.length     > 0, "fork: NPM has no code at expected address");
        require(routerAddr.code.length  > 0, "fork: router has no code at expected address");

        // ------------------------- deploy v2 stack on fork -------------------------
        tokenA = new MockERC20("USDC.eth-mock", "USDCe", 6);
        tokenB = new MockERC20("USDC.sol-mock", "USDCs", 6);

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

        liq = PUSDLiquidity(address(new ERC1967Proxy(
            address(new PUSDLiquidity()),
            abi.encodeWithSelector(
                PUSDLiquidity.initialize.selector,
                admin, address(manager), npmAddr, routerAddr, factoryAddr
            )
        )));

        vm.startPrank(admin);
        pusd.grantRole(pusd.MINTER_ROLE(), address(manager));
        pusd.grantRole(pusd.BURNER_ROLE(), address(manager));
        manager.setPUSDPlus(address(plus));
        manager.setPUSDLiquidity(address(liq));
        manager.addSupportedToken(address(tokenA), "USDC.eth-mock", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(tokenB), "USDC.sol-mock", "Solana_Devnet",    6);
        plus.setPUSDLiquidity(address(liq));
        // Intentionally DO NOT call `liq.setPUSDPlus` — keeps `_enforceDeployCap` dormant so
        // this test isolates LP-drift accuracy from cap mechanics. Cap behaviour is exercised
        // by the unit invariant suite.
        liq.grantRole(liq.REBALANCER_ROLE(), reb);
        vm.stopPrank();

        // ------------------------- create + initialise a real pool -------------------
        IUniswapV3Factory factory = IUniswapV3Factory(factoryAddr);
        (address t0, address t1) = address(tokenA) < address(tokenB)
            ? (address(tokenA), address(tokenB))
            : (address(tokenB), address(tokenA));
        address pool = factory.getPool(t0, t1, POOL_FEE);
        if (pool == address(0)) {
            pool = factory.createPool(t0, t1, POOL_FEE);
        }
        require(pool != address(0), "fork: pool creation returned zero");
        IUniswapV3Pool(pool).initialize(SQRT_PRICE_1_1);

        vm.prank(admin);
        liq.addPool(pool);

        // ------------------------- push principal to Liquidity ----------------------
        // Mint 1000 of each stable into the Manager's yield-share reserve, then push the same
        // amount into Liquidity. After the push: principal = 2000e6 PUSD-equivalent.
        uint256 amt = 1_000 * 1e6;
        tokenA.mint(address(this), amt);
        tokenB.mint(address(this), amt);
        tokenA.approve(address(plus), amt);
        tokenB.approve(address(plus), amt);
        plus.depositStable(address(tokenA), amt, address(this));
        plus.depositStable(address(tokenB), amt, address(this));

        vm.startPrank(admin);
        manager.transferYieldToLiquidity(address(tokenA), amt);
        manager.transferYieldToLiquidity(address(tokenB), amt);
        vm.stopPrank();

        uint256 principalBeforeMint = liq.deployedPrincipalInPUSD();
        assertEq(principalBeforeMint, 2 * amt, "principal must equal pushed amount in PUSD units");

        // ------------------------- open a tight position around tick 0 --------------
        // Tight bands ±10 ticks (~0.1%). A 0.01% pool has tickSpacing=1, so any multiple works.
        int24 tickLower = -10;
        int24 tickUpper =  10;
        uint256 use0    = 500 * 1e6;
        uint256 use1    = 500 * 1e6;

        vm.prank(reb);
        uint256 tokenId = liq.mintPosition(
            pool, tickLower, tickUpper, use0, use1, 0, 0, block.timestamp
        );
        assertGt(tokenId, 0, "fork: NPM did not return a tokenId");

        // ------------------------- I-13 drift assertion -----------------------------
        // Right after mint, with no swaps and no fee accrual, gross value should be within a
        // few wei of principal. Leftover idle remains (UniV3 always uses ≤ desired amounts).
        uint256 gross     = liq.grossValueInPUSD();
        uint256 principal = liq.deployedPrincipalInPUSD();

        emit log_named_uint("fork.principal", principal);
        emit log_named_uint("fork.gross",     gross);

        // Drift = |gross - principal| as a fraction of principal, in bps.
        uint256 diff = gross > principal ? gross - principal : principal - gross;
        uint256 driftBps = principal == 0 ? 0 : (diff * 10_000) / principal;

        emit log_named_uint("fork.driftBps", driftBps);

        require(driftBps <= MAX_DRIFT_BPS, "I-13: post-mint LP drift exceeds tolerance");
    }
}

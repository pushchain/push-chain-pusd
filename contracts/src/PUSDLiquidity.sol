// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IPUSDLiquidity.sol";
import "./interfaces/IPUSDPlus.sol";
import "./interfaces/IPUSDManager.sol";
import "./interfaces/INonfungiblePositionManager.sol";
import "./interfaces/ISwapRouter.sol";
import "./interfaces/IUniswapV3Pool.sol";
import "./interfaces/IUniswapV3Factory.sol";

import "./libs/TickMath.sol";
import "./libs/LiquidityAmounts.sol";
import "./libs/DecimalLib.sol";

/**
 * @title  PUSDLiquidity (multi-pool, multi-asset)
 * @notice Uniswap V3 LP engine for the PUSD+ yield slice. Owns one or more concentrated
 *         positions across a registry of stable-stable pools (any pair in
 *         `Manager.supportedTokens`). Reports `netAssetsInPUSD()` to PUSDPlus and serves
 *         redemption requests via `pullForWithdraw` with a 3-step waterfall:
 *
 *             1. Idle inventory of the requested token.
 *             2. Unwind positions whose pool contains the requested token (collect → decrease).
 *             3. Multi-hop swap (≤2 hops) over the active pool registry from any other
 *                idle stable to the requested token, via `ISwapRouter.exactInput`.
 *
 *         Pool lifecycle: `addPool` (validates stable-stable via Manager) → `deactivatePool`
 *         (blocks new positions, existing keep working) → `removePool` (requires zero active
 *         positions referencing the pool).
 *
 *         Cap (I-12): `(idle + deployed) PUSD-eq <= maxDeployableBps * PUSDPlus.totalAssets`.
 *         Position count is bounded globally by `MAX_POSITIONS = 10`.
 */
contract PUSDLiquidity is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IPUSDLiquidity
{
    using SafeERC20 for IERC20;
    using DecimalLib for uint256;

    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------
    bytes32 public constant ADMIN_ROLE      = keccak256("ADMIN_ROLE");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");
    bytes32 public constant VAULT_ROLE      = keccak256("VAULT_ROLE");
    bytes32 public constant PAUSER_ROLE     = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE   = keccak256("UPGRADER_ROLE");

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------
    uint16 public constant HARD_CAP_BPS    = 5000;     // <= 50% deploy cap absolute ceiling
    uint16 public constant MAX_SLIPPAGE_BPS = 100;     // 1% per swap leg
    uint256 public constant MAX_POSITIONS  = 10;
    uint256 private constant BASIS_POINTS  = 10000;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;

    // ---------------------------------------------------------------------
    // Storage — wiring
    // ---------------------------------------------------------------------
    address public pusdPlus;
    address public pusdManager;

    INonfungiblePositionManager public npm;
    ISwapRouter                 public router;
    IUniswapV3Factory           public factory;

    // ---------------------------------------------------------------------
    // Storage — caps & slippage
    // ---------------------------------------------------------------------
    uint16 public maxDeployableBps;     // <= HARD_CAP_BPS, launch 3000
    uint16 public emergencyLiquidityBps; // launch 3000
    uint16 public lpSwapSlippageBps;    // launch 50 (per-hop floor)

    // ---------------------------------------------------------------------
    // Storage — principal tracking
    // ---------------------------------------------------------------------
    /// @notice Cumulative principal pushed by Manager via `pushForDeploy`, denominated in PUSD
    ///         (6-dec). Decremented by `delivered.toPUSD()` on every successful `pullForWithdraw`.
    /// @dev    `netAssetsInPUSD()` returns `(totalValue − deployedPrincipalInPUSD)`, clamped to 0.
    ///         This prevents double-counting between `PUSDPlus.pusd.balanceOf(this)` (which already
    ///         represents the user-facing claim against the yield slice) and the underlying
    ///         collateral that backs that PUSD inside Liquidity. Without this subtraction every
    ///         admin push from Manager into Liquidity would be reported as fresh "yield" by
    ///         `PUSDPlus.totalAssets`, crystallising a phantom HWM gain at the next call.
    uint256 public deployedPrincipalInPUSD;

    // ---------------------------------------------------------------------
    // Storage — pool registry
    // ---------------------------------------------------------------------
    struct PoolInfo {
        bool    registered;
        bool    active;
        address token0;     // canonical (token0 < token1)
        address token1;
        uint24  fee;
    }
    mapping(address => PoolInfo) public poolInfo;
    address[]                    public pools;
    mapping(address => uint256)  internal _poolIndex; // pool → idx+1 (0 = absent)

    // ---------------------------------------------------------------------
    // Storage — positions
    // ---------------------------------------------------------------------
    struct Position {
        uint256 tokenId;
        address pool;
        int24   tickLower;
        int24   tickUpper;
        bool    active;
    }
    Position[] public positions;
    mapping(uint256 => uint256) public positionByTokenId; // tokenId → positions[] index + 1

    uint256 private _status;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event PUSDPlusSet(address indexed oldPlus, address indexed newPlus);
    event MaxDeployableBpsSet(uint16 oldBps, uint16 newBps);
    event EmergencyLiquidityBpsSet(uint16 oldBps, uint16 newBps);
    event LpSwapSlippageBpsSet(uint16 oldBps, uint16 newBps);

    event PoolAdded(address indexed pool, address indexed token0, address indexed token1, uint24 fee);
    event PoolDeactivated(address indexed pool);
    event PoolActivated(address indexed pool);
    event PoolRemoved(address indexed pool);

    event PositionMinted(
        uint256 indexed tokenId, address indexed pool,
        int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 amount0, uint256 amount1
    );
    event LiquidityIncreased(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    event LiquidityDecreased(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    event FeesCollected(uint256 indexed tokenId, uint256 amount0, uint256 amount1);
    event PositionClosed(uint256 indexed tokenId);
    event Pulled(address indexed token, uint256 requested, uint256 delivered, address indexed recipient);
    event PushedForDeploy(address indexed token, uint256 amount);
    event Swapped(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------
    error DeployCapExceeded(uint256 deployed, uint256 max);
    error PositionCapReached();
    error PositionNotFound();
    error InsufficientLiquidity(uint256 requested, uint256 delivered);
    error UnsupportedToken();
    error InvalidTickRange();
    error PoolNotRegistered();
    error PoolNotActive();
    error PoolAlreadyRegistered();
    error PoolHasActivePositions();
    error NoRouteFound(address fromToken, address toToken);

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address manager,
        address npm_,
        address router_,
        address factory_
    ) public initializer {
        require(admin    != address(0), "PUSDLiquidity: zero admin");
        require(manager  != address(0), "PUSDLiquidity: zero manager");
        require(npm_     != address(0), "PUSDLiquidity: zero NPM");
        require(router_  != address(0), "PUSDLiquidity: zero router");
        require(factory_ != address(0), "PUSDLiquidity: zero factory");

        __AccessControl_init();
        __Pausable_init();

        pusdManager = manager;
        // Manager.redeemForVault calls back into Liquidity.pullForWithdraw on the user's behalf;
        // grant VAULT_ROLE to Manager so that path is authorised. Manager.redeemForVault is itself
        // gated to VAULT_ROLE on Manager (= only PUSDPlus), so this does not widen attack surface.
        _grantRole(VAULT_ROLE, manager);

        npm     = INonfungiblePositionManager(npm_);
        router  = ISwapRouter(router_);
        factory = IUniswapV3Factory(factory_);

        maxDeployableBps      = 3000;
        emergencyLiquidityBps = 3000;
        lpSwapSlippageBps     = 50;

        _status = _NOT_ENTERED;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    // =====================================================================
    //                            ADMIN — wiring & params
    // =====================================================================

    function setPUSDPlus(address newPlus) external onlyRole(ADMIN_ROLE) {
        require(newPlus != address(0), "PUSDLiquidity: zero plus");
        if (pusdPlus != address(0)) _revokeRole(VAULT_ROLE, pusdPlus);
        address old = pusdPlus;
        pusdPlus = newPlus;
        _grantRole(VAULT_ROLE, newPlus);
        emit PUSDPlusSet(old, newPlus);
    }

    function setMaxDeployableBps(uint16 bps) external onlyRole(ADMIN_ROLE) {
        require(bps <= HARD_CAP_BPS, "PUSDLiquidity: > HARD_CAP_BPS");
        uint16 old = maxDeployableBps;
        maxDeployableBps = bps;
        emit MaxDeployableBpsSet(old, bps);
    }

    function setEmergencyLiquidityBps(uint16 bps) external onlyRole(ADMIN_ROLE) {
        require(bps <= HARD_CAP_BPS, "PUSDLiquidity: floor too high");
        uint16 old = emergencyLiquidityBps;
        emergencyLiquidityBps = bps;
        emit EmergencyLiquidityBpsSet(old, bps);
    }

    function setLpSwapSlippageBps(uint16 bps) external onlyRole(ADMIN_ROLE) {
        require(bps <= MAX_SLIPPAGE_BPS, "PUSDLiquidity: slippage > 1%");
        uint16 old = lpSwapSlippageBps;
        lpSwapSlippageBps = bps;
        emit LpSwapSlippageBpsSet(old, bps);
    }

    function pause() external onlyRole(PAUSER_ROLE)   { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // =====================================================================
    //                            ADMIN — pool lifecycle
    // =====================================================================

    /// @notice Register a Uniswap V3 pool whose two tokens are both Manager-supported stables.
    /// @dev    Validates: factory provenance + Manager.isSupportedStable on both legs.
    function addPool(address pool) external onlyRole(ADMIN_ROLE) {
        require(pool != address(0),                     "PUSDLiquidity: zero pool");
        if (poolInfo[pool].registered) revert PoolAlreadyRegistered();

        address t0  = IUniswapV3Pool(pool).token0();
        address t1  = IUniswapV3Pool(pool).token1();
        uint24  fee = IUniswapV3Pool(pool).fee();

        require(factory.getPool(t0, t1, fee) == pool,   "PUSDLiquidity: pool not from factory");
        require(IPUSDManager(pusdManager).isSupportedStable(t0), "PUSDLiquidity: token0 not stable");
        require(IPUSDManager(pusdManager).isSupportedStable(t1), "PUSDLiquidity: token1 not stable");

        poolInfo[pool] = PoolInfo({
            registered: true,
            active:     true,
            token0:     t0,
            token1:     t1,
            fee:        fee
        });
        pools.push(pool);
        _poolIndex[pool] = pools.length;

        emit PoolAdded(pool, t0, t1, fee);
    }

    /// @notice Block new positions on `pool`. Existing positions remain and can be unwound by
    ///         `pullForWithdraw` and the rebalancer's regular helpers.
    function deactivatePool(address pool) external onlyRole(ADMIN_ROLE) {
        PoolInfo storage p = poolInfo[pool];
        if (!p.registered) revert PoolNotRegistered();
        require(p.active, "PUSDLiquidity: already inactive");
        p.active = false;
        emit PoolDeactivated(pool);
    }

    function activatePool(address pool) external onlyRole(ADMIN_ROLE) {
        PoolInfo storage p = poolInfo[pool];
        if (!p.registered) revert PoolNotRegistered();
        require(!p.active, "PUSDLiquidity: already active");
        p.active = true;
        emit PoolActivated(pool);
    }

    /// @notice Hard-delete a pool from the registry. Requires zero active positions reference it.
    function removePool(address pool) external onlyRole(ADMIN_ROLE) {
        PoolInfo storage info = poolInfo[pool];
        if (!info.registered) revert PoolNotRegistered();

        // Disallow removal while any active position references this pool.
        uint256 plen = positions.length;
        for (uint256 i = 0; i < plen; i++) {
            if (positions[i].active && positions[i].pool == pool) revert PoolHasActivePositions();
        }

        // Swap-and-pop from `pools[]`.
        uint256 idx1 = _poolIndex[pool];
        uint256 last = pools.length;
        if (idx1 != last) {
            address moved = pools[last - 1];
            pools[idx1 - 1] = moved;
            _poolIndex[moved] = idx1;
        }
        pools.pop();
        delete _poolIndex[pool];
        delete poolInfo[pool];

        emit PoolRemoved(pool);
    }

    /// @notice Recover stray tokens. Cannot drain anything Manager has registered as a supported
    ///         stable — those count toward NAV and the protocol owns them.
    function recoverDust(address token, address to, uint256 amount) external onlyRole(ADMIN_ROLE) {
        require(!IPUSDManager(pusdManager).isSupportedStable(token), "PUSDLiquidity: cannot drain reserve");
        IERC20(token).safeTransfer(to, amount);
    }

    // =====================================================================
    //                       VAULT INTERFACE
    // =====================================================================

    /// @inheritdoc IPUSDLiquidity
    function pushForDeploy(address token, uint256 amount) external override {
        // Manager calls this immediately AFTER transferring the tokens via safeTransfer.
        // This entrypoint is a notification and accepts both VAULT_ROLE (PUSDPlus) and the Manager.
        require(
            hasRole(VAULT_ROLE, msg.sender) || msg.sender == pusdManager,
            "PUSDLiquidity: not authorised"
        );
        require(IPUSDManager(pusdManager).isSupportedStable(token), "PUSDLiquidity: unsupported token");

        // Credit principal so `netAssetsInPUSD` correctly nets out the just-arrived collateral
        // (which is already counted by PUSD held in PUSDPlus). See storage doc-comment for rationale.
        if (amount > 0) {
            uint8 d = IPUSDManager(pusdManager).decimalsOf(token);
            if (d > 0) deployedPrincipalInPUSD += amount.toPUSD(d);
        }

        // Enforce I-12 at the deployment edge so admin cannot stuff Liquidity past the cap. Note:
        // the cap can still be transiently violated by user redemptions shrinking PUSDPlus.totalAssets
        // — that drift is an accepted soft-cap behaviour and is corrected by subsequent pulls.
        _enforceDeployCap();

        emit PushedForDeploy(token, IERC20(token).balanceOf(address(this)));
    }

    /// @inheritdoc IPUSDLiquidity
    function pullForWithdraw(address token, uint256 amount, address recipient)
        external
        override
        onlyRole(VAULT_ROLE)
        nonReentrant
        returns (uint256 delivered)
    {
        if (!IPUSDManager(pusdManager).isSupportedStable(token)) revert UnsupportedToken();
        require(recipient != address(0), "PUSDLiquidity: zero recipient");
        if (amount == 0) return 0;

        uint256 stillNeeded = amount;

        // -----------------------------------------------------------------
        // Step 1: Pay from idle inventory of the target token first.
        // -----------------------------------------------------------------
        {
            uint256 idle = IERC20(token).balanceOf(address(this));
            if (idle > 0) {
                uint256 take = idle >= stillNeeded ? stillNeeded : idle;
                IERC20(token).safeTransfer(recipient, take);
                delivered += take;
                stillNeeded -= take;
            }
        }
        // (No early return on success here — fall through so the unified tail handles
        //  the principal decrement + emit exactly once for every successful path.)

        // -----------------------------------------------------------------
        // Step 2: Unwind positions whose pool contains the target token.
        //         Iterate active positions; collect fees first, then decrease.
        // -----------------------------------------------------------------
        {
            uint256 len = positions.length;
            for (uint256 i = 0; i < len && stillNeeded > 0; i++) {
                Position storage p = positions[i];
                if (!p.active) continue;
                PoolInfo storage info = poolInfo[p.pool];
                if (info.token0 != token && info.token1 != token) continue;

                bool tokenIs0 = (info.token0 == token);

                // 2a. First collect outstanding fees — cheapest source.
                (uint256 c0, uint256 c1) = _collectFees(p.tokenId);
                uint256 collectedOfToken = tokenIs0 ? c0 : c1;
                if (collectedOfToken > 0) {
                    uint256 take = collectedOfToken > stillNeeded ? stillNeeded : collectedOfToken;
                    IERC20(token).safeTransfer(recipient, take);
                    delivered += take;
                    stillNeeded -= take;
                }
                if (stillNeeded == 0) break;

                // 2b. Decrease liquidity proportional to residual need.
                (, , , , , , , uint128 liquidity, , , , ) = npm.positions(p.tokenId);
                if (liquidity == 0) continue;

                uint128 toRemove = _liquidityForToken(p, info, token, stillNeeded, liquidity);
                if (toRemove == 0) continue;

                _decreaseLiquidity(p.tokenId, toRemove);
                // After decrease, the principal is parked in tokensOwed. The second collect drains
                // it back to this contract; (g0, g1) are exactly what was just decreased.
                (uint256 g0, uint256 g1) = _collectFees(p.tokenId);

                uint256 gotToken = tokenIs0 ? g0 : g1;
                uint256 payable_ = gotToken > stillNeeded ? stillNeeded : gotToken;
                if (payable_ > 0) {
                    IERC20(token).safeTransfer(recipient, payable_);
                    delivered += payable_;
                    stillNeeded -= payable_;
                }
                // Wrong-token leftover stays idle — counted in NAV, swept by future redemptions.
            }
        }
        // (Same no-early-return rationale as above.)

        // -----------------------------------------------------------------
        // Step 3: Multi-hop swap fallback. Iterate every Manager-supported reserve token, find
        //         a route through the active pool registry to `token`, swap.
        // -----------------------------------------------------------------
        {
            uint256 tcount = IPUSDManager(pusdManager).tokenCount();
            for (uint256 i = 0; i < tcount && stillNeeded > 0; i++) {
                address src = IPUSDManager(pusdManager).tokenList(i);
                if (src == token) continue;
                if (!IPUSDManager(pusdManager).isSupportedStable(src)) continue;

                uint256 srcIdle = IERC20(src).balanceOf(address(this));
                if (srcIdle == 0) continue;

                (bytes memory path, bool ok) = _findRoute(src, token);
                if (!ok) continue;

                // Convert "stillNeeded of `token`" into "amountIn of `src`" assuming peg parity.
                // Both decimals align across Manager.supportedTokens; for safety we still scale.
                uint256 wantIn = _convertParity(stillNeeded, token, src);
                // Add slippage cushion so a tightly-priced peg still clears amountOutMinimum.
                uint256 cushion = (wantIn * lpSwapSlippageBps) / BASIS_POINTS;
                uint256 amountIn = wantIn + cushion;
                if (amountIn > srcIdle) amountIn = srcIdle;

                uint256 hops    = _hopCount(path);
                uint256 minOut  = _minOutForPath(amountIn, src, token, hops);
                uint256 out     = _exactInputPath(src, path, amountIn, minOut);

                if (out > 0) {
                    uint256 take = out > stillNeeded ? stillNeeded : out;
                    IERC20(token).safeTransfer(recipient, take);
                    delivered  += take;
                    stillNeeded -= take;
                }
            }
        }

        if (stillNeeded > 0) {
            // Could not fully service — Manager surfaces this to the user as a revert.
            revert InsufficientLiquidity(amount, delivered);
        }

        // Decrement principal to mirror the deliver. Clamp to 0 so cumulative fee income never
        // drives the counter negative (any excess "yield" stays as positive netAssetsInPUSD).
        if (delivered > 0) {
            uint8 d = IPUSDManager(pusdManager).decimalsOf(token);
            if (d > 0) {
                uint256 deliveredInPUSD = delivered.toPUSD(d);
                deployedPrincipalInPUSD = deliveredInPUSD >= deployedPrincipalInPUSD
                    ? 0
                    : deployedPrincipalInPUSD - deliveredInPUSD;
            }
        }

        emit Pulled(token, amount, delivered, recipient);
    }

    // =====================================================================
    //                       POSITION LIFECYCLE
    // =====================================================================

    function mintPosition(
        address pool,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0,
        uint256 amount1,
        uint256 minAmount0,
        uint256 minAmount1,
        uint256 deadline
    ) external onlyRole(REBALANCER_ROLE) whenNotPaused nonReentrant returns (uint256 tokenId) {
        PoolInfo memory info = poolInfo[pool];
        if (!info.registered) revert PoolNotRegistered();
        if (!info.active)     revert PoolNotActive();
        if (positions.length >= MAX_POSITIONS) revert PositionCapReached();
        if (tickLower >= tickUpper)            revert InvalidTickRange();

        IERC20(info.token0).forceApprove(address(npm), amount0);
        IERC20(info.token1).forceApprove(address(npm), amount1);

        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager.MintParams({
            token0:         info.token0,
            token1:         info.token1,
            fee:            info.fee,
            tickLower:      tickLower,
            tickUpper:      tickUpper,
            amount0Desired: amount0,
            amount1Desired: amount1,
            amount0Min:     minAmount0,
            amount1Min:     minAmount1,
            recipient:      address(this),
            deadline:       deadline
        });

        uint128 liquidity;
        uint256 used0;
        uint256 used1;
        (tokenId, liquidity, used0, used1) = npm.mint(params);

        positions.push(Position({
            tokenId:   tokenId,
            pool:      pool,
            tickLower: tickLower,
            tickUpper: tickUpper,
            active:    true
        }));
        positionByTokenId[tokenId] = positions.length; // 1-indexed

        _enforceDeployCap();
        emit PositionMinted(tokenId, pool, tickLower, tickUpper, liquidity, used0, used1);
    }

    function increasePosition(
        uint256 tokenId,
        uint256 amount0,
        uint256 amount1,
        uint256 minAmount0,
        uint256 minAmount1,
        uint256 deadline
    ) external onlyRole(REBALANCER_ROLE) whenNotPaused nonReentrant {
        Position storage p = _getPositionMut(tokenId);
        PoolInfo storage info = poolInfo[p.pool];

        IERC20(info.token0).forceApprove(address(npm), amount0);
        IERC20(info.token1).forceApprove(address(npm), amount1);

        (uint128 liquidity, uint256 used0, uint256 used1) = npm.increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId:        tokenId,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min:     minAmount0,
                amount1Min:     minAmount1,
                deadline:       deadline
            })
        );

        _enforceDeployCap();
        emit LiquidityIncreased(tokenId, liquidity, used0, used1);
    }

    function decreasePosition(
        uint256 tokenId,
        uint128 liquidity,
        uint256 minAmount0,
        uint256 minAmount1,
        uint256 deadline
    ) external onlyRole(REBALANCER_ROLE) nonReentrant returns (uint256 amount0, uint256 amount1) {
        _getPositionMut(tokenId);
        (amount0, amount1) = npm.decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId:    tokenId,
                liquidity:  liquidity,
                amount0Min: minAmount0,
                amount1Min: minAmount1,
                deadline:   deadline
            })
        );
        _collectFees(tokenId);
        emit LiquidityDecreased(tokenId, liquidity, amount0, amount1);
    }

    function collectFees(uint256 tokenId) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        _getPositionMut(tokenId);
        return _collectFees(tokenId);
    }

    function closePosition(uint256 tokenId, uint256 minAmount0, uint256 minAmount1, uint256 deadline)
        external
        onlyRole(REBALANCER_ROLE)
        nonReentrant
    {
        Position storage p = _getPositionMut(tokenId);
        (, , , , , , , uint128 liquidity, , , , ) = npm.positions(tokenId);
        if (liquidity > 0) {
            npm.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId:    tokenId,
                    liquidity:  liquidity,
                    amount0Min: minAmount0,
                    amount1Min: minAmount1,
                    deadline:   deadline
                })
            );
        }
        _collectFees(tokenId);
        p.active = false;
        emit PositionClosed(tokenId);
    }

    // =====================================================================
    //                       NAV REPORTING
    // =====================================================================

    /// @inheritdoc IPUSDLiquidity
    /// @dev Returns the LP engine's NAV ABOVE the cumulative principal that PUSDPlus has pushed into
    ///      it. Counts (idle inventory + position-implied amounts + uncollected fees) and subtracts
    ///      `deployedPrincipalInPUSD`, clamping to 0. The principal must be excluded because the
    ///      same collateral is already represented by the PUSD that PUSDPlus holds in its balance —
    ///      `PUSDPlus.totalAssets = pusd.balanceOf(plus) + Liquidity.netAssetsInPUSD()` would double-
    ///      count without this subtraction. Drift below 0 is silent (clamped) and surfaces as I-13.
    function netAssetsInPUSD() external view override returns (uint256 nav) {
        uint256 totalValueInPUSD = _grossValueInPUSD();

        // Net out the principal pushed by Manager. Clamp to 0 — losses larger than yield
        // cushion show up here as a flat NAV (never negative pps); admin must top up.
        uint256 principal = deployedPrincipalInPUSD;
        nav = totalValueInPUSD > principal ? totalValueInPUSD - principal : 0;
    }

    /// @notice Total LP-engine value (idle + positions + uncollected fees) in PUSD units, BEFORE
    ///         netting against principal. Useful for I-13 drift checks and operational dashboards.
    function grossValueInPUSD() external view returns (uint256 gross) {
        return _grossValueInPUSD();
    }

    /// @dev Shared body for `grossValueInPUSD`, `netAssetsInPUSD`, and `_enforceDeployCap`.
    ///      Kept private so all three call sites collapse into a single deployed routine; the
    ///      previous duplicate copies pushed the contract above the EIP-170 24576-byte limit.
    function _grossValueInPUSD() private view returns (uint256 gross) {
        uint256 tcount = IPUSDManager(pusdManager).tokenCount();
        for (uint256 i = 0; i < tcount; i++) {
            address t = IPUSDManager(pusdManager).tokenList(i);
            uint8   d = IPUSDManager(pusdManager).decimalsOf(t);
            uint256 bal = IERC20(t).balanceOf(address(this));
            if (bal > 0 && d > 0) gross += bal.toPUSD(d);
        }

        uint256 plen = positions.length;
        for (uint256 i = 0; i < plen; i++) {
            Position storage p = positions[i];
            if (!p.active) continue;
            PoolInfo storage info = poolInfo[p.pool];
            if (!info.registered) continue;

            (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(p.pool).slot0();
            (, , , , , , , uint128 liquidity, , , uint128 owed0, uint128 owed1) =
                npm.positions(p.tokenId);

            uint8 d0 = IPUSDManager(pusdManager).decimalsOf(info.token0);
            uint8 d1 = IPUSDManager(pusdManager).decimalsOf(info.token1);

            if (liquidity > 0) {
                (uint256 a0, uint256 a1) = LiquidityAmounts.getAmountsForLiquidity(
                    sqrtPriceX96,
                    TickMath.getSqrtRatioAtTick(p.tickLower),
                    TickMath.getSqrtRatioAtTick(p.tickUpper),
                    liquidity
                );
                if (d0 > 0) gross += a0.toPUSD(d0);
                if (d1 > 0) gross += a1.toPUSD(d1);
            }
            if (d0 > 0 && owed0 > 0) gross += uint256(owed0).toPUSD(d0);
            if (d1 > 0 && owed1 > 0) gross += uint256(owed1).toPUSD(d1);
        }
    }

    /// @inheritdoc IPUSDLiquidity
    function idleBalance(address token) external view override returns (uint256) {
        if (!IPUSDManager(pusdManager).isSupportedStable(token)) return 0;
        return IERC20(token).balanceOf(address(this));
    }

    /// @inheritdoc IPUSDLiquidity
    function isPoolActive(address pool) external view override returns (bool) {
        PoolInfo storage info = poolInfo[pool];
        return info.registered && info.active;
    }

    /// @inheritdoc IPUSDLiquidity
    function poolsLength() external view override returns (uint256) {
        return pools.length;
    }

    /// @inheritdoc IPUSDLiquidity
    function poolAt(uint256 i) external view override returns (address) {
        require(i < pools.length, "PUSDLiquidity: index out of range");
        return pools[i];
    }

    function positionCount() external view returns (uint256) {
        return positions.length;
    }

    function activePositionCount() external view returns (uint256 n) {
        uint256 len = positions.length;
        for (uint256 i = 0; i < len; i++) {
            if (positions[i].active) n++;
        }
    }

    // =====================================================================
    //                       INTERNAL HELPERS — caps & positions
    // =====================================================================

    function _enforceDeployCap() internal view {
        if (pusdPlus == address(0)) return; // pre-wired during deploy; cap inactive until set
        if (IPUSDPlus(pusdPlus).pusdLiquidity() != address(this)) return;

        uint256 plusAssets = _readTotalAssets(pusdPlus);
        if (plusAssets == 0) return;

        // Cap is on TOTAL deployment (idle + positions + accrued fees) — not on net yield. Using
        // `netAssetsInPUSD` here would be a no-op now that NAV returns yield above principal.
        uint256 deployedLpClaim = _grossValueInPUSD();
        uint256 max = (uint256(maxDeployableBps) * plusAssets) / BASIS_POINTS;
        if (deployedLpClaim > max) revert DeployCapExceeded(deployedLpClaim, max);
    }

    function _readTotalAssets(address plus) internal view returns (uint256) {
        (bool ok, bytes memory data) = plus.staticcall(abi.encodeWithSignature("totalAssets()"));
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }

    function _getPositionMut(uint256 tokenId) internal view returns (Position storage p) {
        uint256 idx1 = positionByTokenId[tokenId];
        if (idx1 == 0) revert PositionNotFound();
        p = positions[idx1 - 1];
    }

    function _decreaseLiquidity(uint256 tokenId, uint128 liquidity)
        internal
        returns (uint256 amount0, uint256 amount1)
    {
        return npm.decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId:    tokenId,
                liquidity:  liquidity,
                amount0Min: 0,
                amount1Min: 0,
                deadline:   block.timestamp
            })
        );
    }

    function _collectFees(uint256 tokenId) internal returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = npm.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId:    tokenId,
                recipient:  address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        if (amount0 > 0 || amount1 > 0) {
            emit FeesCollected(tokenId, amount0, amount1);
        }
    }

    /// @dev Approximate the liquidity slice of `p` that would release roughly `tokenAmt` of `token`.
    function _liquidityForToken(
        Position storage p,
        PoolInfo storage info,
        address token,
        uint256 tokenAmt,
        uint128 totalLiquidity
    ) internal view returns (uint128) {
        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(p.pool).slot0();
        (uint256 a0, uint256 a1) = LiquidityAmounts.getAmountsForLiquidity(
            sqrtPriceX96,
            TickMath.getSqrtRatioAtTick(p.tickLower),
            TickMath.getSqrtRatioAtTick(p.tickUpper),
            totalLiquidity
        );
        uint256 totalOfToken = (token == info.token0) ? a0 : a1;
        if (totalOfToken == 0) return 0;
        uint256 fraction = (tokenAmt > totalOfToken)
            ? uint256(totalLiquidity)
            : (uint256(totalLiquidity) * tokenAmt) / totalOfToken;
        // Add a small over-shoot (1%) so we comfortably cover slippage and rounding.
        fraction = fraction + (fraction / 100);
        if (fraction > totalLiquidity) fraction = totalLiquidity;
        return uint128(fraction);
    }

    // =====================================================================
    //                       INTERNAL HELPERS — multi-hop routing
    // =====================================================================

    /// @dev Build a Uniswap-V3 path from `src` to `dst` with ≤2 hops over the active pool registry.
    function _findRoute(address src, address dst) internal view returns (bytes memory path, bool ok) {
        // Pass 1: 1-hop direct pool.
        uint256 plen = pools.length;
        for (uint256 i = 0; i < plen; i++) {
            address pool = pools[i];
            PoolInfo storage info = poolInfo[pool];
            if (!info.active) continue;
            if (
                (info.token0 == src && info.token1 == dst) ||
                (info.token1 == src && info.token0 == dst)
            ) {
                return (abi.encodePacked(src, info.fee, dst), true);
            }
        }

        // Pass 2: 2-hop via any mid token. Iterate pools that include `src` to discover candidate
        // mid tokens; for each, scan again for a pool that bridges (mid, dst).
        for (uint256 i = 0; i < plen; i++) {
            address poolA = pools[i];
            PoolInfo storage a = poolInfo[poolA];
            if (!a.active) continue;
            if (a.token0 != src && a.token1 != src) continue;
            address mid = (a.token0 == src) ? a.token1 : a.token0;
            if (mid == dst) continue; // already covered by pass 1

            for (uint256 j = 0; j < plen; j++) {
                if (j == i) continue;
                address poolB = pools[j];
                PoolInfo storage b = poolInfo[poolB];
                if (!b.active) continue;
                if (
                    (b.token0 == mid && b.token1 == dst) ||
                    (b.token1 == mid && b.token0 == dst)
                ) {
                    return (abi.encodePacked(src, a.fee, mid, b.fee, dst), true);
                }
            }
        }

        return (bytes(""), false);
    }

    function _hopCount(bytes memory path) internal pure returns (uint256) {
        // path = (token, fee, token)+ → length = 20 + (20+3)*hops; hops = (len - 20) / 23.
        return (path.length - 20) / 23;
    }

    /// @dev Convert `amount` of `aToken` into the same PUSD value expressed in `bToken` units,
    ///      assuming both peg to 1 USD. Both decimals are read from Manager.
    function _convertParity(uint256 amount, address aToken, address bToken)
        internal view returns (uint256)
    {
        uint8 da = IPUSDManager(pusdManager).decimalsOf(aToken);
        uint8 db = IPUSDManager(pusdManager).decimalsOf(bToken);
        if (da == db) return amount;
        if (da > db)  return amount / (10 ** (da - db));
        return amount * (10 ** (db - da));
    }

    /// @dev Compute amountOutMinimum that compounds per-hop slippage. Output decimals match `dst`.
    function _minOutForPath(
        uint256 amountIn,
        address src,
        address dst,
        uint256 hops
    ) internal view returns (uint256) {
        // Convert amountIn (in src units) to dst units at parity, then haircut by per-hop slippage.
        uint256 baseOut = _convertParity(amountIn, src, dst);
        uint256 keep = BASIS_POINTS;
        for (uint256 i = 0; i < hops; i++) {
            keep = (keep * (BASIS_POINTS - lpSwapSlippageBps)) / BASIS_POINTS;
        }
        return (baseOut * keep) / BASIS_POINTS;
    }

    function _exactInputPath(
        address src,
        bytes memory path,
        uint256 amountIn,
        uint256 minOut
    ) internal returns (uint256 out) {
        if (amountIn == 0) return 0;
        IERC20(src).forceApprove(address(router), amountIn);
        out = router.exactInput(
            ISwapRouter.ExactInputParams({
                path:             path,
                recipient:        address(this),
                deadline:         block.timestamp,
                amountIn:         amountIn,
                amountOutMinimum: minOut
            })
        );
        // Decode tokenOut from end of path for the event (last 20 bytes = lower 160 bits of the
        // 32-byte word that ends at path's last byte).
        address dst;
        uint256 plen = path.length;
        uint256 word;
        assembly { word := mload(add(path, plen)) }
        dst = address(uint160(word));
        emit Swapped(src, dst, amountIn, out);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}
}

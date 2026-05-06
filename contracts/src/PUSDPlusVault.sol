// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IPUSD.sol";
import "./interfaces/IPUSDManager.sol";
import "./interfaces/IInsuranceFund.sol";
import "./interfaces/INonfungiblePositionManager.sol";
import "./libraries/V3Math.sol";

/**
 * @title  PUSDPlusVault
 * @notice Yield-bearing companion to PUSD. PUSD+ is a 6-decimal ERC-20 with an
 *         accumulating exchange rate. NAV grows monotonically as the vault
 *         collects LP fees from Push Chain Uniswap V3 stable/stable pools that
 *         it bootstraps.
 *
 * @dev Invariants enforced by this contract (PUSD+ design doc, §2):
 *        I1. PUSD remains 1:1 backed — every reserve unit that leaves
 *            PUSDManager is matched by an equivalent PUSD burn. PUSD+ activity
 *            NEVER touches PUSD's mint/burn surface directly; the vault only
 *            uses the manager's deposit / redeem (fee-exempt) to convert
 *            between idle assets.
 *        I2. NAV is monotonic non-decreasing. No code path realises losses to
 *            NAV. Out-of-range positions are held; LP fees only accrue.
 *        I3. Reserves enter the vault only via user mint. Keeper has no path
 *            to pull from PUSDManager.
 *        I4. Vault is fee-exempt on PUSDManager. Only PUSDManager holds
 *            MANAGER_ROLE here.
 *        I5. Hard caps in code (revert if exceeded), not just governance norms:
 *              haircutBps        ≤  500 (5%)
 *              unwindCapBps      ∈ [100, 5000]
 *              maxDeploymentBps  ≤ 8500 (85%)
 *
 *      Storage layout — APPEND-ONLY for upgrades. Existing slots are never
 *      reordered or repurposed. New state goes at the bottom; verify with
 *      `forge inspect PUSDPlusVault storage-layout` before any upgrade.
 */
contract PUSDPlusVault is
    Initializable,
    ERC20Upgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // -- inline reentrancy guard (matches PUSDManager's pattern; OZ 5.x's
    //    ReentrancyGuardUpgradeable variant has been removed) -----------
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus;

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "Vault: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // =========================================================================
    // Roles
    // =========================================================================

    /// @notice Allowed to call mintPlus / burnPlus. Held by PUSDManager only.
    bytes32 public constant MANAGER_ROLE = keccak256("PUSDPLUS_MANAGER_ROLE");
    /// @notice Operational keeper bot — harvest, top-up, queue fulfilment.
    bytes32 public constant KEEPER_ROLE = keccak256("PUSDPLUS_KEEPER_ROLE");
    /// @notice Multisig — opens / closes pools, sets tick ranges, manages basket.
    bytes32 public constant POOL_ADMIN_ROLE = keccak256("PUSDPLUS_POOL_ADMIN_ROLE");
    /// @notice Multisig — vault knobs (haircut, unwind cap, defaults, IF address).
    bytes32 public constant VAULT_ADMIN_ROLE = keccak256("PUSDPLUS_VAULT_ADMIN_ROLE");
    /// @notice Pause-only multisig. Cannot unpause; that requires DEFAULT_ADMIN.
    bytes32 public constant GUARDIAN_ROLE = keccak256("PUSDPLUS_GUARDIAN_ROLE");

    // =========================================================================
    // Hard caps (enforced in setter bodies — do NOT relax)
    // =========================================================================

    uint16 public constant MAX_HAIRCUT_BPS = 500; // 5%
    uint16 public constant MIN_UNWIND_CAP_BPS = 100; // 1%
    uint16 public constant MAX_UNWIND_CAP_BPS = 5000; // 50%
    uint16 public constant MAX_DEPLOYMENT_CAP_BPS = 8500; // 85%
    uint32 public constant MAX_REBALANCE_COOLDOWN = 24 hours; // v2.1
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant NAV_PRECISION = 1e18;

    // =========================================================================
    // External dependencies (set once in initializer; immutable in spirit)
    // =========================================================================

    IPUSD public pusd;
    IPUSDManager public manager;
    INonfungiblePositionManager public positionManager;
    IUniswapV3Factory public v3Factory;

    // =========================================================================
    // Configuration (VAULT_ADMIN-managed, hard-capped)
    // =========================================================================

    uint16 public haircutBps; // applied to LP fee accrual on harvest
    uint16 public unwindCapBps; // share of deployed value redeemable per tx
    uint16 public maxDeploymentBps; // soft cap — keeper holds idle past this
    uint256 public minBootstrapSize; // min idle per side to auto-open a pool (6-dec)
    uint256 public topUpThreshold; // idle threshold per token to trigger top-up
    uint256 public instantFloorPusd; // small redeems never throttled (6-dec PUSD)

    uint24 public defaultFeeTier; // 500 = 0.05% (phase 1) | 100 = 0.01% (phase 2)
    int24 public defaultTickLower; // signed; e.g. -20 ≈ 0.998
    int24 public defaultTickUpper; // signed; e.g. +20 ≈ 1.002

    address public insuranceFund;

    /// @notice Fee tiers approved for auto-open. Phase 1 launches with only 500.
    mapping(uint24 => bool) public feeTierAllowed;

    /// @notice Basket — reserve tokens the vault is permitted to LP. POOL_ADMIN-managed.
    mapping(address => bool) public inBasket;
    address[] public basket;

    // =========================================================================
    // Position registry
    // =========================================================================

    /// @notice V3 NPM tokenIds the vault holds. Mirrored from on-NPM ownership;
    ///         we keep a flat array so the keeper can iterate without external indexers.
    uint256[] public positionIds;
    /// @notice tokenId → index+1 in positionIds (0 = not present).
    mapping(uint256 => uint256) internal positionIndexPlus1;

    // =========================================================================
    // Redemption queue
    // =========================================================================

    /// @dev burn-and-fill: PUSD+ already burned at queue time; user accepts NAV
    ///       at queue time. Vault fills from incoming reserves on subsequent
    ///       rebalances.
    struct QueueEntry {
        address recipient;
        address preferredAsset; // address(pusd) for PUSD payout
        bool allowBasket;
        uint128 pusdOwed; // 6-dec PUSD remaining
        uint64 queuedAt; // block.timestamp
    }

    mapping(uint256 => QueueEntry) public queue;
    uint256 public nextQueueId; // monotonic id, 1-indexed (0 = none)
    uint256 public totalQueuedPusd; // sum over open entries

    // =========================================================================
    // Events
    // =========================================================================

    event MintedPlus(address indexed recipient, uint256 pusdIn, uint256 plusOut, uint256 navE18);
    event BurnedPlus(address indexed from, uint256 plusIn, uint256 pusdOwed, uint256 pusdReturned, uint256 queueId);
    event QueueClaimFilled(uint256 indexed queueId, address indexed recipient, uint256 pusdAmount, address asset);
    event Harvested(uint256 indexed positionId, uint256 amount0, uint256 amount1);
    event HaircutApplied(address indexed token, uint256 amount, address indexed insuranceFund);
    event PositionOpened(
        uint256 indexed positionId,
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    );
    event PositionClosed(uint256 indexed positionId);
    event PositionToppedUp(uint256 indexed positionId, uint128 addedLiquidity);
    event PusdRedeemedForToken(address indexed token, uint256 pusdIn, uint256 tokenOut);
    event BasketTokenSet(address indexed token, bool inBasket);
    event ConfigUpdated(bytes32 indexed key, uint256 oldVal, uint256 newVal);
    event AddressUpdated(bytes32 indexed key, address oldVal, address newVal);
    event Rebalanced(uint256 timestamp, uint256 navE18);

    // =========================================================================
    // Errors
    // =========================================================================

    error Vault_ZeroAddress();
    error Vault_ZeroAmount();
    error Vault_NotInBasket(address token);
    error Vault_NotABasketPair(address token0, address token1);
    error Vault_FeeTierNotAllowed(uint24 fee);
    error Vault_HaircutTooHigh(uint16 bps);
    error Vault_UnwindCapOOR(uint16 bps);
    error Vault_DeploymentCapTooHigh(uint16 bps);
    error Vault_InvalidTickRange(int24 lower, int24 upper);
    error Vault_PositionNotOwned(uint256 tokenId);
    error Vault_QueueAlreadyFilled(uint256 queueId);
    error Vault_QueueUnderfunded(uint256 queueId, uint256 have, uint256 need);
    error Vault_NavZero();
    error Vault_BootstrapZeroSupply();
    error Vault_RebalanceCooldown(uint256 nextAllowedAt);
    error Vault_CooldownTooLong(uint32 cooldown);

    // =========================================================================
    // v2.1 — permissionless rebalance state (packs into one slot)
    // =========================================================================

    /// @notice Block timestamp of the most recent rebalance call. Updated by
    ///         both KEEPER calls and public calls.
    uint32 public lastRebalanceAt;
    /// @notice Minimum elapsed time between public (non-KEEPER) rebalance calls.
    ///         KEEPER bypasses this entirely. VAULT_ADMIN-settable; capped at
    ///         MAX_REBALANCE_COOLDOWN (24h) to prevent governance from making
    ///         the function permissioned-by-stealth.
    uint32 public publicRebalanceCooldown;

    // =========================================================================
    // Storage gap — reserve slots for future versions without colliding.
    //               v2.1: __gap[40] → __gap[39] after consuming one slot for
    //               (lastRebalanceAt, publicRebalanceCooldown) packed.
    // =========================================================================

    uint256[39] private __gap;

    // =========================================================================
    // Constructor / initializer
    // =========================================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initialiser. Called inside the proxy via timelock.
    /// @dev    Hard-capped defaults are NOT set here — the atomic deploy
    ///         proposal (DeployPUSD.v2.s.sol) sets them post-construction.
    function initialize(address admin, address _pusd, address _manager, address _positionManager, address _v3Factory)
        external
        initializer
    {
        if (
            admin == address(0) || _pusd == address(0) || _manager == address(0) || _positionManager == address(0)
                || _v3Factory == address(0)
        ) revert Vault_ZeroAddress();

        __ERC20_init("PUSD Plus", "PUSD+");
        __AccessControl_init();
        __Pausable_init();

        _reentrancyStatus = _NOT_ENTERED;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        pusd = IPUSD(_pusd);
        manager = IPUSDManager(_manager);
        positionManager = INonfungiblePositionManager(_positionManager);
        v3Factory = IUniswapV3Factory(_v3Factory);

        // Conservative pre-launch defaults; atomic timelock proposal overrides.
        haircutBps = 200; // 2%
        unwindCapBps = 500; // 5%
        maxDeploymentBps = 7000; // 70%
        defaultFeeTier = 500; // 0.05%
        feeTierAllowed[500] = true;
        defaultTickLower = -20;
        defaultTickUpper = 20;
        publicRebalanceCooldown = 1 hours; // v2.1 default; tunable up to MAX_REBALANCE_COOLDOWN
        lastRebalanceAt = uint32(block.timestamp); // start cooldown clock at deploy
    }

    /// @inheritdoc ERC20Upgradeable
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // =========================================================================
    // ERC4626-style NAV math
    // =========================================================================

    /// @notice Live NAV per PUSD+ in 1e18 fixed-point. Returns 1e18 when supply is 0.
    function nav() public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return NAV_PRECISION;
        uint256 ta = totalAssets();
        return (ta * NAV_PRECISION) / supply;
    }

    /// @notice Total backing assets in 6-decimal PUSD-equivalent units.
    /// @dev    idle reserves (each at $1, peg assertion §4) + sum of position values.
    function totalAssets() public view returns (uint256) {
        return idleReservesPusd() + totalPositionsValuePusd();
    }

    /// @notice Sum of vault idle balances across PUSD + every basket token, $1=1 PUSD.
    function idleReservesPusd() public view returns (uint256 sum) {
        sum += pusd.balanceOf(address(this));
        uint256 n = basket.length;
        for (uint256 i; i < n; ++i) {
            sum += IERC20(basket[i]).balanceOf(address(this));
        }
    }

    /// @notice Sum of (position underlying + uncollected fees) over all owned positions.
    function totalPositionsValuePusd() public view returns (uint256 sum) {
        uint256 n = positionIds.length;
        for (uint256 i; i < n; ++i) {
            sum += getPositionValuePusd(positionIds[i]);
        }
    }

    /// @notice One position's value in PUSD-equivalent units.
    /// @dev    Stable/stable peg assertion: amount0 + amount1 + fees0 + fees1, treated $1=1.
    function getPositionValuePusd(uint256 tokenId) public view returns (uint256) {
        (
            ,,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,,,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        ) = positionManager.positions(tokenId);

        uint256 amount0;
        uint256 amount1;
        if (liquidity > 0) {
            address pool = v3Factory.getPool(token0, token1, fee);
            if (pool != address(0)) {
                (uint160 sqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
                (amount0, amount1) = V3Math.getAmountsForLiquidity(
                    sqrtPriceX96, V3Math.getSqrtRatioAtTick(tickLower), V3Math.getSqrtRatioAtTick(tickUpper), liquidity
                );
            }
        }
        return amount0 + amount1 + uint256(tokensOwed0) + uint256(tokensOwed1);
    }

    /// @notice Quote PUSD+ minted for `pusdIn`.
    function previewMintPlus(uint256 pusdIn) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return pusdIn; // bootstrap: 1:1
        uint256 ta = totalAssets();
        if (ta == 0) revert Vault_NavZero();
        return (pusdIn * supply) / ta;
    }

    /// @notice Quote PUSD owed for `plusIn` PUSD+.
    function previewBurnPlus(uint256 plusIn) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) revert Vault_BootstrapZeroSupply();
        return (plusIn * totalAssets()) / supply;
    }

    // =========================================================================
    // PUSDManager-facing surface
    // =========================================================================

    /// @notice Mint PUSD+ to `recipient` at the **pre-deposit** NAV.
    /// @dev    PUSDManager MUST have transferred `pusdIn` of PUSD into this
    ///         contract atomically before this call. Because `totalAssets()`
    ///         already includes that PUSD, we back it out when computing
    ///         shares so the depositor isn't credited at a NAV inflated by
    ///         their own deposit. Reverts if msg.sender lacks MANAGER_ROLE.
    function mintPlus(uint256 pusdIn, address recipient)
        external
        nonReentrant
        whenNotPaused
        onlyRole(MANAGER_ROLE)
        returns (uint256 plusOut)
    {
        if (pusdIn == 0) revert Vault_ZeroAmount();
        if (recipient == address(0)) revert Vault_ZeroAddress();

        uint256 supply = totalSupply();
        if (supply == 0) {
            plusOut = pusdIn; // bootstrap mint at NAV = 1
        } else {
            uint256 ta = totalAssets();
            require(ta >= pusdIn, "Vault: pusdIn exceeds totalAssets");
            // pusdIn is already in the vault — price using pre-deposit NAV.
            plusOut = (pusdIn * supply) / (ta - pusdIn);
        }
        if (plusOut == 0) revert Vault_ZeroAmount();
        _mint(recipient, plusOut);

        emit MintedPlus(recipient, pusdIn, plusOut, nav());
    }

    /// @notice Burn `plusIn` PUSD+ from `from`, return PUSD to `pusdRecipient`.
    /// @dev    Three-tier fulfilment (§8):
    ///           tier 1 (instant): vault has idle PUSD ≥ pusdOwed → ship.
    ///           tier 2 (convert): idle PUSD short, convert idle non-PUSD → PUSD
    ///                              via fee-exempt manager.deposit. No peg risk.
    ///           tier 3 (queue):    residual is enqueued; PUSD+ already burned,
    ///                              NAV fixed at this block. Keeper fills on
    ///                              rebalance.
    ///         LP unwind during user redeem is intentionally NOT done in v0 —
    ///         keeper drains LP into idle on rebalance, then queue gets filled.
    function burnPlus(uint256 plusIn, address from, address pusdRecipient, address preferredAsset, bool allowBasket)
        external
        nonReentrant
        whenNotPaused
        onlyRole(MANAGER_ROLE)
        returns (uint256 pusdReturned, uint256 queueId)
    {
        if (plusIn == 0) revert Vault_ZeroAmount();
        if (from == address(0) || pusdRecipient == address(0)) revert Vault_ZeroAddress();

        uint256 pusdOwed = previewBurnPlus(plusIn);
        _burn(from, plusIn); // commit user to entry-NAV

        // Tier 1 + tier 2 — try to source PUSD up to pusdOwed.
        // v2.1: pass preferredAsset so vault drains the asset the user
        //       requested first; manager's preferred-payout path then succeeds
        //       without basket fallback in the common case.
        uint256 idlePusd = pusd.balanceOf(address(this));
        if (idlePusd < pusdOwed) {
            _convertIdleReservesToPusd(pusdOwed - idlePusd, preferredAsset);
            idlePusd = pusd.balanceOf(address(this));
        }

        if (idlePusd >= pusdOwed) {
            IERC20(address(pusd)).safeTransfer(pusdRecipient, pusdOwed);
            pusdReturned = pusdOwed;
        } else {
            if (idlePusd > 0) {
                IERC20(address(pusd)).safeTransfer(pusdRecipient, idlePusd);
                pusdReturned = idlePusd;
            }
            uint256 residual = pusdOwed - pusdReturned;
            queueId = ++nextQueueId;
            // Queue records the END USER (`from`), not `pusdRecipient` —
            // pusdRecipient is the manager in the v2 compose flow. When
            // fulfillQueueClaim runs later it must pay the final user
            // directly (in their preferredAsset), not loop back through
            // the manager.
            queue[queueId] = QueueEntry({
                recipient: from,
                preferredAsset: preferredAsset,
                allowBasket: allowBasket,
                pusdOwed: uint128(residual),
                queuedAt: uint64(block.timestamp)
            });
            totalQueuedPusd += residual;
        }

        emit BurnedPlus(from, plusIn, pusdOwed, pusdReturned, queueId);
    }

    /// @dev Walks the basket — for each non-PUSD idle balance, sends it through
    ///      the manager's vault-only deposit path so PUSD is minted back to this
    ///      contract. Stops once `target` PUSD has been raised. Each conversion
    ///      step strictly preserves total PUSD-equivalent value (1:1 by manager
    ///      invariant) and skips both the manager's reentrancy lock and surplus
    ///      haircut — see PUSDManager.depositForVault.
    ///
    ///      v2.1 — `preferred` is drained first when set, so the manager ends
    ///      up holding the asset the caller asked for and can pay out via the
    ///      preferred branch on `_payoutToUser`. Falls back to basket order
    ///      for any residual.
    function _convertIdleReservesToPusd(uint256 target, address preferred) internal {
        if (target == 0) return;
        uint256 raised;

        // 1. Prefer the user's requested asset first (when applicable).
        if (preferred != address(0) && preferred != address(pusd) && inBasket[preferred]) {
            uint256 bal = IERC20(preferred).balanceOf(address(this));
            if (bal > 0) {
                uint256 take = target < bal ? target : bal;
                IERC20(preferred).forceApprove(address(manager), take);
                raised += manager.depositForVault(preferred, take);
            }
        }

        // 2. Fall back to basket order for any remaining target.
        uint256 n = basket.length;
        for (uint256 i; i < n && raised < target; ++i) {
            address tk = basket[i];
            if (tk == preferred) continue; // already drained above
            uint256 bal = IERC20(tk).balanceOf(address(this));
            if (bal == 0) continue;
            uint256 take = (target - raised) < bal ? (target - raised) : bal;

            IERC20(tk).forceApprove(address(manager), take);
            raised += manager.depositForVault(tk, take);
        }
    }

    // =========================================================================
    // Queue fulfilment — anyone can call once vault has the PUSD on hand.
    // Keeper will normally call this immediately after rebalance.
    // =========================================================================

    function fulfillQueueClaim(uint256 queueId) external nonReentrant whenNotPaused {
        QueueEntry memory q = queue[queueId];
        if (q.pusdOwed == 0) revert Vault_QueueAlreadyFilled(queueId);

        uint256 idlePusd = pusd.balanceOf(address(this));
        if (idlePusd < q.pusdOwed) {
            // v2.1: forward the queued entry's preferredAsset so conversion
            //       targets it first — keeps end-to-end coherent across queue.
            _convertIdleReservesToPusd(uint256(q.pusdOwed) - idlePusd, q.preferredAsset);
            idlePusd = pusd.balanceOf(address(this));
        }
        if (idlePusd < q.pusdOwed) revert Vault_QueueUnderfunded(queueId, idlePusd, q.pusdOwed);

        if (q.preferredAsset == address(pusd)) {
            IERC20(address(pusd)).safeTransfer(q.recipient, q.pusdOwed);
        } else {
            IERC20(address(pusd)).forceApprove(address(manager), q.pusdOwed);
            manager.redeem(q.pusdOwed, q.preferredAsset, q.allowBasket, q.recipient);
        }

        totalQueuedPusd -= q.pusdOwed;
        delete queue[queueId];

        emit QueueClaimFilled(queueId, q.recipient, q.pusdOwed, q.preferredAsset);
    }

    // =========================================================================
    // Keeper — daily rebalance routine (§6)
    // =========================================================================

    /// @notice Keeper-or-public rebalance — harvest fees from every owned
    ///         position and apply haircut. Off-chain keeper logic decides
    ///         which positions to top up or open; this function performs only
    ///         the deterministic onchain side. Idempotent: positions with no
    ///         fees emit zero amounts.
    /// @dev    Steps 1 + 2 of design doc §6. Steps 3–7 (NAV recompute,
    ///         deployment ratio gate, auto-open, top-up, out-of-range
    ///         handling) are computed off-chain by the keeper, which then
    ///         calls openPool / topUpPosition / closePool with concrete
    ///         parameters under POOL_ADMIN_ROLE.
    ///
    ///         v2.1 permissioning: KEEPER_ROLE may call at any time (no
    ///         cooldown). Anyone else may call once
    ///         `block.timestamp >= lastRebalanceAt + publicRebalanceCooldown`.
    ///         The public path keeps the protocol live if the designated
    ///         keeper goes offline; the cooldown deters spam.
    function rebalance() external nonReentrant whenNotPaused {
        _enforceRebalanceCooldown();

        uint256 n = positionIds.length;
        for (uint256 i; i < n; ++i) {
            uint256 tokenId = positionIds[i];
            (uint256 a0, uint256 a1) = positionManager.collect(
                INonfungiblePositionManager.CollectParams({
                    tokenId: tokenId,
                    recipient: address(this),
                    amount0Max: type(uint128).max,
                    amount1Max: type(uint128).max
                })
            );
            emit Harvested(tokenId, a0, a1);
            (,, address token0, address token1,,,,,,,,) = positionManager.positions(tokenId);
            if (a0 > 0) _haircut(token0, a0);
            if (a1 > 0) _haircut(token1, a1);
        }
        lastRebalanceAt = uint32(block.timestamp);
        emit Rebalanced(block.timestamp, nav());
    }

    /// @notice Bounded variant of rebalance — harvests positionIds[startIdx .. startIdx+count).
    /// @dev    Same per-position semantics as `rebalance`. Same v2.1
    ///         permissioning: KEEPER bypasses cooldown; public callers must
    ///         wait `publicRebalanceCooldown` since the last rebalance call.
    function rebalanceBatch(uint256 startIdx, uint256 count) external nonReentrant whenNotPaused {
        _enforceRebalanceCooldown();

        uint256 n = positionIds.length;
        require(startIdx < n, "Vault: startIdx out of range");
        uint256 end = startIdx + count;
        if (end > n) end = n;
        for (uint256 i = startIdx; i < end; ++i) {
            uint256 tokenId = positionIds[i];
            (uint256 a0, uint256 a1) = positionManager.collect(
                INonfungiblePositionManager.CollectParams({
                    tokenId: tokenId,
                    recipient: address(this),
                    amount0Max: type(uint128).max,
                    amount1Max: type(uint128).max
                })
            );
            emit Harvested(tokenId, a0, a1);
            (,, address token0, address token1,,,,,,,,) = positionManager.positions(tokenId);
            if (a0 > 0) _haircut(token0, a0);
            if (a1 > 0) _haircut(token1, a1);
        }
        lastRebalanceAt = uint32(block.timestamp);
        emit Rebalanced(block.timestamp, nav());
    }

    /// @dev v2.1 — gate non-keeper rebalance callers behind a cooldown so the
    ///      function can be permissionless without enabling block-by-block
    ///      spam. Caller pays own gas regardless; cooldown removes the
    ///      timing-game incentive.
    function _enforceRebalanceCooldown() internal view {
        if (hasRole(KEEPER_ROLE, msg.sender)) return;
        uint256 nextAllowed = uint256(lastRebalanceAt) + uint256(publicRebalanceCooldown);
        if (block.timestamp < nextAllowed) revert Vault_RebalanceCooldown(nextAllowed);
    }

    /// @dev Sends `haircutBps × amount` of `token` to the insurance fund. The
    ///      remainder stays in the vault as idle reserve and accrues into NAV.
    function _haircut(address token, uint256 amount) internal {
        if (insuranceFund == address(0)) return;
        uint256 cut = (amount * haircutBps) / BPS_DENOMINATOR;
        if (cut == 0) return;
        IERC20(token).safeTransfer(insuranceFund, cut);
        try IInsuranceFund(insuranceFund).notifyDeposit(token, cut) {} catch {}
        emit HaircutApplied(token, cut, insuranceFund);
    }

    // =========================================================================
    // POOL_ADMIN — open / close pools, manage basket
    // =========================================================================

    /// @notice Open a new V3 LP position. POOL_ADMIN-only — pre-seed at deploy
    ///         and strategic adjustments. KEEPER also holds POOL_ADMIN by
    ///         convention to auto-open during rebalance once the basket-pair
    ///         idle threshold is met.
    function openPool(INonfungiblePositionManager.MintParams calldata p)
        external
        nonReentrant
        whenNotPaused
        onlyRole(POOL_ADMIN_ROLE)
        returns (uint256 tokenId, uint128 liquidity)
    {
        if (!inBasket[p.token0] || !inBasket[p.token1]) revert Vault_NotABasketPair(p.token0, p.token1);
        if (!feeTierAllowed[p.fee]) revert Vault_FeeTierNotAllowed(p.fee);
        if (p.tickLower >= p.tickUpper) revert Vault_InvalidTickRange(p.tickLower, p.tickUpper);
        if (p.recipient != address(this)) revert Vault_ZeroAddress();

        IERC20(p.token0).forceApprove(address(positionManager), p.amount0Desired);
        IERC20(p.token1).forceApprove(address(positionManager), p.amount1Desired);

        (tokenId, liquidity,,) = positionManager.mint(p);
        positionIds.push(tokenId);
        positionIndexPlus1[tokenId] = positionIds.length;

        emit PositionOpened(tokenId, p.token0, p.token1, p.fee, p.tickLower, p.tickUpper, liquidity);
    }

    /// @notice Drain liquidity, collect fees, NPM-burn, drop from registry.
    ///         POOL_ADMIN-only; intended for delistings / emergency closures.
    function closePool(uint256 tokenId, uint256 amount0Min, uint256 amount1Min, uint256 deadline)
        external
        nonReentrant
        whenNotPaused
        onlyRole(POOL_ADMIN_ROLE)
    {
        uint256 idxPlus1 = positionIndexPlus1[tokenId];
        if (idxPlus1 == 0) revert Vault_PositionNotOwned(tokenId);

        (,,,,,,, uint128 liquidity,,,,) = positionManager.positions(tokenId);
        if (liquidity > 0) {
            positionManager.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: tokenId,
                    liquidity: liquidity,
                    amount0Min: amount0Min,
                    amount1Min: amount1Min,
                    deadline: deadline
                })
            );
        }
        positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId, recipient: address(this), amount0Max: type(uint128).max, amount1Max: type(uint128).max
            })
        );
        positionManager.burn(tokenId);

        // swap-and-pop in registry
        uint256 lastIdx = positionIds.length - 1;
        uint256 thisIdx = idxPlus1 - 1;
        if (thisIdx != lastIdx) {
            uint256 lastId = positionIds[lastIdx];
            positionIds[thisIdx] = lastId;
            positionIndexPlus1[lastId] = thisIdx + 1;
        }
        positionIds.pop();
        delete positionIndexPlus1[tokenId];

        emit PositionClosed(tokenId);
    }

    /// @notice Increase liquidity on an existing position. KEEPER-only — top-up
    ///         during rebalance when idle of either underlying exceeds the
    ///         topUpThreshold.
    function topUpPosition(
        uint256 tokenId,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external nonReentrant whenNotPaused onlyRole(KEEPER_ROLE) returns (uint128 added) {
        if (positionIndexPlus1[tokenId] == 0) revert Vault_PositionNotOwned(tokenId);
        (,, address token0, address token1,,,,,,,,) = positionManager.positions(tokenId);

        // Enforce deployment cap before adding more LP exposure.
        uint256 ta = totalAssets();
        if (ta != 0) {
            uint256 deployed = totalPositionsValuePusd() + amount0Desired + amount1Desired;
            require(deployed * BPS_DENOMINATOR <= ta * uint256(maxDeploymentBps), "Vault: deployment cap");
        }

        IERC20(token0).forceApprove(address(positionManager), amount0Desired);
        IERC20(token1).forceApprove(address(positionManager), amount1Desired);

        (added,,) = positionManager.increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: tokenId,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                deadline: deadline
            })
        );
        emit PositionToppedUp(tokenId, added);
    }

    /// @notice POOL_ADMIN/KEEPER: convert vault-held PUSD into a basket reserve token.
    ///         Used to seed basket inventory before opening pools or topping up.
    /// @dev    Vault is fee-exempt on PUSDManager — see PUSDManager.redeem v2 fee-exempt branch.
    function redeemPusdForToken(uint256 pusdIn, address token)
        external
        nonReentrant
        whenNotPaused
        onlyRole(KEEPER_ROLE)
        returns (uint256 tokenOutDelta)
    {
        if (!inBasket[token]) revert Vault_NotInBasket(token);
        if (pusdIn == 0) revert Vault_ZeroAmount();

        uint256 pre = IERC20(token).balanceOf(address(this));
        IERC20(address(pusd)).forceApprove(address(manager), pusdIn);
        manager.redeem(pusdIn, token, true, address(this));
        tokenOutDelta = IERC20(token).balanceOf(address(this)) - pre;

        emit PusdRedeemedForToken(token, pusdIn, tokenOutDelta);
    }

    /// @notice Add a token to the LP basket. POOL_ADMIN-only.
    function addBasketToken(address token) external onlyRole(POOL_ADMIN_ROLE) {
        if (token == address(0)) revert Vault_ZeroAddress();
        if (!inBasket[token]) {
            inBasket[token] = true;
            basket.push(token);
            emit BasketTokenSet(token, true);
        }
    }

    /// @notice Remove a token from the LP basket. Doesn't close existing
    ///         positions — use closePool for those. Subsequent auto-open won't
    ///         pick this token.
    function removeBasketToken(address token) external onlyRole(POOL_ADMIN_ROLE) {
        if (!inBasket[token]) return;
        inBasket[token] = false;
        uint256 n = basket.length;
        for (uint256 i; i < n; ++i) {
            if (basket[i] == token) {
                basket[i] = basket[n - 1];
                basket.pop();
                break;
            }
        }
        emit BasketTokenSet(token, false);
    }

    function basketLength() external view returns (uint256) {
        return basket.length;
    }

    function positionsLength() external view returns (uint256) {
        return positionIds.length;
    }

    // =========================================================================
    // VAULT_ADMIN — knobs (HARD CAPS enforced in body)
    // =========================================================================

    function setHaircutBps(uint16 bps) external onlyRole(VAULT_ADMIN_ROLE) {
        if (bps > MAX_HAIRCUT_BPS) revert Vault_HaircutTooHigh(bps);
        emit ConfigUpdated("haircutBps", haircutBps, bps);
        haircutBps = bps;
    }

    function setUnwindCapBps(uint16 bps) external onlyRole(VAULT_ADMIN_ROLE) {
        if (bps < MIN_UNWIND_CAP_BPS || bps > MAX_UNWIND_CAP_BPS) revert Vault_UnwindCapOOR(bps);
        emit ConfigUpdated("unwindCapBps", unwindCapBps, bps);
        unwindCapBps = bps;
    }

    function setMaxDeploymentBps(uint16 bps) external onlyRole(VAULT_ADMIN_ROLE) {
        if (bps > MAX_DEPLOYMENT_CAP_BPS) revert Vault_DeploymentCapTooHigh(bps);
        emit ConfigUpdated("maxDeploymentBps", maxDeploymentBps, bps);
        maxDeploymentBps = bps;
    }

    function setMinBootstrapSize(uint256 size) external onlyRole(VAULT_ADMIN_ROLE) {
        emit ConfigUpdated("minBootstrapSize", minBootstrapSize, size);
        minBootstrapSize = size;
    }

    function setTopUpThreshold(uint256 size) external onlyRole(VAULT_ADMIN_ROLE) {
        emit ConfigUpdated("topUpThreshold", topUpThreshold, size);
        topUpThreshold = size;
    }

    function setInstantFloorPusd(uint256 floor_) external onlyRole(VAULT_ADMIN_ROLE) {
        emit ConfigUpdated("instantFloorPusd", instantFloorPusd, floor_);
        instantFloorPusd = floor_;
    }

    function setDefaultFeeTier(uint24 fee) external onlyRole(VAULT_ADMIN_ROLE) {
        if (!feeTierAllowed[fee]) revert Vault_FeeTierNotAllowed(fee);
        emit ConfigUpdated("defaultFeeTier", defaultFeeTier, fee);
        defaultFeeTier = fee;
    }

    function setDefaultTickRange(int24 lower, int24 upper) external onlyRole(VAULT_ADMIN_ROLE) {
        if (lower >= upper) revert Vault_InvalidTickRange(lower, upper);
        emit ConfigUpdated("defaultTickLower", uint256(int256(defaultTickLower)), uint256(int256(lower)));
        emit ConfigUpdated("defaultTickUpper", uint256(int256(defaultTickUpper)), uint256(int256(upper)));
        defaultTickLower = lower;
        defaultTickUpper = upper;
    }

    function setFeeTierAllowed(uint24 fee, bool allowed) external onlyRole(VAULT_ADMIN_ROLE) {
        feeTierAllowed[fee] = allowed;
        emit ConfigUpdated("feeTierAllowed", uint256(fee), allowed ? 1 : 0);
    }

    function setInsuranceFund(address fund) external onlyRole(VAULT_ADMIN_ROLE) {
        if (fund == address(0)) revert Vault_ZeroAddress();
        emit AddressUpdated("insuranceFund", insuranceFund, fund);
        insuranceFund = fund;
    }

    /// @notice v2.1 — adjust the cooldown that gates non-KEEPER `rebalance`
    ///         callers. Cap MAX_REBALANCE_COOLDOWN (24h) prevents governance
    ///         from making the function permissioned-by-stealth.
    function setPublicRebalanceCooldown(uint32 cooldown) external onlyRole(VAULT_ADMIN_ROLE) {
        if (cooldown > MAX_REBALANCE_COOLDOWN) revert Vault_CooldownTooLong(cooldown);
        emit ConfigUpdated("publicRebalanceCooldown", uint256(publicRebalanceCooldown), uint256(cooldown));
        publicRebalanceCooldown = cooldown;
    }

    // =========================================================================
    // GUARDIAN — pause-only
    // =========================================================================

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/IPUSDManager.sol";
import "./interfaces/IPUSDLiquidity.sol";
import "./interfaces/IPUSDPlus.sol";

/**
 * @title PUSDPlus (PUSD+)
 * @notice ERC-4626 yield-bearing wrapper over PUSD. Holders earn the LP fee yield reported
 *         by `PUSDLiquidity` through monotonic-non-decreasing share-price growth.
 * @dev    UUPS proxy. Underlying asset is PUSD (6 decimals). Shares are 18 decimals
 *         (ERC-4626 convention). `_decimalsOffset() = 6` shuts down the inflation attack.
 *
 *         totalAssets = PUSD.balanceOf(this) + PUSDLiquidity.netAssetsInPUSD()
 *
 *         A high-water-mark performance fee (default 10%, max 20%) is crystallised on every
 *         state-mutating user call: when totalAssets exceeds the HWM, the delta is fee'd and
 *         minted as PUSD+ shares to `performanceFeeRecipient` at the current share price (so
 *         existing holders are not diluted at crystallisation). The HWM only ratchets up.
 *
 *         pps = totalAssets * 1e18 / totalSupply  must satisfy `pps >= 1e18` (I-01b).
 */
contract PUSDPlus is
    Initializable,
    ERC20Upgradeable,
    ERC4626Upgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IPUSDPlus
{
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant LIQUIDITY_ROLE = keccak256("LIQUIDITY_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------
    uint16 public constant MAX_PERFORMANCE_FEE_BPS = 2000; // 20%
    uint256 private constant BASIS_POINTS = 10000;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------
    /// @inheritdoc IPUSDPlus
    address public override pusdManager;
    /// @inheritdoc IPUSDPlus
    address public override pusdLiquidity;

    uint16  public performanceFeeBps;          // launch 1000 = 10%
    address public performanceFeeRecipient;
    uint256 public highWaterMarkPUSD;          // last seen totalAssets at crystallisation

    uint256 private _status;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event PerformanceFeeCrystallised(uint256 deltaPUSD, uint256 feeShares, uint256 newHighWaterMark);
    event PerformanceFeeBpsSet(uint16 oldBps, uint16 newBps);
    event PerformanceFeeRecipientSet(address indexed oldR, address indexed newR);
    event PUSDLiquiditySet(address indexed oldLiquidity, address indexed newLiquidity);
    event StableDeposited(address indexed sender, address indexed token, uint256 tokenAmount, uint256 pusdMinted, uint256 shares, address indexed receiver);
    event StableRedeemed(address indexed sender, address indexed token, uint256 shares, uint256 pusdBurned, uint256 tokenOut, address indexed receiver);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------
    error PerformanceFeeTooHigh(uint16 requested, uint16 cap);
    error ZeroAddress();
    error ZeroAmount();

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
        address pusd,
        address manager,
        address admin,
        address feeRecipient
    ) public initializer {
        if (pusd == address(0) || manager == address(0) || admin == address(0) || feeRecipient == address(0)) {
            revert ZeroAddress();
        }

        __ERC20_init("Push USD Plus", "PUSD+");
        __ERC4626_init(IERC20(pusd));
        __AccessControl_init();
        __Pausable_init();

        pusdManager = manager;
        performanceFeeRecipient = feeRecipient;
        performanceFeeBps = 1000; // 10%
        _status = _NOT_ENTERED;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    // =====================================================================
    //                    ERC-4626 / ERC-20 plumbing
    // =====================================================================

    /// @dev Decimals = underlying (6) + offset (6) = 12 effective; OZ requires this signature.
    function decimals() public view override(ERC20Upgradeable, ERC4626Upgradeable) returns (uint8) {
        return ERC4626Upgradeable.decimals();
    }

    /// @dev Inflation-attack hardening: virtual shares scaled by 10**6.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    /// @notice Total PUSD assets backing the vault — held PUSD + PUSD-equivalent claim on Liquidity.
    function totalAssets() public view override returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (pusdLiquidity == address(0)) return idle;
        uint256 claim = IPUSDLiquidity(pusdLiquidity).netAssetsInPUSD();
        return idle + claim;
    }

    // =====================================================================
    //                      Convenience entrypoints (stable in / out)
    // =====================================================================

    /// @inheritdoc IPUSDPlus
    function depositStable(address token, uint256 amount, address receiver)
        external
        override
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        if (amount == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();

        // Fee crystallisation runs against pre-deposit NAV so growth is captured before new shares dilute the math.
        _crystalliseFees();

        // Snapshot pre-mint state. ERC-4626's previewDeposit assumes the deposited assets are NOT yet
        // in the vault (the deposit flow does `transferFrom` AFTER `previewDeposit`). Because we route
        // through Manager.mintForVault — which mints PUSD into the vault before we know the share count —
        // we must compute shares against the snapshot, not against `previewDeposit` post-mint.
        uint256 supplyBefore = totalSupply();
        uint256 assetsBefore = totalAssets();

        // 1. Pull stablecoin from caller to this vault.
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        // 2. Approve Manager and route through the vault path.
        IERC20(token).forceApprove(pusdManager, amount);
        uint256 pusdMinted = IPUSDManager(pusdManager).mintForVault(token, amount, address(this));

        // 3. Apply OZ's standard offset-aware share formula against the pre-mint state.
        //    shares = pusdMinted * (supply + 10**offset) / (assets + 1)
        shares = Math.mulDiv(
            pusdMinted,
            supplyBefore + 10 ** _decimalsOffset(),
            assetsBefore + 1,
            Math.Rounding.Floor
        );
        _mint(receiver, shares);
        // After issuing shares the HWM advances; subsequent NAV growth past this point is fee-able.
        _bumpHighWaterMark();

        emit Deposit(msg.sender, receiver, pusdMinted, shares);
        emit StableDeposited(msg.sender, token, amount, pusdMinted, shares, receiver);
    }

    /// @inheritdoc IPUSDPlus
    function redeemToStable(uint256 shares, address preferredAsset, address receiver)
        external
        override
        whenNotPaused
        nonReentrant
        returns (uint256 tokenOut)
    {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        if (preferredAsset == address(0)) revert ZeroAddress();

        _crystalliseFees();

        // 1. Resolve PUSD owed to this redemption at the current pps.
        uint256 pusdOwed = previewRedeem(shares);
        require(pusdOwed > 0, "PUSDPlus: nothing to redeem");

        // 2. Burn shares first (I-04). previewRedeem after this point would round differently —
        //    the snapshot above is the canonical figure.
        _burn(msg.sender, shares);

        // 3. Approve Manager to burn the underlying PUSD this vault holds, and execute the vault redeem.
        IERC20(asset()).forceApprove(pusdManager, pusdOwed);
        tokenOut = IPUSDManager(pusdManager).redeemForVault(pusdOwed, preferredAsset, receiver);

        _bumpHighWaterMark();

        emit Withdraw(msg.sender, receiver, msg.sender, pusdOwed, shares);
        emit StableRedeemed(msg.sender, preferredAsset, shares, pusdOwed, tokenOut, receiver);
    }

    // =====================================================================
    //                    ERC-4626 standard entrypoints (PUSD-in / PUSD-out)
    // =====================================================================

    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        _crystalliseFees();
        shares = super.deposit(assets, receiver);
        _bumpHighWaterMark();
    }

    function mint(uint256 shares, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        _crystalliseFees();
        assets = super.mint(shares, receiver);
        _bumpHighWaterMark();
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        _crystalliseFees();
        shares = super.withdraw(assets, receiver, owner);
        _bumpHighWaterMark();
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        _crystalliseFees();
        assets = super.redeem(shares, receiver, owner);
        _bumpHighWaterMark();
    }

    // =====================================================================
    //                          Performance fee
    // =====================================================================

    /// @notice Run the HWM crystallisation explicitly (e.g. by the off-chain harvest bot).
    function crystalliseFees() external {
        _crystalliseFees();
    }

    function _crystalliseFees() internal {
        if (totalSupply() == 0) {
            highWaterMarkPUSD = totalAssets();
            return;
        }
        uint256 assetsNow = totalAssets();
        if (assetsNow <= highWaterMarkPUSD) return;

        uint256 deltaPUSD = assetsNow - highWaterMarkPUSD;
        uint256 feeAmountPUSD = (deltaPUSD * performanceFeeBps) / BASIS_POINTS;
        if (feeAmountPUSD == 0) {
            highWaterMarkPUSD = assetsNow;
            return;
        }

        // Mint fee-shares at the *current* (pre-skim) pps, so dilution exactly matches the skimmed delta.
        uint256 feeShares = _convertToShares(feeAmountPUSD, Math.Rounding.Floor);
        if (feeShares == 0) {
            highWaterMarkPUSD = assetsNow;
            return;
        }

        _mint(performanceFeeRecipient, feeShares);
        highWaterMarkPUSD = assetsNow;

        emit PerformanceFeeCrystallised(deltaPUSD, feeShares, assetsNow);
    }

    /// @dev Bump HWM up to current totalAssets after a state-mutating user call.
    ///      We *only* ever raise it — never lower — to match the HWM model.
    function _bumpHighWaterMark() internal {
        uint256 current = totalAssets();
        if (current > highWaterMarkPUSD) {
            highWaterMarkPUSD = current;
        }
    }

    // =====================================================================
    //                              Admin
    // =====================================================================

    function setPerformanceFeeBps(uint16 bps) external onlyRole(ADMIN_ROLE) {
        if (bps > MAX_PERFORMANCE_FEE_BPS) revert PerformanceFeeTooHigh(bps, MAX_PERFORMANCE_FEE_BPS);
        // Realise prior earnings under the OLD rate before rotating to the new rate.
        _crystalliseFees();
        uint16 old = performanceFeeBps;
        performanceFeeBps = bps;
        emit PerformanceFeeBpsSet(old, bps);
    }

    function setPerformanceFeeRecipient(address recipient) external onlyRole(ADMIN_ROLE) {
        if (recipient == address(0)) revert ZeroAddress();
        _crystalliseFees();
        address old = performanceFeeRecipient;
        performanceFeeRecipient = recipient;
        emit PerformanceFeeRecipientSet(old, recipient);
    }

    function setPUSDLiquidity(address newLiquidity) external onlyRole(ADMIN_ROLE) {
        if (newLiquidity == address(0)) revert ZeroAddress();
        if (pusdLiquidity != address(0)) {
            _revokeRole(LIQUIDITY_ROLE, pusdLiquidity);
        }
        address old = pusdLiquidity;
        pusdLiquidity = newLiquidity;
        _grantRole(LIQUIDITY_ROLE, newLiquidity);
        emit PUSDLiquiditySet(old, newLiquidity);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // =====================================================================
    //                           UUPS upgrade
    // =====================================================================

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}

    // =====================================================================
    //                              Views
    // =====================================================================

    /// @notice 18-decimal share-price snapshot (`pps`). Returns 1e18 when no shares minted.
    /// @dev    With `asset_decimals = 6` and `_decimalsOffset() = 6`, shares are 12-dec internally.
    ///         To express the 1-share : 1-PUSD parity as 1e18 we scale raw assets by 10**offset
    ///         before dividing by raw shares.
    function pricePerShare() external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e18;
        return (totalAssets() * (10 ** _decimalsOffset()) * 1e18) / supply;
    }
}


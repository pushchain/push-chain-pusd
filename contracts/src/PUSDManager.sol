// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./PUSD.sol";
import "./libs/DecimalLib.sol";
import "./interfaces/IPUSDLiquidity.sol";

/**
 * @title PUSDManager (v2)
 * @notice Custodian of every PUSD-backing stablecoin. Splits its balance into two slices:
 *         `parReserve` backs plain PUSD; `yieldShareReserve` backs PUSD+ via the vault path.
 * @dev    UUPS proxy. PUSD MINTER_ROLE / BURNER_ROLE held exclusively by this contract.
 *         The vault path (`mintForVault`, `redeemForVault`) is gated to PUSDPlus via VAULT_ROLE.
 *
 *         Invariant I-01:
 *           IERC20(t).balanceOf(this) ==
 *               parReserve[t] + yieldShareReserve[t] + accruedFees[t] + accruedHaircut[t]
 */
contract PUSDManager is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;
    using DecimalLib for uint256;

    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------
    uint256 public constant MAX_TOKENS = 25;
    uint256 private constant BASIS_POINTS = 10000;
    uint16  public constant MAX_VAULT_HAIRCUT_BPS = 500; // 5%

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------
    enum TokenStatus {
        REMOVED,            // Cannot deposit, cannot redeem
        ENABLED,            // Can deposit and redeem (preferred + basket)
        REDEEM_ONLY,        // Cannot deposit; basket / preferred redeem allowed
        EMERGENCY_REDEEM    // Cannot deposit; forces proportional drain
    }

    /// @dev Used by `_executeRedeem` to know which slice to debit.
    enum Slice { PAR, YIELD }

    struct TokenInfo {
        bool exists;
        TokenStatus status;
        uint8 decimals;
        uint16 surplusHaircutBps; // plain-deposit haircut (max 4000 = 40%)
        string name;
        string chainNamespace;
        // v2 reserved slots — must remain address(0) at launch (rate-bearing wrappers
        // are out of scope; bridged sDAI/sUSDS/USDY would wire here in a future ADR).
        address rateBearingWrapper;
        address unwrapAdapter;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------
    PUSD public pusd;

    uint256 private _status; // legacy custom reentrancy guard slot

    mapping(address => TokenInfo) public supportedTokens;
    mapping(uint256 => address) public tokenList;
    mapping(address => uint256) private tokenIndex;
    uint256 public tokenCount;

    address public treasuryReserve;
    uint256 public baseFee;
    uint256 public preferredFeeMin;
    uint256 public preferredFeeMax;

    mapping(address => uint256) public accruedFees;
    mapping(address => uint256) public accruedHaircut;
    mapping(address => uint256) public sweptFees;
    mapping(address => uint256) public sweptHaircut;

    // v2 slice accounting
    mapping(address => uint256) public parReserve;
    mapping(address => uint256) public yieldShareReserve;

    address public pusdPlus;        // sole VAULT_ROLE holder
    address public pusdLiquidity;   // PUSDLiquidity engine (read for unwind callback)
    uint16  public vaultHaircutBps; // launch 0, max 500

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event TokenAdded(address indexed token, string name, string chainNamespace, uint8 decimals);
    event TokenStatusChanged(address indexed token, TokenStatus oldStatus, TokenStatus newStatus);
    event Deposited(address indexed user, address indexed token, uint256 tokenAmount, uint256 pusdMinted, uint256 surplusAmount, address indexed recipient);
    event Redeemed(address indexed user, address indexed token, uint256 pusdBurned, uint256 tokenAmount, address indexed recipient);
    event TreasuryReserveUpdated(address indexed oldTreasury, address indexed newTreasury);
    event BaseFeeUpdated(uint256 oldFee, uint256 newFee);
    event PreferredFeeRangeUpdated(uint256 oldMin, uint256 oldMax, uint256 newMin, uint256 newMax);
    event Rebalanced(Slice slice, address indexed tokenIn, uint256 amountIn, address indexed tokenOut, uint256 amountOut);
    event SurplusHaircutUpdated(address indexed token, uint256 oldBps, uint256 newBps);
    event SurplusAccrued(address indexed token, uint256 feeDelta, uint256 haircutDelta);
    event SurplusSwept(address indexed token, address indexed treasury, uint256 feeSwept, uint256 haircutSwept);

    // v2 events
    event MintedForVault(address indexed vault, address indexed token, uint256 tokenAmount, uint256 pusdMinted, uint256 vaultHaircutAmount);
    event RedeemedForVault(address indexed vault, address indexed preferredAsset, uint256 pusdBurned, uint256 tokenAmount, uint256 pulledFromLiquidity, address indexed recipient);
    event PUSDPlusSet(address indexed oldVault, address indexed newVault);
    event PUSDLiquiditySet(address indexed oldLiquidity, address indexed newLiquidity);
    event VaultHaircutBpsSet(uint16 oldBps, uint16 newBps);
    event ParReserveDelta(address indexed token, int256 delta);
    event YieldShareReserveDelta(address indexed token, int256 delta);
    event Reclassified(address indexed token, bool fromParToYield, uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------
    error InsufficientLiquidity(uint256 requested, uint256 delivered);

    // ---------------------------------------------------------------------
    // Reentrancy modifier (custom, kept for symmetry with v1 layout)
    // ---------------------------------------------------------------------
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

    function initialize(address _pusd, address admin) public initializer {
        __AccessControl_init();
        __Pausable_init();

        require(_pusd != address(0), "PUSDManager: PUSD address cannot be zero");
        require(admin != address(0), "PUSDManager: admin address cannot be zero");

        pusd = PUSD(_pusd);
        _status = _NOT_ENTERED;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    // =====================================================================
    //                         ADMIN — TOKEN REGISTRY
    // =====================================================================

    function addSupportedToken(
        address token,
        string memory name,
        string memory chainNamespace,
        uint8 decimals
    ) external onlyRole(ADMIN_ROLE) {
        require(token != address(0), "PUSDManager: token address cannot be zero");
        require(!supportedTokens[token].exists, "PUSDManager: token already added");
        require(decimals > 0 && decimals <= 18, "PUSDManager: invalid decimals");
        require(tokenCount < MAX_TOKENS, "PUSDManager: token cap reached");

        supportedTokens[token] = TokenInfo({
            exists: true,
            status: TokenStatus.ENABLED,
            decimals: decimals,
            surplusHaircutBps: 0,
            name: name,
            chainNamespace: chainNamespace,
            rateBearingWrapper: address(0),
            unwrapAdapter: address(0)
        });

        tokenList[tokenCount] = token;
        tokenIndex[token] = tokenCount;
        tokenCount++;

        emit TokenAdded(token, name, chainNamespace, decimals);
    }

    function setTokenStatus(address token, TokenStatus newStatus) external onlyRole(ADMIN_ROLE) {
        TokenInfo storage info = supportedTokens[token];
        require(info.exists, "PUSDManager: token not added");
        TokenStatus oldStatus = info.status;
        require(oldStatus != newStatus, "PUSDManager: status unchanged");
        info.status = newStatus;
        emit TokenStatusChanged(token, oldStatus, newStatus);
    }

    // =====================================================================
    //                         ADMIN — FEES / TREASURY
    // =====================================================================

    function setTreasuryReserve(address newTreasuryReserve) external onlyRole(ADMIN_ROLE) {
        require(newTreasuryReserve != address(0), "PUSDManager: treasury reserve cannot be zero address");
        address oldTreasury = treasuryReserve;
        treasuryReserve = newTreasuryReserve;
        emit TreasuryReserveUpdated(oldTreasury, newTreasuryReserve);
    }

    function setBaseFee(uint256 newBaseFee) external onlyRole(ADMIN_ROLE) {
        require(newBaseFee <= 100, "PUSDManager: base fee too high"); // <= 1%
        uint256 old = baseFee;
        baseFee = newBaseFee;
        emit BaseFeeUpdated(old, newBaseFee);
    }

    function setPreferredFeeRange(uint256 newMin, uint256 newMax) external onlyRole(ADMIN_ROLE) {
        require(newMin <= newMax, "PUSDManager: min must be <= max");
        require(newMax <= 200, "PUSDManager: max fee too high"); // <= 2%
        uint256 oldMin = preferredFeeMin;
        uint256 oldMax = preferredFeeMax;
        preferredFeeMin = newMin;
        preferredFeeMax = newMax;
        emit PreferredFeeRangeUpdated(oldMin, oldMax, newMin, newMax);
    }

    function setSurplusHaircutBps(address token, uint16 newBps) external onlyRole(ADMIN_ROLE) {
        TokenInfo storage info = supportedTokens[token];
        require(info.exists, "PUSDManager: token not added");
        require(newBps <= 4000, "PUSDManager: haircut too high"); // <= 40%
        uint256 old = info.surplusHaircutBps;
        info.surplusHaircutBps = newBps;
        emit SurplusHaircutUpdated(token, old, newBps);
    }

    // =====================================================================
    //                         ADMIN — V2 WIRING
    // =====================================================================

    function setPUSDPlus(address newVault) external onlyRole(ADMIN_ROLE) {
        require(newVault != address(0), "PUSDManager: vault cannot be zero");
        address oldVault = pusdPlus;
        if (oldVault != address(0)) _revokeRole(VAULT_ROLE, oldVault);
        pusdPlus = newVault;
        _grantRole(VAULT_ROLE, newVault);
        emit PUSDPlusSet(oldVault, newVault);
    }

    function setPUSDLiquidity(address newLiquidity) external onlyRole(ADMIN_ROLE) {
        require(newLiquidity != address(0), "PUSDManager: liquidity cannot be zero");
        address old = pusdLiquidity;
        pusdLiquidity = newLiquidity;
        emit PUSDLiquiditySet(old, newLiquidity);
    }

    function setVaultHaircutBps(uint16 bps) external onlyRole(ADMIN_ROLE) {
        require(bps <= MAX_VAULT_HAIRCUT_BPS, "PUSDManager: vault haircut too high");
        uint16 old = vaultHaircutBps;
        vaultHaircutBps = bps;
        emit VaultHaircutBpsSet(old, bps);
    }

    /// @notice Transfer `amount` of `token` from the Manager's idle yield slice into the
    ///         Liquidity engine, where it can later be deployed into Uniswap V3 positions.
    /// @dev    Called by admin / keeper. The yield slice book-keeping shrinks by `amount`;
    ///         on the Liquidity side `amount` arrives as idle inventory ready to be paired
    ///         into an LP position. The reverse direction is handled inside `redeemForVault`
    ///         via `IPUSDLiquidity.pullForWithdraw`.
    function transferYieldToLiquidity(address token, uint256 amount)
        external
        onlyRole(ADMIN_ROLE)
        nonReentrant
    {
        require(amount > 0, "PUSDManager: amount must be greater than 0");
        require(pusdLiquidity != address(0), "PUSDManager: liquidity not set");
        require(supportedTokens[token].exists, "PUSDManager: token not added");
        require(yieldShareReserve[token] >= amount, "PUSDManager: yield slice insufficient");

        yieldShareReserve[token] -= amount;
        IERC20(token).safeTransfer(pusdLiquidity, amount);
        IPUSDLiquidity(pusdLiquidity).pushForDeploy(token, amount);

        emit YieldShareReserveDelta(token, -int256(amount));
    }

    /// @notice Move `amount` of `token` between the two slices without changing balance.
    /// @dev Used when admin needs to rebalance internal accounting (e.g. seed yield slice from par).
    function reclassify(address token, bool fromParToYield, uint256 amount)
        external
        onlyRole(ADMIN_ROLE)
        nonReentrant
    {
        require(amount > 0, "PUSDManager: amount must be greater than 0");
        require(supportedTokens[token].exists, "PUSDManager: token not added");
        if (fromParToYield) {
            require(parReserve[token] >= amount, "PUSDManager: par slice insufficient");
            parReserve[token] -= amount;
            yieldShareReserve[token] += amount;
            emit ParReserveDelta(token, -int256(amount));
            emit YieldShareReserveDelta(token, int256(amount));
        } else {
            require(yieldShareReserve[token] >= amount, "PUSDManager: yield slice insufficient");
            yieldShareReserve[token] -= amount;
            parReserve[token] += amount;
            emit YieldShareReserveDelta(token, -int256(amount));
            emit ParReserveDelta(token, int256(amount));
        }
        emit Reclassified(token, fromParToYield, amount);
    }

    // =====================================================================
    //                         ADMIN — PAUSE
    // =====================================================================

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // =====================================================================
    //                         ADMIN — REBALANCE / SWEEP
    // =====================================================================

    /// @notice Cross-token 1:1 swap within a single slice. Admin sends `amountIn` in,
    ///         receives `amountOut` out; PUSD value must match exactly.
    function rebalance(
        Slice slice,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut
    ) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(tokenIn != tokenOut, "PUSDManager: cannot swap same token");
        require(amountIn > 0, "PUSDManager: amountIn must be greater than 0");
        require(amountOut > 0, "PUSDManager: amountOut must be greater than 0");

        TokenInfo memory inInfo = supportedTokens[tokenIn];
        TokenInfo memory outInfo = supportedTokens[tokenOut];
        require(inInfo.exists, "PUSDManager: tokenIn not added");
        require(outInfo.exists, "PUSDManager: tokenOut not added");
        require(inInfo.status != TokenStatus.REMOVED, "PUSDManager: tokenIn is removed");
        require(outInfo.status != TokenStatus.REMOVED, "PUSDManager: tokenOut is removed");

        uint256 valIn  = amountIn.toPUSD(inInfo.decimals);
        uint256 valOut = amountOut.toPUSD(outInfo.decimals);
        require(valIn == valOut, "PUSDManager: amounts must have equal PUSD value");

        // Slice-scoped: cannot rebalance more than the slice holds, and accruedFees / accruedHaircut
        // are always reserved (balance >= reserved + amountOut).
        uint256 reserved = accruedFees[tokenOut] + accruedHaircut[tokenOut];
        uint256 outBal = IERC20(tokenOut).balanceOf(address(this));
        require(outBal >= amountOut + reserved, "PUSDManager: rebalance would spend reserved surplus");

        if (slice == Slice.PAR) {
            require(parReserve[tokenOut] >= amountOut, "PUSDManager: par slice insufficient");
            parReserve[tokenOut] -= amountOut;
            parReserve[tokenIn]  += amountIn;
            emit ParReserveDelta(tokenOut, -int256(amountOut));
            emit ParReserveDelta(tokenIn,   int256(amountIn));
        } else {
            require(yieldShareReserve[tokenOut] >= amountOut, "PUSDManager: yield slice insufficient");
            yieldShareReserve[tokenOut] -= amountOut;
            yieldShareReserve[tokenIn]  += amountIn;
            emit YieldShareReserveDelta(tokenOut, -int256(amountOut));
            emit YieldShareReserveDelta(tokenIn,   int256(amountIn));
        }

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);

        emit Rebalanced(slice, tokenIn, amountIn, tokenOut, amountOut);
    }

    function sweepAllSurplus() external onlyRole(ADMIN_ROLE) nonReentrant {
        require(treasuryReserve != address(0), "PUSDManager: treasury not set");
        uint256 sweptCount = 0;
        for (uint256 i = 0; i < tokenCount; i++) {
            if (_sweepTokenSurplus(tokenList[i])) sweptCount++;
        }
        require(sweptCount > 0, "PUSDManager: no surplus to sweep");
    }

    function _sweepTokenSurplus(address token) internal returns (bool) {
        if (treasuryReserve == address(0)) return false;
        uint256 feeAmount = accruedFees[token];
        uint256 haircutAmount = accruedHaircut[token];
        uint256 total = feeAmount + haircutAmount;
        if (total == 0) return false;

        IERC20(token).safeTransfer(treasuryReserve, total);
        sweptFees[token] += feeAmount;
        sweptHaircut[token] += haircutAmount;
        accruedFees[token] = 0;
        accruedHaircut[token] = 0;

        emit SurplusSwept(token, treasuryReserve, feeAmount, haircutAmount);
        return true;
    }

    // =====================================================================
    //                         USER — PLAIN PUSD
    // =====================================================================

    function deposit(address token, uint256 amount, address recipient)
        external
        whenNotPaused
        nonReentrant
    {
        TokenInfo memory info = supportedTokens[token];
        require(info.status == TokenStatus.ENABLED, "PUSDManager: token not enabled for deposits");
        require(amount > 0, "PUSDManager: amount must be greater than 0");
        require(recipient != address(0), "PUSDManager: recipient cannot be zero address");

        uint256 surplusTokenAmount = (amount * info.surplusHaircutBps) / BASIS_POINTS;
        uint256 netTokenAmount = amount - surplusTokenAmount;

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        if (surplusTokenAmount > 0) {
            accruedHaircut[token] += surplusTokenAmount;
            emit SurplusAccrued(token, 0, surplusTokenAmount);
        }

        parReserve[token] += netTokenAmount;
        emit ParReserveDelta(token, int256(netTokenAmount));

        uint256 pusdAmount = netTokenAmount.toPUSD(info.decimals);
        pusd.mint(recipient, pusdAmount);

        emit Deposited(msg.sender, token, amount, pusdAmount, surplusTokenAmount, recipient);
    }

    function redeem(
        uint256 pusdAmount,
        address preferredAsset,
        bool allowBasket,
        address recipient
    ) external whenNotPaused nonReentrant {
        require(pusdAmount > 0, "PUSDManager: amount must be greater than 0");
        require(recipient != address(0), "PUSDManager: recipient cannot be zero address");
        require(pusd.balanceOf(msg.sender) >= pusdAmount, "PUSDManager: insufficient PUSD balance");

        bool hasEmergency = _hasEmergencyTokensInPar();

        TokenInfo memory pInfo = supportedTokens[preferredAsset];
        bool pValid = pInfo.status == TokenStatus.ENABLED
                   || pInfo.status == TokenStatus.REDEEM_ONLY
                   || pInfo.status == TokenStatus.EMERGENCY_REDEEM;

        if (pValid && !hasEmergency) {
            uint256 needed = DecimalLib.fromPUSD(pusdAmount, pInfo.decimals);
            if (parReserve[preferredAsset] >= needed) {
                uint256 totalFee = baseFee + _calculatePreferredFee(preferredAsset);
                _executeRedeem(preferredAsset, pusdAmount, needed, true, totalFee, recipient, Slice.PAR);
                return;
            }
        }

        if (hasEmergency && pValid) {
            _executeEmergencyRedeem(pusdAmount, preferredAsset, recipient);
            return;
        }

        require(allowBasket, "PUSDManager: preferred asset unavailable and basket not allowed");
        _executeBasketRedeem(pusdAmount, recipient);
    }

    // =====================================================================
    //                         VAULT — PUSD+ MINT / REDEEM
    // =====================================================================

    function mintForVault(address token, uint256 amount, address recipient)
        external
        onlyRole(VAULT_ROLE)
        whenNotPaused
        nonReentrant
        returns (uint256 pusdMinted)
    {
        TokenInfo memory info = supportedTokens[token];
        require(info.status == TokenStatus.ENABLED, "PUSDManager: token not enabled for vault deposits");
        require(amount > 0, "PUSDManager: amount must be greater than 0");
        require(recipient != address(0), "PUSDManager: recipient cannot be zero address");

        uint256 vaultHaircut = (amount * vaultHaircutBps) / BASIS_POINTS;
        uint256 netAmount = amount - vaultHaircut;

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        if (vaultHaircut > 0) {
            accruedHaircut[token] += vaultHaircut;
            emit SurplusAccrued(token, 0, vaultHaircut);
        }

        yieldShareReserve[token] += netAmount;
        emit YieldShareReserveDelta(token, int256(netAmount));

        pusdMinted = netAmount.toPUSD(info.decimals);
        pusd.mint(recipient, pusdMinted);

        emit MintedForVault(msg.sender, token, amount, pusdMinted, vaultHaircut);
    }

    function redeemForVault(uint256 pusdAmount, address preferredAsset, address recipient)
        external
        onlyRole(VAULT_ROLE)
        whenNotPaused
        nonReentrant
        returns (uint256 tokenOut)
    {
        require(pusdAmount > 0, "PUSDManager: amount must be greater than 0");
        require(recipient != address(0), "PUSDManager: recipient cannot be zero address");

        TokenInfo memory info = supportedTokens[preferredAsset];
        require(info.exists, "PUSDManager: preferred asset not added");
        require(
            info.status == TokenStatus.ENABLED ||
            info.status == TokenStatus.REDEEM_ONLY ||
            info.status == TokenStatus.EMERGENCY_REDEEM,
            "PUSDManager: preferred asset not redeemable"
        );

        require(pusd.balanceOf(msg.sender) >= pusdAmount, "PUSDManager: insufficient PUSD balance");

        uint256 needed = DecimalLib.fromPUSD(pusdAmount, info.decimals);

        // 1. Idle yield slice — does it satisfy the request?
        uint256 idleYield = yieldShareReserve[preferredAsset];
        uint256 pulled = 0;

        if (idleYield < needed) {
            uint256 shortfall = needed - idleYield;
            require(pusdLiquidity != address(0), "PUSDManager: liquidity not set");
            // Pull missing tokens from the LP engine straight to this contract; slice it into yield.
            uint256 delivered = IPUSDLiquidity(pusdLiquidity).pullForWithdraw(
                preferredAsset, shortfall, address(this)
            );
            if (delivered < shortfall) {
                revert InsufficientLiquidity(needed, idleYield + delivered);
            }
            yieldShareReserve[preferredAsset] += delivered;
            emit YieldShareReserveDelta(preferredAsset, int256(delivered));
            pulled = delivered;
        }

        require(yieldShareReserve[preferredAsset] >= needed, "PUSDManager: yield slice insufficient post-pull");

        // 2. Burn PUSD held by the vault.
        pusd.burn(msg.sender, pusdAmount);

        // 3. Apply fee, debit yield slice, transfer net to recipient.
        uint256 feeBps = baseFee; // vault path uses base fee only — preferred-fee curve is plain-PUSD only
        uint256 feeAmount = (needed * feeBps) / BASIS_POINTS;
        if (feeAmount > 0) {
            accruedFees[preferredAsset] += feeAmount;
            emit SurplusAccrued(preferredAsset, feeAmount, 0);
        }
        tokenOut = needed - feeAmount;

        yieldShareReserve[preferredAsset] -= needed;
        emit YieldShareReserveDelta(preferredAsset, -int256(needed));

        IERC20(preferredAsset).safeTransfer(recipient, tokenOut);

        emit RedeemedForVault(msg.sender, preferredAsset, pusdAmount, tokenOut, pulled, recipient);
    }

    // =====================================================================
    //                         INTERNAL — REDEEM HELPERS (par slice)
    // =====================================================================

    function _executeRedeem(
        address token,
        uint256 pusdAmount,
        uint256 tokenAmount,
        bool shouldBurn,
        uint256 feeBps,
        address recipient,
        Slice slice
    ) internal {
        if (shouldBurn) {
            pusd.burn(msg.sender, pusdAmount);
        }

        uint256 feeAmount = 0;
        if (feeBps > 0) {
            feeAmount = (tokenAmount * feeBps) / BASIS_POINTS;
            accruedFees[token] += feeAmount;
            emit SurplusAccrued(token, feeAmount, 0);
        }
        uint256 userAmount = tokenAmount - feeAmount;

        if (slice == Slice.PAR) {
            require(parReserve[token] >= tokenAmount, "PUSDManager: par slice insufficient");
            parReserve[token] -= tokenAmount;
            emit ParReserveDelta(token, -int256(tokenAmount));
        } else {
            require(yieldShareReserve[token] >= tokenAmount, "PUSDManager: yield slice insufficient");
            yieldShareReserve[token] -= tokenAmount;
            emit YieldShareReserveDelta(token, -int256(tokenAmount));
        }

        IERC20(token).safeTransfer(recipient, userAmount);
        emit Redeemed(msg.sender, token, pusdAmount, userAmount, recipient);
    }

    function _executeBasketRedeem(uint256 pusdAmount, address recipient) internal {
        uint256 totalLiquidityPUSD = 0;
        uint256[] memory available = new uint256[](tokenCount);

        for (uint256 i = 0; i < tokenCount; i++) {
            address t = tokenList[i];
            TokenInfo memory info = supportedTokens[t];
            if (info.status == TokenStatus.REMOVED) continue;

            uint256 bal = parReserve[t];
            uint256 balInPUSD = bal.toPUSD(info.decimals);
            available[i] = balInPUSD;
            totalLiquidityPUSD += balInPUSD;
        }

        require(totalLiquidityPUSD >= pusdAmount, "PUSDManager: insufficient total liquidity");

        // Burn once upfront.
        pusd.burn(msg.sender, pusdAmount);

        uint256 remaining = pusdAmount;
        for (uint256 i = 0; i < tokenCount && remaining > 0; i++) {
            if (available[i] == 0) continue;

            address t = tokenList[i];
            TokenInfo memory info = supportedTokens[t];

            uint256 share = (pusdAmount * available[i]) / totalLiquidityPUSD;
            if (share > remaining) share = remaining;
            if (share > available[i]) share = available[i];

            if (share > 0) {
                uint256 tokenAmt = DecimalLib.fromPUSD(share, info.decimals);
                _executeRedeem(t, share, tokenAmt, false, baseFee, recipient, Slice.PAR);
                remaining -= share;
                available[i] -= share;
            }
        }

        if (remaining > 0) {
            uint256 maxIdx = 0;
            uint256 maxAmt = 0;
            for (uint256 i = 0; i < tokenCount; i++) {
                if (available[i] > maxAmt) { maxAmt = available[i]; maxIdx = i; }
            }
            require(maxAmt >= remaining, "PUSDManager: unable to fully redeem PUSD");
            address t = tokenList[maxIdx];
            TokenInfo memory info = supportedTokens[t];
            uint256 tokenAmt = DecimalLib.fromPUSD(remaining, info.decimals);
            _executeRedeem(t, remaining, tokenAmt, false, baseFee, recipient, Slice.PAR);
        }
    }

    function _hasEmergencyTokensInPar() internal view returns (bool) {
        for (uint256 i = 0; i < tokenCount; i++) {
            address t = tokenList[i];
            if (supportedTokens[t].status == TokenStatus.EMERGENCY_REDEEM && parReserve[t] > 0) {
                return true;
            }
        }
        return false;
    }

    function _executeEmergencyRedeem(uint256 pusdAmount, address preferredAsset, address recipient) internal {
        uint256 totalLiquidityPUSD = 0;
        uint256[] memory available = new uint256[](tokenCount);
        uint256 preferredIndex;

        {
            TokenInfo memory pInfo = supportedTokens[preferredAsset];
            require(pInfo.exists, "PUSDManager: preferred asset not added");
            preferredIndex = tokenIndex[preferredAsset];
            uint256 inPUSD = parReserve[preferredAsset].toPUSD(pInfo.decimals);
            available[preferredIndex] = inPUSD;
            totalLiquidityPUSD += inPUSD;
        }

        for (uint256 i = 0; i < tokenCount; i++) {
            if (i == preferredIndex) continue;
            address t = tokenList[i];
            TokenInfo memory info = supportedTokens[t];
            if (info.status == TokenStatus.EMERGENCY_REDEEM) {
                uint256 inPUSD = parReserve[t].toPUSD(info.decimals);
                available[i] = inPUSD;
                totalLiquidityPUSD += inPUSD;
            }
        }

        require(totalLiquidityPUSD >= pusdAmount, "PUSDManager: insufficient liquidity for emergency redemption");

        pusd.burn(msg.sender, pusdAmount);

        uint256 remaining = pusdAmount;
        for (uint256 i = 0; i < tokenCount && remaining > 0; i++) {
            if (available[i] == 0) continue;
            address t = tokenList[i];
            TokenInfo memory info = supportedTokens[t];

            uint256 share = (pusdAmount * available[i]) / totalLiquidityPUSD;
            if (share > remaining) share = remaining;
            if (share > available[i]) share = available[i];

            if (share > 0) {
                uint256 tokenAmt = DecimalLib.fromPUSD(share, info.decimals);
                _executeRedeem(t, share, tokenAmt, false, baseFee, recipient, Slice.PAR);
                remaining -= share;
                available[i] -= share;
            }
        }

        if (remaining > 0) {
            uint256 maxIdx = 0;
            uint256 maxAmt = 0;
            for (uint256 i = 0; i < tokenCount; i++) {
                if (available[i] > maxAmt) { maxAmt = available[i]; maxIdx = i; }
            }
            require(maxAmt >= remaining, "PUSDManager: unable to fully redeem PUSD");
            address t = tokenList[maxIdx];
            TokenInfo memory info = supportedTokens[t];
            uint256 tokenAmt = DecimalLib.fromPUSD(remaining, info.decimals);
            _executeRedeem(t, remaining, tokenAmt, false, baseFee, recipient, Slice.PAR);
        }
    }

    function _calculatePreferredFee(address token) internal view returns (uint256) {
        if (preferredFeeMin == 0 && preferredFeeMax == 0) return 0;

        TokenInfo memory info = supportedTokens[token];
        uint256 tokenInPUSD = parReserve[token].toPUSD(info.decimals);

        uint256 totalLiquidityPUSD = 0;
        for (uint256 i = 0; i < tokenCount; i++) {
            address t = tokenList[i];
            TokenInfo memory ti = supportedTokens[t];
            if (ti.status == TokenStatus.REMOVED) continue;
            totalLiquidityPUSD += parReserve[t].toPUSD(ti.decimals);
        }

        if (totalLiquidityPUSD == 0) return preferredFeeMax;

        uint256 pct = (tokenInPUSD * BASIS_POINTS) / totalLiquidityPUSD;
        if (pct >= 5000) return preferredFeeMin;
        if (pct <= 1000) return preferredFeeMax;

        // Linear interpolation between 10%–50%.
        uint256 range = pct - 1000;
        uint256 feeRange = preferredFeeMax - preferredFeeMin;
        uint256 feeReduction = (range * feeRange) / 4000;
        return preferredFeeMax - feeReduction;
    }

    // =====================================================================
    //                              VIEWS
    // =====================================================================

    function getSupportedTokensCount() external view returns (uint256) { return tokenCount; }
    function getSupportedTokenAt(uint256 index) external view returns (address) {
        require(index < tokenCount, "PUSDManager: index out of bounds");
        return tokenList[index];
    }
    function isTokenSupported(address token) external view returns (bool) {
        TokenStatus s = supportedTokens[token].status;
        return s == TokenStatus.ENABLED || s == TokenStatus.REDEEM_ONLY || s == TokenStatus.EMERGENCY_REDEEM;
    }

    /// @notice Decimal count for `token`, or 0 if unsupported. IPUSDManager-required view.
    function decimalsOf(address token) external view returns (uint8) {
        return supportedTokens[token].decimals;
    }

    /// @notice True iff `token` is registered AND its status is ENABLED, REDEEM_ONLY, or
    ///         EMERGENCY_REDEEM (i.e. accepted as collateral somewhere in the protocol).
    ///         Same predicate as `isTokenSupported`; surfaced under the IPUSDManager name so
    ///         downstream contracts can rely on the interface without the legacy alias.
    function isSupportedStable(address token) external view returns (bool) {
        TokenStatus s = supportedTokens[token].status;
        return s == TokenStatus.ENABLED || s == TokenStatus.REDEEM_ONLY || s == TokenStatus.EMERGENCY_REDEEM;
    }
    function getTokenStatus(address token) external view returns (TokenStatus) {
        return supportedTokens[token].status;
    }
    function getTokenInfo(address token) external view returns (TokenInfo memory) {
        return supportedTokens[token];
    }
    function getAccruedFees(address token) external view returns (uint256) { return accruedFees[token]; }
    function getAccruedHaircut(address token) external view returns (uint256) { return accruedHaircut[token]; }
    function getAccruedSurplus(address token) external view returns (uint256) {
        return accruedFees[token] + accruedHaircut[token];
    }
    function getSweptFees(address token) external view returns (uint256) { return sweptFees[token]; }
    function getSweptHaircut(address token) external view returns (uint256) { return sweptHaircut[token]; }
    function getTotalSwept(address token) external view returns (uint256) {
        return sweptFees[token] + sweptHaircut[token];
    }
    function getSurplusBreakdown(address token) external view returns (
        uint256 accruedFee, uint256 accruedHaircutAmount, uint256 sweptFee, uint256 sweptHaircutAmount
    ) {
        return (accruedFees[token], accruedHaircut[token], sweptFees[token], sweptHaircut[token]);
    }

    function parReserveOf(address token) external view returns (uint256) { return parReserve[token]; }
    function yieldShareReserveOf(address token) external view returns (uint256) { return yieldShareReserve[token]; }

    function availableForVaultWithdraw(address token) external view returns (uint256) {
        uint256 base = yieldShareReserve[token];
        if (pusdLiquidity != address(0)) {
            base += IPUSDLiquidity(pusdLiquidity).idleBalance(token);
        }
        return base;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}
}

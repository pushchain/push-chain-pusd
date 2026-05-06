// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./PUSD.sol";
import "./interfaces/IPUSDPlusVault.sol";

/**
 * @title PUSDManager
 * @dev Manages deposits and withdrawals of stablecoins (USDT, USDC) from various chains
 * @notice Users can deposit supported stablecoins to mint PUSD and redeem PUSD to withdraw stablecoins
 */
contract PUSDManager is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    PUSD public pusd;

    uint256 private _status;

    enum TokenStatus {
        REMOVED, // Token completely removed - cannot deposit or redeem
        ENABLED, // Can deposit and can redeem as preferred and as basket leg
        REDEEM_ONLY, // Cannot deposit, but can still be used in basket/redemptions
        EMERGENCY_REDEEM // Cannot deposit, forces proportional redemption to drain this token
    }

    struct TokenInfo {
        bool exists;
        TokenStatus status;
        uint8 decimals;
        uint16 surplusHaircutBps; // 0..1000, haircut on deposit minting (max 10% in v2)
        string name;
        string chainNamespace;
    }

    mapping(address => TokenInfo) public supportedTokens;
    mapping(uint256 => address) public tokenList;
    mapping(address => uint256) private tokenIndex;
    uint256 public tokenCount;

    address public treasuryReserve;
    uint256 public baseFee; // Base fee in basis points (e.g., 5 = 0.05%)
    uint256 public preferredFeeMin; // Min preferred fee in basis points
    uint256 public preferredFeeMax; // Max preferred fee in basis points

    // Fee and haircut tracking
    mapping(address => uint256) public accruedFees; // Accumulated redemption fees per token
    mapping(address => uint256) public accruedHaircut; // Accumulated deposit haircut per token
    mapping(address => uint256) public sweptFees; // Total fees swept to treasury per token
    mapping(address => uint256) public sweptHaircut; // Total haircut swept to treasury per token

    // ------------------------------------------------------------------
    // v2 state (PUSD+) — APPEND-ONLY. Verify with `forge inspect` diff.
    // ------------------------------------------------------------------

    /// @notice The PUSD+ vault. Settable only by DEFAULT_ADMIN_ROLE (timelock).
    address public plusVault;

    /// @notice Addresses exempt from the redeem fee. The PUSD+ vault is the only
    ///         intended exempt address at v2; the mapping is generalised so
    ///         future protocol-internal actors can be added without another
    ///         upgrade.
    mapping(address => bool) public feeExempt;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private constant BASIS_POINTS = 10000; // 100% = 10000 basis points

    event TokenAdded(address indexed token, string name, string chainNamespace, uint8 decimals);
    event TokenStatusChanged(address indexed token, TokenStatus oldStatus, TokenStatus newStatus);
    event Deposited(
        address indexed user,
        address indexed token,
        uint256 tokenAmount,
        uint256 pusdMinted,
        uint256 surplusAmount,
        address indexed recipient
    );
    event Redeemed(
        address indexed user, address indexed token, uint256 pusdBurned, uint256 tokenAmount, address indexed recipient
    );
    event TreasuryReserveUpdated(address indexed oldTreasury, address indexed newTreasury);
    event BaseFeeUpdated(uint256 oldFee, uint256 newFee);
    event PreferredFeeRangeUpdated(uint256 oldMin, uint256 oldMax, uint256 newMin, uint256 newMax);
    event Rebalanced(address indexed tokenIn, uint256 amountIn, address indexed tokenOut, uint256 amountOut);
    event SurplusHaircutUpdated(address indexed token, uint256 oldBps, uint256 newBps);
    event SurplusAccrued(address indexed token, uint256 feeDelta, uint256 haircutDelta);
    event SurplusSwept(address indexed token, address indexed treasury, uint256 feeSwept, uint256 haircutSwept);

    // ---- v2 events (PUSD+) ----
    event PlusVaultUpdated(address indexed oldVault, address indexed newVault);
    event FeeExemptSet(address indexed account, bool exempt);
    event DepositedToPlus(
        address indexed user, address indexed tokenIn, uint256 amountIn, uint256 plusOut, address indexed recipient
    );
    event RedeemedFromPlus(
        address indexed user, uint256 plusIn, address indexed preferredAsset, bool basket, address indexed recipient
    );

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

        require(_pusd != address(0), "PUSDManager: PUSD address cannot be zero");
        require(admin != address(0), "PUSDManager: admin address cannot be zero");

        pusd = PUSD(_pusd);
        _status = _NOT_ENTERED;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    function addSupportedToken(address token, string memory name, string memory chainNamespace, uint8 decimals)
        external
        onlyRole(ADMIN_ROLE)
    {
        require(token != address(0), "PUSDManager: token address cannot be zero");
        require(!supportedTokens[token].exists, "PUSDManager: token already added");
        require(decimals > 0 && decimals <= 18, "PUSDManager: invalid decimals");

        supportedTokens[token] = TokenInfo({
            exists: true,
            status: TokenStatus.ENABLED,
            decimals: decimals,
            surplusHaircutBps: 0, // Default: no haircut
            name: name,
            chainNamespace: chainNamespace
        });

        tokenList[tokenCount] = token;
        tokenIndex[token] = tokenCount;
        tokenCount++;

        emit TokenAdded(token, name, chainNamespace, decimals);
    }

    function setTokenStatus(address token, TokenStatus newStatus) external onlyRole(ADMIN_ROLE) {
        TokenInfo storage tokenInfo = supportedTokens[token];
        require(tokenInfo.exists, "PUSDManager: token not added");

        TokenStatus oldStatus = tokenInfo.status;
        require(oldStatus != newStatus, "PUSDManager: status unchanged");

        tokenInfo.status = newStatus;
        emit TokenStatusChanged(token, oldStatus, newStatus);
    }

    function setTreasuryReserve(address newTreasuryReserve) external onlyRole(ADMIN_ROLE) {
        require(newTreasuryReserve != address(0), "PUSDManager: treasury reserve cannot be zero address");
        address oldTreasury = treasuryReserve;
        treasuryReserve = newTreasuryReserve;
        emit TreasuryReserveUpdated(oldTreasury, newTreasuryReserve);
    }

    function setBaseFee(uint256 newBaseFee) external onlyRole(ADMIN_ROLE) {
        require(newBaseFee <= 100, "PUSDManager: base fee too high"); // Max 1%
        uint256 oldFee = baseFee;
        baseFee = newBaseFee;
        emit BaseFeeUpdated(oldFee, newBaseFee);
    }

    function setPreferredFeeRange(uint256 newMin, uint256 newMax) external onlyRole(ADMIN_ROLE) {
        require(newMin <= newMax, "PUSDManager: min must be <= max");
        require(newMax <= 200, "PUSDManager: max fee too high"); // Max 2%
        uint256 oldMin = preferredFeeMin;
        uint256 oldMax = preferredFeeMax;
        preferredFeeMin = newMin;
        preferredFeeMax = newMax;
        emit PreferredFeeRangeUpdated(oldMin, oldMax, newMin, newMax);
    }

    function setSurplusHaircutBps(address token, uint16 newBps) external onlyRole(ADMIN_ROLE) {
        TokenInfo storage tokenInfo = supportedTokens[token];
        require(tokenInfo.exists, "PUSDManager: token not added");
        // v2: reduced from 4000 (40%) → 1000 (10%). Soft lever, not stealth
        // delisting. Hard delistings use REDEEM_ONLY / EMERGENCY_REDEEM status.
        require(newBps <= 1000, "PUSDManager: haircut too high"); // Max 10%

        uint256 oldBps = tokenInfo.surplusHaircutBps;
        tokenInfo.surplusHaircutBps = newBps;
        emit SurplusHaircutUpdated(token, oldBps, newBps);
    }

    /**
     * @notice Internal function to sweep surplus for a single token
     * @param token The token address to sweep surplus for
     * @return True if surplus was swept, false if no surplus or no treasury
     */
    function _sweepTokenSurplus(address token) internal returns (bool) {
        // Skip if no treasury set
        if (treasuryReserve == address(0)) return false;

        uint256 feeAmount = accruedFees[token];
        uint256 haircutAmount = accruedHaircut[token];
        uint256 totalSurplus = feeAmount + haircutAmount;

        // Skip if no surplus
        if (totalSurplus == 0) return false;

        // Transfer surplus to treasury
        IERC20(token).safeTransfer(treasuryReserve, totalSurplus);

        // Update swept totals
        sweptFees[token] += feeAmount;
        sweptHaircut[token] += haircutAmount;

        // Reset accrued amounts
        accruedFees[token] = 0;
        accruedHaircut[token] = 0;

        emit SurplusSwept(token, treasuryReserve, feeAmount, haircutAmount);
        return true;
    }

    /**
     * @notice Sweep surplus for all tokens in a single transaction
     * @dev Loops through all tokens in tokenList and sweeps any with accumulated surplus
     */
    function sweepAllSurplus() external onlyRole(ADMIN_ROLE) nonReentrant {
        require(treasuryReserve != address(0), "PUSDManager: treasury not set");

        uint256 sweptCount = 0;

        for (uint256 i = 0; i < tokenCount; i++) {
            address token = tokenList[i];
            if (_sweepTokenSurplus(token)) {
                sweptCount++;
            }
        }

        require(sweptCount > 0, "PUSDManager: no surplus to sweep");
    }

    /**
     * @notice Bounded variant of sweepAllSurplus. Sweeps tokenList[startIdx .. startIdx+count).
     * @dev Sized for token-count growth; pages can be issued back-to-back from a script.
     *      Reverts if the requested range yields no surplus, mirroring sweepAllSurplus.
     */
    function sweepSurplusBatch(uint256 startIdx, uint256 count) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(treasuryReserve != address(0), "PUSDManager: treasury not set");
        require(startIdx < tokenCount, "PUSDManager: startIdx out of range");

        uint256 end = startIdx + count;
        if (end > tokenCount) end = tokenCount;

        uint256 sweptCount = 0;
        for (uint256 i = startIdx; i < end; i++) {
            if (_sweepTokenSurplus(tokenList[i])) {
                sweptCount++;
            }
        }

        require(sweptCount > 0, "PUSDManager: no surplus to sweep");
    }

    function rebalance(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut)
        external
        onlyRole(ADMIN_ROLE)
        nonReentrant
    {
        require(tokenIn != tokenOut, "PUSDManager: cannot swap same token");
        require(amountIn > 0, "PUSDManager: amountIn must be greater than 0");
        require(amountOut > 0, "PUSDManager: amountOut must be greater than 0");

        TokenInfo memory tokenInInfo = supportedTokens[tokenIn];
        TokenInfo memory tokenOutInfo = supportedTokens[tokenOut];

        require(tokenInInfo.exists, "PUSDManager: tokenIn not added");
        require(tokenOutInfo.exists, "PUSDManager: tokenOut not added");
        require(tokenInInfo.status != TokenStatus.REMOVED, "PUSDManager: tokenIn is removed");
        require(tokenOutInfo.status != TokenStatus.REMOVED, "PUSDManager: tokenOut is removed");

        // Verify amounts are equivalent in PUSD terms (must be exact 1:1)
        uint256 pusdValueIn = _normalizeDecimalsToPUSD(amountIn, tokenInInfo.decimals);
        uint256 pusdValueOut = _normalizeDecimalsToPUSD(amountOut, tokenOutInfo.decimals);
        require(pusdValueIn == pusdValueOut, "PUSDManager: amounts must have equal PUSD value");

        // Enforce invariant: cannot spend reserved surplus
        uint256 reservedSurplus = accruedFees[tokenOut] + accruedHaircut[tokenOut];
        uint256 tokenOutBalance = IERC20(tokenOut).balanceOf(address(this));
        require(tokenOutBalance >= amountOut + reservedSurplus, "PUSDManager: rebalance would spend reserved surplus");

        // Receive tokenIn from admin
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Send tokenOut to admin
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);

        emit Rebalanced(tokenIn, amountIn, tokenOut, amountOut);
    }

    function deposit(address token, uint256 amount, address recipient) external nonReentrant {
        TokenInfo memory tokenInfo = supportedTokens[token];
        require(tokenInfo.status == TokenStatus.ENABLED, "PUSDManager: token not enabled for deposits");
        require(amount > 0, "PUSDManager: amount must be greater than 0");

        require(recipient != address(0), "PUSDManager: recipient cannot be zero address");

        // Calculate surplus (haircut)
        uint256 surplusTokenAmount = (amount * tokenInfo.surplusHaircutBps) / BASIS_POINTS;
        uint256 netTokenAmount = amount - surplusTokenAmount;

        // Transfer all tokens to contract (including surplus for gas efficiency)
        // Surplus stays in contract until swept
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Track accrued haircut
        if (surplusTokenAmount > 0) {
            accruedHaircut[token] += surplusTokenAmount;
            emit SurplusAccrued(token, 0, surplusTokenAmount);
        }

        // Mint PUSD only for net amount (after haircut)
        uint256 pusdAmount = _normalizeDecimalsToPUSD(netTokenAmount, tokenInfo.decimals);
        pusd.mint(recipient, pusdAmount);

        emit Deposited(msg.sender, token, amount, pusdAmount, surplusTokenAmount, recipient);
    }

    function redeem(uint256 pusdAmount, address preferredAsset, bool allowBasket, address recipient)
        external
        nonReentrant
    {
        require(pusdAmount > 0, "PUSDManager: amount must be greater than 0");
        require(recipient != address(0), "PUSDManager: recipient cannot be zero address");
        require(pusd.balanceOf(msg.sender) >= pusdAmount, "PUSDManager: insufficient PUSD balance");

        // Check if any token is in EMERGENCY_REDEEM status
        bool hasEmergencyTokens = _hasEmergencyTokens();

        // Check if preferred asset is valid and has sufficient liquidity
        TokenInfo memory preferredInfo = supportedTokens[preferredAsset];
        bool isPreferredValid = preferredInfo.status == TokenStatus.ENABLED
            || preferredInfo.status == TokenStatus.REDEEM_ONLY || preferredInfo.status == TokenStatus.EMERGENCY_REDEEM;

        // v2: vault-initiated redemptions skip fees entirely. The fee-exempt
        // branch is restricted to msg.sender == plusVault AND feeExempt[plusVault]
        // — flipping the mapping pauses the exemption without rotating the
        // address, useful in incident response.
        bool isFeeExempt = (msg.sender == plusVault) && feeExempt[plusVault];

        if (isPreferredValid && !hasEmergencyTokens) {
            uint256 requiredAmount = _convertFromPUSD(pusdAmount, preferredInfo.decimals);

            if (_getAvailableLiquidity(preferredAsset) >= requiredAmount) {
                // Preferred asset is available and no emergency tokens, use it.
                // Charge base fee + preferred fee — unless caller is fee-exempt.
                uint256 totalFee = isFeeExempt ? 0 : (baseFee + _calculatePreferredFee(preferredAsset));
                _executeRedeem(preferredAsset, pusdAmount, requiredAmount, true, totalFee, recipient);
                return;
            }
        }

        // If emergency tokens exist, force proportional redemption with preferred + emergency
        if (hasEmergencyTokens && isPreferredValid) {
            _executeEmergencyRedeem(pusdAmount, preferredAsset, recipient);
            return;
        }

        // Preferred asset not available or insufficient liquidity
        require(allowBasket, "PUSDManager: preferred asset unavailable and basket not allowed");

        // Try basket redemption across multiple tokens
        _executeBasketRedeem(pusdAmount, recipient);
    }

    function _executeBasketRedeem(uint256 pusdAmount, address recipient) internal {
        // v2: vault-initiated direct redeems are fee-exempt.
        uint256 effectiveBaseFee = ((msg.sender == plusVault) && feeExempt[plusVault]) ? 0 : baseFee;
        _executeBasketRedeemFrom(pusdAmount, recipient, msg.sender, effectiveBaseFee);
    }

    /// @dev v2 — extracted internal so redeemFromPlus can run the same cascade
    ///      with an explicit burn source (the manager itself) and explicit fee
    ///      (zero for the v2 compose; baseFee from the public redeem wrapper).
    function _executeBasketRedeemFrom(uint256 pusdAmount, address recipient, address burnFrom, uint256 effectiveBaseFee)
        internal
    {
        // Calculate total available liquidity across all tokens (in PUSD terms)
        uint256 totalLiquidityPUSD = 0;
        uint256[] memory availableLiquidity = new uint256[](tokenCount);

        for (uint256 i = 0; i < tokenCount; i++) {
            address token = tokenList[i];
            TokenInfo memory info = supportedTokens[token];
            if (info.status == TokenStatus.REMOVED) continue;

            uint256 balance = _getAvailableLiquidity(token);
            uint256 balanceInPUSD = _normalizeDecimalsToPUSD(balance, info.decimals);

            availableLiquidity[i] = balanceInPUSD;
            totalLiquidityPUSD += balanceInPUSD;
        }

        require(totalLiquidityPUSD >= pusdAmount, "PUSDManager: insufficient total liquidity");

        // Burn PUSD once upfront (from explicit source — vault for v2 compose,
        // user for direct redeem).
        pusd.burn(burnFrom, pusdAmount);

        // Distribute redemption proportionally across tokens
        uint256 remainingPUSD = pusdAmount;

        for (uint256 i = 0; i < tokenCount && remainingPUSD > 0; i++) {
            if (availableLiquidity[i] == 0) continue;

            // Calculate this token's share (proportional to its liquidity)
            uint256 tokenSharePUSD = (pusdAmount * availableLiquidity[i]) / totalLiquidityPUSD;

            // Don't exceed remaining or available
            if (tokenSharePUSD > remainingPUSD) {
                tokenSharePUSD = remainingPUSD;
            }
            if (tokenSharePUSD > availableLiquidity[i]) {
                tokenSharePUSD = availableLiquidity[i];
            }

            if (tokenSharePUSD > 0) {
                _payShare(tokenList[i], tokenSharePUSD, effectiveBaseFee, recipient);
                remainingPUSD -= tokenSharePUSD;
                availableLiquidity[i] -= tokenSharePUSD;
            }
        }

        // Handle any remaining PUSD due to rounding by allocating to the token with largest liquidity
        if (remainingPUSD > 0) {
            uint256 maxLiquidityIndex = 0;
            uint256 maxLiquidity = 0;

            for (uint256 i = 0; i < tokenCount; i++) {
                if (availableLiquidity[i] > maxLiquidity) {
                    maxLiquidity = availableLiquidity[i];
                    maxLiquidityIndex = i;
                }
            }

            require(maxLiquidity >= remainingPUSD, "PUSDManager: unable to fully redeem PUSD");

            _payShare(tokenList[maxLiquidityIndex], remainingPUSD, effectiveBaseFee, recipient);
        }
    }

    /// @dev v2 — small helper that lifts the inner loop body out of the basket
    ///      / emergency callers. Without it, both functions hit "stack too deep"
    ///      under the project's non-viaIR foundry profile.
    function _payShare(address token, uint256 sharePusd, uint256 effectiveBaseFee, address recipient) internal {
        uint256 tokenAmount = _convertFromPUSD(sharePusd, supportedTokens[token].decimals);
        _executeRedeem(token, sharePusd, tokenAmount, false, effectiveBaseFee, recipient);
    }

    function _hasEmergencyTokens() internal view returns (bool) {
        for (uint256 i = 0; i < tokenCount; i++) {
            address token = tokenList[i];
            if (supportedTokens[token].status == TokenStatus.EMERGENCY_REDEEM) {
                uint256 balance = _getAvailableLiquidity(token);
                if (balance > 0) {
                    return true;
                }
            }
        }
        return false;
    }

    function _executeEmergencyRedeem(uint256 pusdAmount, address preferredAsset, address recipient) internal {
        // v2: vault-initiated direct redeems are fee-exempt.
        uint256 effectiveBaseFee = ((msg.sender == plusVault) && feeExempt[plusVault]) ? 0 : baseFee;
        _executeEmergencyRedeemFrom(pusdAmount, preferredAsset, recipient, msg.sender, effectiveBaseFee);
    }

    /// @dev v2 — extracted internal so redeemFromPlus can run the same cascade
    ///      with an explicit burn source (the manager itself) and explicit fee
    ///      (zero for the v2 compose; baseFee from the public redeem wrapper).
    function _executeEmergencyRedeemFrom(
        uint256 pusdAmount,
        address preferredAsset,
        address recipient,
        address burnFrom,
        uint256 effectiveBaseFee
    ) internal {
        // Calculate total liquidity of preferred + emergency tokens
        uint256 totalLiquidityPUSD = 0;
        uint256[] memory availableLiquidity = new uint256[](tokenCount);
        uint256 preferredIndex;

        {
            TokenInfo memory preferredInfo = supportedTokens[preferredAsset];
            require(preferredInfo.exists, "PUSDManager: preferred asset not added");
            preferredIndex = tokenIndex[preferredAsset];
            uint256 preferredBalanceInPUSD =
                _normalizeDecimalsToPUSD(_getAvailableLiquidity(preferredAsset), preferredInfo.decimals);
            availableLiquidity[preferredIndex] = preferredBalanceInPUSD;
            totalLiquidityPUSD += preferredBalanceInPUSD;
        }

        // Add all emergency tokens
        for (uint256 i = 0; i < tokenCount; i++) {
            if (i == preferredIndex) continue;

            address token = tokenList[i];
            TokenInfo memory info = supportedTokens[token];

            if (info.status == TokenStatus.EMERGENCY_REDEEM) {
                uint256 balance = _getAvailableLiquidity(token);
                uint256 balanceInPUSD = _normalizeDecimalsToPUSD(balance, info.decimals);
                availableLiquidity[i] = balanceInPUSD;
                totalLiquidityPUSD += balanceInPUSD;
            }
        }

        require(totalLiquidityPUSD >= pusdAmount, "PUSDManager: insufficient liquidity for emergency redemption");

        // Burn PUSD upfront (from explicit source — vault for v2 compose,
        // user for direct redeem).
        pusd.burn(burnFrom, pusdAmount);

        // Distribute proportionally across preferred + emergency tokens
        uint256 remainingPUSD = pusdAmount;

        for (uint256 i = 0; i < tokenCount && remainingPUSD > 0; i++) {
            if (availableLiquidity[i] == 0) continue;

            uint256 tokenSharePUSD = (pusdAmount * availableLiquidity[i]) / totalLiquidityPUSD;

            if (tokenSharePUSD > remainingPUSD) {
                tokenSharePUSD = remainingPUSD;
            }
            if (tokenSharePUSD > availableLiquidity[i]) {
                tokenSharePUSD = availableLiquidity[i];
            }

            if (tokenSharePUSD > 0) {
                _payShare(tokenList[i], tokenSharePUSD, effectiveBaseFee, recipient);
                remainingPUSD -= tokenSharePUSD;
                availableLiquidity[i] -= tokenSharePUSD;
            }
        }

        // Handle rounding remainder
        if (remainingPUSD > 0) {
            uint256 maxLiquidityIndex = 0;
            uint256 maxLiquidity = 0;

            for (uint256 i = 0; i < tokenCount; i++) {
                if (availableLiquidity[i] > maxLiquidity) {
                    maxLiquidity = availableLiquidity[i];
                    maxLiquidityIndex = i;
                }
            }

            require(maxLiquidity >= remainingPUSD, "PUSDManager: unable to fully redeem PUSD");

            _payShare(tokenList[maxLiquidityIndex], remainingPUSD, effectiveBaseFee, recipient);
        }
    }

    function _executeRedeem(
        address token,
        uint256 pusdAmount,
        uint256 tokenAmount,
        bool shouldBurn,
        uint256 feeBps,
        address recipient
    ) internal {
        if (shouldBurn) {
            pusd.burn(msg.sender, pusdAmount);
        }

        // Calculate fee and keep it in contract for gas efficiency
        // Fees will be swept later along with surplus (if treasury is set)
        uint256 feeAmount = 0;
        if (feeBps > 0) {
            feeAmount = (tokenAmount * feeBps) / BASIS_POINTS;
            // Track accrued fees
            accruedFees[token] += feeAmount;
            emit SurplusAccrued(token, feeAmount, 0);
        }

        // Transfer only user amount (fees stay in contract)
        uint256 userAmount = tokenAmount - feeAmount;
        IERC20(token).safeTransfer(recipient, userAmount);
        emit Redeemed(msg.sender, token, pusdAmount, userAmount, recipient);
    }

    function _normalizeDecimalsToPUSD(uint256 amount, uint8 tokenDecimals) internal pure returns (uint256) {
        uint8 pusdDecimals = 6;

        if (tokenDecimals == pusdDecimals) {
            return amount;
        } else if (tokenDecimals > pusdDecimals) {
            return amount / (10 ** (tokenDecimals - pusdDecimals));
        } else {
            return amount * (10 ** (pusdDecimals - tokenDecimals));
        }
    }

    /**
     * @notice Calculate available liquidity for a token (excluding reserved surplus)
     * @param token The token address
     * @return Available balance that can be used for redemptions
     */
    function _getAvailableLiquidity(address token) internal view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 reserved = accruedFees[token] + accruedHaircut[token];
        return balance > reserved ? balance - reserved : 0;
    }

    function _convertFromPUSD(uint256 pusdAmount, uint8 tokenDecimals) internal pure returns (uint256) {
        uint8 pusdDecimals = 6;

        if (tokenDecimals == pusdDecimals) {
            return pusdAmount;
        } else if (tokenDecimals > pusdDecimals) {
            return pusdAmount * (10 ** (tokenDecimals - pusdDecimals));
        } else {
            return pusdAmount / (10 ** (pusdDecimals - tokenDecimals));
        }
    }

    function _calculatePreferredFee(address token) internal view returns (uint256) {
        if (preferredFeeMin == 0 && preferredFeeMax == 0) {
            return 0;
        }

        // Calculate token's liquidity as percentage of total
        TokenInfo memory tokenInfo = supportedTokens[token];
        uint256 tokenBalance = _getAvailableLiquidity(token);
        uint256 tokenBalanceInPUSD = _normalizeDecimalsToPUSD(tokenBalance, tokenInfo.decimals);

        // Calculate total liquidity across all non-REMOVED tokens
        uint256 totalLiquidityPUSD = 0;
        for (uint256 i = 0; i < tokenCount; i++) {
            address t = tokenList[i];
            TokenInfo memory info = supportedTokens[t];
            if (info.status == TokenStatus.REMOVED) continue;

            uint256 balance = _getAvailableLiquidity(t);
            totalLiquidityPUSD += _normalizeDecimalsToPUSD(balance, info.decimals);
        }

        if (totalLiquidityPUSD == 0) {
            return preferredFeeMax;
        }

        // Calculate liquidity percentage (in basis points)
        uint256 liquidityPercentage = (tokenBalanceInPUSD * BASIS_POINTS) / totalLiquidityPUSD;

        // Higher liquidity = lower fee, lower liquidity = higher fee
        // If token has 50%+ liquidity, use min fee
        // If token has <10% liquidity, use max fee
        // Linear interpolation between 10% and 50%
        if (liquidityPercentage >= 5000) {
            // >= 50%
            return preferredFeeMin;
        } else if (liquidityPercentage <= 1000) {
            // <= 10%
            return preferredFeeMax;
        } else {
            // Linear interpolation between 10% and 50%
            // fee = max - ((liquidity% - 10%) / 40%) * (max - min)
            uint256 range = liquidityPercentage - 1000; // 0 to 4000
            uint256 feeRange = preferredFeeMax - preferredFeeMin;
            uint256 feeReduction = (range * feeRange) / 4000;
            return preferredFeeMax - feeReduction;
        }
    }

    function getSupportedTokensCount() external view returns (uint256) {
        return tokenCount;
    }

    function getSupportedTokenAt(uint256 index) external view returns (address) {
        require(index < tokenCount, "PUSDManager: index out of bounds");
        return tokenList[index];
    }

    function isTokenSupported(address token) external view returns (bool) {
        TokenStatus status = supportedTokens[token].status;
        return
            status == TokenStatus.ENABLED || status == TokenStatus.REDEEM_ONLY || status == TokenStatus.EMERGENCY_REDEEM;
    }

    function getTokenStatus(address token) external view returns (TokenStatus) {
        return supportedTokens[token].status;
    }

    function getTokenInfo(address token) external view returns (TokenInfo memory) {
        return supportedTokens[token];
    }

    /**
     * @notice Get accrued fees for a token (not yet swept)
     * @param token The token address
     * @return Amount of redemption fees accumulated
     */
    function getAccruedFees(address token) external view returns (uint256) {
        return accruedFees[token];
    }

    /**
     * @notice Get accrued haircut for a token (not yet swept)
     * @param token The token address
     * @return Amount of deposit haircut accumulated
     */
    function getAccruedHaircut(address token) external view returns (uint256) {
        return accruedHaircut[token];
    }

    /**
     * @notice Get total accrued surplus (fees + haircut) for a token
     * @param token The token address
     * @return Total surplus that can be swept
     */
    function getAccruedSurplus(address token) external view returns (uint256) {
        return accruedFees[token] + accruedHaircut[token];
    }

    /**
     * @notice Get total fees swept to treasury for a token
     * @param token The token address
     * @return Total redemption fees swept historically
     */
    function getSweptFees(address token) external view returns (uint256) {
        return sweptFees[token];
    }

    /**
     * @notice Get total haircut swept to treasury for a token
     * @param token The token address
     * @return Total deposit haircut swept historically
     */
    function getSweptHaircut(address token) external view returns (uint256) {
        return sweptHaircut[token];
    }

    /**
     * @notice Get total surplus swept to treasury for a token
     * @param token The token address
     * @return Total surplus (fees + haircut) swept historically
     */
    function getTotalSwept(address token) external view returns (uint256) {
        return sweptFees[token] + sweptHaircut[token];
    }

    /**
     * @notice Get comprehensive surplus breakdown for a token
     * @param token The token address
     * @return accruedFee Current accrued redemption fees
     * @return accruedHaircutAmount Current accrued deposit haircut
     * @return sweptFee Total redemption fees swept historically
     * @return sweptHaircutAmount Total deposit haircut swept historically
     */
    function getSurplusBreakdown(address token)
        external
        view
        returns (uint256 accruedFee, uint256 accruedHaircutAmount, uint256 sweptFee, uint256 sweptHaircutAmount)
    {
        return (accruedFees[token], accruedHaircut[token], sweptFees[token], sweptHaircut[token]);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}

    // =====================================================================
    // v2 — PUSD+ composed entrypoints + setters
    // =====================================================================

    /**
     * @notice One-shot mint of PUSD+ (v2.1).
     *
     *         Direct path (tokenIn != PUSD):
     *           Pulls full amount to manager, accrues surplusHaircut, forwards
     *           net to vault. NO PUSD minted on this path; pusd.totalSupply is
     *           unchanged. Reverts if tokenIn is not in the vault's basket
     *           (would otherwise strand reserves outside the NAV-counted set).
     *
     *         Wrap path (tokenIn == PUSD):
     *           Burns caller's PUSD via _executeBasketRedeemFrom and pays a
     *           proportional basket of reserves to the vault. effectiveBaseFee = 0
     *           (vault is fee-exempt; this is a protocol-internal compose).
     *           Reverts if manager has insufficient total reserve liquidity.
     *
     * @dev    I1 preserved on both paths. Direct path doesn't touch PUSD supply
     *         or alter manager's PUSD-backing balance (haircut is isolated by
     *         accruedHaircut). Wrap path drops PUSD totalSupply and manager
     *         reserves by exactly `amount` PUSD-equivalent in the same call frame.
     */
    function depositToPlus(address tokenIn, uint256 amount, address recipient) external nonReentrant {
        require(plusVault != address(0), "PUSDManager: plusVault unset");
        require(amount > 0, "PUSDManager: amount must be greater than 0");
        require(recipient != address(0), "PUSDManager: recipient cannot be zero address");

        if (tokenIn == address(pusd)) {
            // Wrap path: burn PUSD from caller, pay basket reserves to vault.
            _executeBasketRedeemFrom(amount, plusVault, msg.sender, 0);
            uint256 plusOutWrap = IPUSDPlusVault(plusVault).mintPlus(amount, recipient);
            emit DepositedToPlus(msg.sender, tokenIn, amount, plusOutWrap, recipient);
            return;
        }

        // Direct path.
        TokenInfo memory tokenInfo = supportedTokens[tokenIn];
        require(tokenInfo.status == TokenStatus.ENABLED, "PUSDManager: token not enabled for deposits");

        // Defensive: ensure vault counts this token in NAV. Without this,
        // forwarded reserves would sit in vault.balanceOf but not be counted
        // in idleReservesPusd, and mintPlus would revert on `ta >= pusdIn`
        // with a non-obvious error.
        require(IPUSDPlusVault(plusVault).inBasket(tokenIn), "PUSDManager: token not in vault basket");

        // Pull to manager so the surplus haircut accrues alongside v1 `deposit`.
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amount);

        uint256 surplusTokenAmount = (amount * tokenInfo.surplusHaircutBps) / BASIS_POINTS;
        uint256 netTokenAmount = amount - surplusTokenAmount;
        if (surplusTokenAmount > 0) {
            accruedHaircut[tokenIn] += surplusTokenAmount;
            emit SurplusAccrued(tokenIn, 0, surplusTokenAmount);
        }

        // Forward net to the vault — vault.basket counts this in idleReservesPusd.
        IERC20(tokenIn).safeTransfer(plusVault, netTokenAmount);

        uint256 pusdValue = _normalizeDecimalsToPUSD(netTokenAmount, tokenInfo.decimals);
        uint256 plusOutDirect = IPUSDPlusVault(plusVault).mintPlus(pusdValue, recipient);

        emit DepositedToPlus(msg.sender, tokenIn, amount, plusOutDirect, recipient);
    }

    /**
     * @notice One-shot redeem of PUSD+. Calls vault.burnPlus to compute pusdOwed
     *         and move PUSD into this contract, then either forwards PUSD direct
     *         (when preferredAsset == PUSD) or runs the existing reserve payout
     *         logic with fees zeroed (this is a protocol-internal compose, not
     *         a fresh user redeem).
     */
    function redeemFromPlus(uint256 plusAmount, address preferredAsset, bool allowBasket, address recipient)
        external
        nonReentrant
    {
        require(plusVault != address(0), "PUSDManager: plusVault unset");
        require(plusAmount > 0, "PUSDManager: amount must be greater than 0");
        require(recipient != address(0), "PUSDManager: recipient cannot be zero address");

        // Vault burns PUSD+ from msg.sender, hands PUSD to this contract (or
        // queues a residual). `pusdReturned` is what's already on hand right now.
        // queueId is captured by the BurnedPlus event in the vault and the
        // QueueClaimFilled event later — no need to thread it through here.
        (uint256 pusdReturned,) =
            IPUSDPlusVault(plusVault).burnPlus(plusAmount, msg.sender, address(this), preferredAsset, allowBasket);

        // queueId != 0 → user accepted the NAV at this block and waits.
        // Settlement happens later via vault.fulfillQueueClaim.
        if (pusdReturned == 0) {
            emit RedeemedFromPlus(msg.sender, plusAmount, preferredAsset, allowBasket, recipient);
            return;
        }

        if (preferredAsset == address(pusd)) {
            // Unwrap path: forward PUSD direct. No fee, no reserve leg.
            IERC20(address(pusd)).safeTransfer(recipient, pusdReturned);
        } else {
            // Compose path: burn vault-supplied PUSD and pay reserves to user.
            // Fees are zero — this is a protocol-internal compose, distinct
            // from a user's direct redeem and from vault-initiated LP seeding.
            _payoutToUser(pusdReturned, preferredAsset, allowBasket, recipient);
        }
        emit RedeemedFromPlus(msg.sender, plusAmount, preferredAsset, allowBasket, recipient);
    }

    /**
     * @dev Internal payout used by redeemFromPlus. Mirrors the public redeem's
     *      preferred → basket → emergency cascade but charges zero fees and
     *      burns PUSD from this contract (rather than the user) since the user
     *      already paid by burning PUSD+ in the vault.
     */
    function _payoutToUser(uint256 pusdAmount, address preferredAsset, bool allowBasket, address recipient) internal {
        bool hasEmergencyTokens = _hasEmergencyTokens();
        TokenInfo memory preferredInfo = supportedTokens[preferredAsset];
        bool isPreferredValid = preferredInfo.status == TokenStatus.ENABLED
            || preferredInfo.status == TokenStatus.REDEEM_ONLY || preferredInfo.status == TokenStatus.EMERGENCY_REDEEM;

        if (isPreferredValid && !hasEmergencyTokens) {
            uint256 requiredAmount = _convertFromPUSD(pusdAmount, preferredInfo.decimals);
            if (_getAvailableLiquidity(preferredAsset) >= requiredAmount) {
                // Burn the manager's PUSD (received from vault) directly.
                pusd.burn(address(this), pusdAmount);
                // shouldBurn = false — burn already done above; fee = 0.
                _executeRedeem(preferredAsset, pusdAmount, requiredAmount, false, 0, recipient);
                return;
            }
        }

        if (hasEmergencyTokens && isPreferredValid) {
            // Emergency cascade: helper burns its own argument from `burnFrom`.
            _executeEmergencyRedeemFrom(pusdAmount, preferredAsset, recipient, address(this), 0);
            return;
        }

        require(allowBasket, "PUSDManager: preferred asset unavailable and basket not allowed");
        _executeBasketRedeemFrom(pusdAmount, recipient, address(this), 0);
    }

    /**
     * @notice Set the PUSD+ vault address. DEFAULT_ADMIN (= timelock) only.
     * @dev    Once set, fee exemption must be granted explicitly via
     *         setFeeExempt. The two operations are intentionally separate so an
     *         admin can pause exemption without rotating the vault address.
     */
    function setPlusVault(address vault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(vault != address(0), "PUSDManager: vault cannot be zero address");
        emit PlusVaultUpdated(plusVault, vault);
        plusVault = vault;
    }

    /**
     * @notice Toggle fee-exempt status for an account. ADMIN_ROLE-gated.
     * @dev    The redeem fee-exempt branch checks BOTH msg.sender == plusVault
     *         AND feeExempt[plusVault] — flipping the mapping pauses the
     *         exemption without rotating the address.
     */
    function setFeeExempt(address account, bool exempt) external onlyRole(ADMIN_ROLE) {
        require(account != address(0), "PUSDManager: account cannot be zero address");
        feeExempt[account] = exempt;
        emit FeeExemptSet(account, exempt);
    }

    /**
     * @notice Vault-only deposit path used during burnPlus / fulfillQueueClaim
     *         to convert idle non-PUSD reserves back into PUSD.
     *
     * @dev    Differences from the public `deposit`:
     *           1. No nonReentrant — `deposit` and `redeemFromPlus` both take
     *              the manager's lock; without this bypass, vault.burnPlus
     *              (called from inside redeemFromPlus) would deadlock when it
     *              tries to convert idle reserves back to PUSD.
     *           2. No surplus haircut — this is a protocol-internal value-
     *              preserving conversion, not a user mint. Applying the haircut
     *              here would silently bleed value from PUSD+ holders.
     *           3. Restricted to plusVault AND feeExempt — same gate as the
     *              public redeem fee-exempt branch.
     *
     *         Caller (vault) MUST have approved this contract for `amount`.
     */
    function depositForVault(address token, uint256 amount) external returns (uint256 pusdMinted) {
        require(msg.sender == plusVault && feeExempt[plusVault], "PUSDManager: not vault");
        TokenInfo memory info = supportedTokens[token];
        require(info.exists && info.status == TokenStatus.ENABLED, "PUSDManager: token not enabled");
        require(amount > 0, "PUSDManager: amount must be greater than 0");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        pusdMinted = _normalizeDecimalsToPUSD(amount, info.decimals);
        pusd.mint(msg.sender, pusdMinted);
        return pusdMinted;
    }

    /// @dev Reserve gap for future v2 patch versions without colliding with v3+.
    uint256[48] private __gap_v2;
}

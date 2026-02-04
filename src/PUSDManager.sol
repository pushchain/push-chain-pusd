// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./PUSD.sol";

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
        REMOVED,         // Token completely removed - cannot deposit or redeem
        ENABLED,         // Can deposit and can redeem as preferred and as basket leg
        REDEEM_ONLY,     // Cannot deposit, but can still be used in basket/redemptions
        EMERGENCY_REDEEM // Cannot deposit, forces proportional redemption to drain this token
    }

    struct TokenInfo {
        bool exists;
        TokenStatus status;
        uint8 decimals;
        string name;
        string chainNamespace;
    }

    mapping(address => TokenInfo) public supportedTokens;
    mapping(uint256 => address) public tokenList;
    mapping(address => uint256) private tokenIndex;
    uint256 public tokenCount;

    address public feeCollector;
    uint256 public baseFee;           // Base fee in basis points (e.g., 5 = 0.05%)
    uint256 public preferredFeeMin;   // Min preferred fee in basis points
    uint256 public preferredFeeMax;   // Max preferred fee in basis points

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private constant BASIS_POINTS = 10000; // 100% = 10000 basis points

    event TokenAdded(address indexed token, string name, string chainNamespace, uint8 decimals);
    event TokenStatusChanged(address indexed token, TokenStatus oldStatus, TokenStatus newStatus);
    event Deposited(address indexed user, address indexed token, uint256 tokenAmount, uint256 pusdMinted);
    event Redeemed(address indexed user, address indexed token, uint256 pusdBurned, uint256 tokenAmount);
    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event BaseFeeUpdated(uint256 oldFee, uint256 newFee);
    event PreferredFeeRangeUpdated(uint256 oldMin, uint256 oldMax, uint256 newMin, uint256 newMax);
    event FeeCollected(address indexed token, uint256 amount, uint256 feeType);

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

    function addSupportedToken(
        address token,
        string memory name,
        string memory chainNamespace,
        uint8 decimals
    ) external onlyRole(ADMIN_ROLE) {
        require(token != address(0), "PUSDManager: token address cannot be zero");
        require(!supportedTokens[token].exists, "PUSDManager: token already added");
        require(decimals > 0 && decimals <= 18, "PUSDManager: invalid decimals");

        supportedTokens[token] = TokenInfo({
            exists: true,
            status: TokenStatus.ENABLED,
            decimals: decimals,
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

    function setFeeCollector(address newFeeCollector) external onlyRole(ADMIN_ROLE) {
        require(newFeeCollector != address(0), "PUSDManager: fee collector cannot be zero address");
        address oldCollector = feeCollector;
        feeCollector = newFeeCollector;
        emit FeeCollectorUpdated(oldCollector, newFeeCollector);
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

    function deposit(address token, uint256 amount) external nonReentrant {
        TokenInfo memory tokenInfo = supportedTokens[token];
        require(tokenInfo.status == TokenStatus.ENABLED, "PUSDManager: token not enabled for deposits");
        require(amount > 0, "PUSDManager: amount must be greater than 0");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 pusdAmount = _convertToPUSD(amount, tokenInfo.decimals);

        pusd.mint(msg.sender, pusdAmount);

        emit Deposited(msg.sender, token, amount, pusdAmount);
    }

    function redeem(
        uint256 pusdAmount,
        address preferredAsset,
        bool allowBasket
    ) external nonReentrant {
        require(pusdAmount > 0, "PUSDManager: amount must be greater than 0");
        require(pusd.balanceOf(msg.sender) >= pusdAmount, "PUSDManager: insufficient PUSD balance");
        
        // Check if any token is in EMERGENCY_REDEEM status
        bool hasEmergencyTokens = _hasEmergencyTokens();
        
        // Check if preferred asset is valid and has sufficient liquidity
        TokenInfo memory preferredInfo = supportedTokens[preferredAsset];
        bool isPreferredValid = preferredInfo.status == TokenStatus.ENABLED || 
                                preferredInfo.status == TokenStatus.REDEEM_ONLY ||
                                preferredInfo.status == TokenStatus.EMERGENCY_REDEEM;
        
        if (isPreferredValid && !hasEmergencyTokens) {
            uint256 requiredAmount = _convertFromPUSD(pusdAmount, preferredInfo.decimals);
            
            if (IERC20(preferredAsset).balanceOf(address(this)) >= requiredAmount) {
                // Preferred asset is available and no emergency tokens, use it
                // Charge base fee + preferred fee
                uint256 preferredFee = _calculatePreferredFee(preferredAsset);
                uint256 totalFee = baseFee + preferredFee;
                _executeRedeem(preferredAsset, pusdAmount, requiredAmount, true, totalFee);
                return;
            }
        }
        
        // If emergency tokens exist, force proportional redemption with preferred + emergency
        if (hasEmergencyTokens && isPreferredValid) {
            _executeEmergencyRedeem(pusdAmount, preferredAsset);
            return;
        }
        
        // Preferred asset not available or insufficient liquidity
        require(allowBasket, "PUSDManager: preferred asset unavailable and basket not allowed");
        
        // Try basket redemption across multiple tokens
        _executeBasketRedeem(pusdAmount);
    }
    
    function _executeBasketRedeem(uint256 pusdAmount) internal {
        // Calculate total available liquidity across all tokens (in PUSD terms)
        uint256 totalLiquidityPUSD = 0;
        uint256[] memory availableLiquidity = new uint256[](tokenCount);
        
        for (uint256 i = 0; i < tokenCount; i++) {
            address token = tokenList[i];
            TokenInfo memory info = supportedTokens[token];
            if (info.status == TokenStatus.REMOVED) continue;
            
            uint256 balance = IERC20(token).balanceOf(address(this));
            uint256 balanceInPUSD = _convertToPUSD(balance, info.decimals);
            
            availableLiquidity[i] = balanceInPUSD;
            totalLiquidityPUSD += balanceInPUSD;
        }
        
        require(totalLiquidityPUSD >= pusdAmount, "PUSDManager: insufficient total liquidity");
        
        // Burn PUSD once upfront
        pusd.burn(msg.sender, pusdAmount);
        
        // Distribute redemption proportionally across tokens
        uint256 remainingPUSD = pusdAmount;
        
        for (uint256 i = 0; i < tokenCount && remainingPUSD > 0; i++) {
            if (availableLiquidity[i] == 0) continue;
            
            address token = tokenList[i];
            TokenInfo memory info = supportedTokens[token];
            
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
                uint256 tokenAmount = _convertFromPUSD(tokenSharePUSD, info.decimals);
                _executeRedeem(token, tokenSharePUSD, tokenAmount, false, baseFee);
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
            
            address token = tokenList[maxLiquidityIndex];
            TokenInfo memory info = supportedTokens[token];
            uint256 tokenAmount = _convertFromPUSD(remainingPUSD, info.decimals);
            _executeRedeem(token, remainingPUSD, tokenAmount, false, baseFee);
        }
    }
    
    function _hasEmergencyTokens() internal view returns (bool) {
        for (uint256 i = 0; i < tokenCount; i++) {
            address token = tokenList[i];
            if (supportedTokens[token].status == TokenStatus.EMERGENCY_REDEEM) {
                uint256 balance = IERC20(token).balanceOf(address(this));
                if (balance > 0) {
                    return true;
                }
            }
        }
        return false;
    }
    
    function _executeEmergencyRedeem(uint256 pusdAmount, address preferredAsset) internal {
        // Calculate total liquidity of preferred + emergency tokens
        uint256 totalLiquidityPUSD = 0;
        uint256[] memory availableLiquidity = new uint256[](tokenCount);
        
        TokenInfo memory preferredInfo = supportedTokens[preferredAsset];
        uint256 preferredBalance = IERC20(preferredAsset).balanceOf(address(this));
        uint256 preferredBalanceInPUSD = _convertToPUSD(preferredBalance, preferredInfo.decimals);
        
        // Track preferred asset index
        uint256 preferredIndex = tokenIndex[preferredAsset];
        availableLiquidity[preferredIndex] = preferredBalanceInPUSD;
        totalLiquidityPUSD += preferredBalanceInPUSD;
        
        // Add all emergency tokens
        for (uint256 i = 0; i < tokenCount; i++) {
            if (i == preferredIndex) continue;
            
            address token = tokenList[i];
            TokenInfo memory info = supportedTokens[token];
            
            if (info.status == TokenStatus.EMERGENCY_REDEEM) {
                uint256 balance = IERC20(token).balanceOf(address(this));
                uint256 balanceInPUSD = _convertToPUSD(balance, info.decimals);
                availableLiquidity[i] = balanceInPUSD;
                totalLiquidityPUSD += balanceInPUSD;
            }
        }
        
        require(totalLiquidityPUSD >= pusdAmount, "PUSDManager: insufficient liquidity for emergency redemption");
        
        // Burn PUSD upfront
        pusd.burn(msg.sender, pusdAmount);
        
        // Distribute proportionally across preferred + emergency tokens
        uint256 remainingPUSD = pusdAmount;
        
        for (uint256 i = 0; i < tokenCount && remainingPUSD > 0; i++) {
            if (availableLiquidity[i] == 0) continue;
            
            address token = tokenList[i];
            TokenInfo memory info = supportedTokens[token];
            
            uint256 tokenSharePUSD = (pusdAmount * availableLiquidity[i]) / totalLiquidityPUSD;
            
            if (tokenSharePUSD > remainingPUSD) {
                tokenSharePUSD = remainingPUSD;
            }
            if (tokenSharePUSD > availableLiquidity[i]) {
                tokenSharePUSD = availableLiquidity[i];
            }
            
            if (tokenSharePUSD > 0) {
                uint256 tokenAmount = _convertFromPUSD(tokenSharePUSD, info.decimals);
                _executeRedeem(token, tokenSharePUSD, tokenAmount, false, baseFee);
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
            
            address token = tokenList[maxLiquidityIndex];
            TokenInfo memory info = supportedTokens[token];
            uint256 tokenAmount = _convertFromPUSD(remainingPUSD, info.decimals);
            _executeRedeem(token, remainingPUSD, tokenAmount, false, baseFee);
        }
    }
    
    function _executeRedeem(address token, uint256 pusdAmount, uint256 tokenAmount, bool shouldBurn, uint256 feeBps) internal {
        if (shouldBurn) {
            pusd.burn(msg.sender, pusdAmount);
        }
        
        // Calculate and collect fee
        uint256 feeAmount = 0;
        if (feeBps > 0 && feeCollector != address(0)) {
            feeAmount = (tokenAmount * feeBps) / BASIS_POINTS;
            if (feeAmount > 0) {
                IERC20(token).safeTransfer(feeCollector, feeAmount);
                emit FeeCollected(token, feeAmount, feeBps);
            }
        }
        
        // Transfer remaining amount to user
        uint256 userAmount = tokenAmount - feeAmount;
        IERC20(token).safeTransfer(msg.sender, userAmount);
        emit Redeemed(msg.sender, token, pusdAmount, userAmount);
    }

    function _convertToPUSD(uint256 amount, uint8 tokenDecimals) internal pure returns (uint256) {
        uint8 pusdDecimals = 6;
        
        if (tokenDecimals == pusdDecimals) {
            return amount;
        } else if (tokenDecimals > pusdDecimals) {
            return amount / (10 ** (tokenDecimals - pusdDecimals));
        } else {
            return amount * (10 ** (pusdDecimals - tokenDecimals));
        }
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
        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        uint256 tokenBalanceInPUSD = _convertToPUSD(tokenBalance, tokenInfo.decimals);
        
        // Calculate total liquidity across all non-REMOVED tokens
        uint256 totalLiquidityPUSD = 0;
        for (uint256 i = 0; i < tokenCount; i++) {
            address t = tokenList[i];
            TokenInfo memory info = supportedTokens[t];
            if (info.status == TokenStatus.REMOVED) continue;
            
            uint256 balance = IERC20(t).balanceOf(address(this));
            totalLiquidityPUSD += _convertToPUSD(balance, info.decimals);
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
        if (liquidityPercentage >= 5000) { // >= 50%
            return preferredFeeMin;
        } else if (liquidityPercentage <= 1000) { // <= 10%
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
        return status == TokenStatus.ENABLED || status == TokenStatus.REDEEM_ONLY || status == TokenStatus.EMERGENCY_REDEEM;
    }

    function getTokenStatus(address token) external view returns (TokenStatus) {
        return supportedTokens[token].status;
    }

    function getTokenInfo(address token) external view returns (TokenInfo memory) {
        return supportedTokens[token];
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}
}

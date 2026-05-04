// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IInsuranceFund.sol";

/**
 * @title  InsuranceFund
 * @notice Passive destination for the PUSD+ vault haircut (default 2% of LP fees).
 *         No autonomous behaviour at v0; balances are inspected by governance and
 *         pulled out via `withdraw` once the design-doc review marks are hit
 *         (1% TVL → phase 2 fee tier; 5% TVL → haircut review).
 *
 * @dev    Roles:
 *           DEFAULT_ADMIN_ROLE    timelock — upgrade authority, role grants.
 *           VAULT_ADMIN_ROLE      multisig — withdraw, set sweep destination.
 *           GUARDIAN_ROLE         pause-only multisig.
 *
 *         PUSDPlusVault calls notifyDeposit AFTER transferring tokens. notify is
 *         purely informative — onchain balances are the source of truth.
 */
contract InsuranceFund is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IInsuranceFund
{
    using SafeERC20 for IERC20;

    // -- inline reentrancy guard (matches PUSDManager's pattern; OZ 5.x's
    //    ReentrancyGuardUpgradeable variant has been removed) -----------
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;
    uint256 private _reentrancyStatus;

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "InsuranceFund: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    bytes32 public constant VAULT_ADMIN_ROLE = keccak256("INSURANCE_FUND_VAULT_ADMIN_ROLE");
    bytes32 public constant GUARDIAN_ROLE    = keccak256("INSURANCE_FUND_GUARDIAN_ROLE");

    /// @notice Vault contract permitted to call notifyDeposit. Set once.
    address public vault;

    /// @notice Cumulative deposits per token (informational; balanceOf is truth).
    mapping(address => uint256) public cumulativeDeposited;

    event Deposited(address indexed token, uint256 amount, uint256 cumulative);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event VaultUpdated(address indexed oldVault, address indexed newVault);

    error InsuranceFund_ZeroAddress();
    error InsuranceFund_NotVault();

    uint256[40] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address admin, address vaultAdmin, address guardian) external initializer {
        if (admin == address(0) || vaultAdmin == address(0) || guardian == address(0))
            revert InsuranceFund_ZeroAddress();

        __AccessControl_init();
        __Pausable_init();

        _reentrancyStatus = _NOT_ENTERED;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VAULT_ADMIN_ROLE,   vaultAdmin);
        _grantRole(GUARDIAN_ROLE,      guardian);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /// @notice Set the vault that may notify. Settable by DEFAULT_ADMIN (timelock).
    function setVault(address _vault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_vault == address(0)) revert InsuranceFund_ZeroAddress();
        emit VaultUpdated(vault, _vault);
        vault = _vault;
    }

    /// @inheritdoc IInsuranceFund
    function notifyDeposit(address token, uint256 amount) external override whenNotPaused {
        if (msg.sender != vault) revert InsuranceFund_NotVault();
        cumulativeDeposited[token] += amount;
        emit Deposited(token, amount, cumulativeDeposited[token]);
    }

    /// @inheritdoc IInsuranceFund
    function balanceOf(address token) external view override returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// @notice Withdraw fund holdings. VAULT_ADMIN-gated. Use case: governance has
    ///         hit a review mark and wants to redirect surplus.
    function withdraw(address token, address to, uint256 amount)
        external
        nonReentrant
        whenNotPaused
        onlyRole(VAULT_ADMIN_ROLE)
    {
        if (to == address(0)) revert InsuranceFund_ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }

    function pause() external onlyRole(GUARDIAN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}

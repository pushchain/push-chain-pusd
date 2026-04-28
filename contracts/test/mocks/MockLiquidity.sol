// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../src/interfaces/IPUSDLiquidity.sol";

/**
 * @title MockLiquidity
 * @notice Minimal IPUSDLiquidity stub for unit tests. Books an internal "returnable" budget
 *         per token and pays out from its own balance up to that budget on `pullForWithdraw`.
 *         No NAV, no positions — that's exercised by the real PUSDLiquidity contract's tests.
 */
contract MockLiquidity is IPUSDLiquidity {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public returnable;
    mapping(address => uint256) public totalPulled;

    /// @notice Virtual reported NAV in PUSD-equivalent units, settable by tests.
    uint256 public reportedNAV;

    function setReturnable(address token, uint256 amount) external {
        returnable[token] = amount;
    }

    function setNAV(uint256 nav) external {
        reportedNAV = nav;
    }

    // ---- IPUSDLiquidity --------------------------------------------------

    function netAssetsInPUSD() external view override returns (uint256) {
        return reportedNAV;
    }

    function idleBalance(address token) external view override returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function pullForWithdraw(address token, uint256 amount, address recipient)
        external
        override
        returns (uint256 delivered)
    {
        uint256 budget = returnable[token];
        uint256 bal = IERC20(token).balanceOf(address(this));
        delivered = amount;
        if (delivered > budget) delivered = budget;
        if (delivered > bal) delivered = bal;
        if (delivered > 0) {
            IERC20(token).safeTransfer(recipient, delivered);
            returnable[token] = budget - delivered;
            totalPulled[token] += delivered;
        }
    }

    /// @dev In the real flow Manager transfers `amount` to this contract first, then calls
    ///      pushForDeploy as a notification. We just track the deposit; no pull required.
    mapping(address => uint256) public totalPushed;

    function pushForDeploy(address token, uint256 amount) external override {
        totalPushed[token] += amount;
    }

    // ---- Pool registry stubs --------------------------------------------
    // Tests against MockLiquidity don't model pools; return empty-registry defaults.

    function isPoolActive(address /*pool*/) external pure override returns (bool) { return false; }
    function poolsLength() external pure override returns (uint256) { return 0; }
    function poolAt(uint256) external pure override returns (address) {
        revert("MockLiquidity: empty pool registry");
    }
}

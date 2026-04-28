// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../src/interfaces/INonfungiblePositionManager.sol";

/**
 * @title MockNonfungiblePositionManager
 * @notice Tracks LP positions in a simplified way that satisfies PUSDLiquidity.
 *         - mint pulls amount0Desired / amount1Desired from the caller and books a Position
 *           with `liquidity := amount0Desired + amount1Desired` (a stand-in scalar).
 *         - decreaseLiquidity and collect release tokens back to the position owner.
 *         - The NPM also acts as the "Uniswap pool" custodian — it physically holds the tokens
 *           between mint and decrease/collect.
 */
contract MockNonfungiblePositionManager is INonfungiblePositionManager {
    using SafeERC20 for IERC20;

    struct Pos {
        address owner;
        address token0;
        address token1;
        uint24  fee;
        int24   tickLower;
        int24   tickUpper;
        uint128 liquidity;     // == amount0 + amount1 booked by mint (stable proxy)
        uint128 amount0Owed;   // tokens released by decreaseLiquidity but not yet collected
        uint128 amount1Owed;
        // For NAV reporting we also book the principal amounts so positions(tokenId) can return the
        // 12-tuple expected by PUSDLiquidity. The "liquidity" PUSDLiquidity reads is the principal-equivalent.
        uint256 principal0;
        uint256 principal1;
    }

    mapping(uint256 => Pos) public pos;
    uint256 public nextId = 1;

    function mint(MintParams calldata p)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        amount0 = p.amount0Desired;
        amount1 = p.amount1Desired;
        liquidity = uint128(amount0 + amount1);
        require(liquidity > 0, "MockNPM: zero liquidity");
        require(amount0 >= p.amount0Min && amount1 >= p.amount1Min, "MockNPM: slippage");

        IERC20(p.token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(p.token1).safeTransferFrom(msg.sender, address(this), amount1);

        tokenId = nextId++;
        pos[tokenId] = Pos({
            owner: msg.sender,
            token0: p.token0,
            token1: p.token1,
            fee: p.fee,
            tickLower: p.tickLower,
            tickUpper: p.tickUpper,
            liquidity: liquidity,
            amount0Owed: 0,
            amount1Owed: 0,
            principal0: amount0,
            principal1: amount1
        });
    }

    function increaseLiquidity(IncreaseLiquidityParams calldata p)
        external
        payable
        returns (uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        Pos storage q = pos[p.tokenId];
        require(q.owner == msg.sender, "MockNPM: not owner");
        amount0 = p.amount0Desired;
        amount1 = p.amount1Desired;
        liquidity = uint128(amount0 + amount1);

        IERC20(q.token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(q.token1).safeTransferFrom(msg.sender, address(this), amount1);

        q.liquidity += liquidity;
        q.principal0 += amount0;
        q.principal1 += amount1;
    }

    function decreaseLiquidity(DecreaseLiquidityParams calldata p)
        external
        payable
        returns (uint256 amount0, uint256 amount1)
    {
        Pos storage q = pos[p.tokenId];
        require(q.owner == msg.sender, "MockNPM: not owner");
        require(p.liquidity <= q.liquidity, "MockNPM: liquidity > available");

        // Pro-rata of the principal — stable behaviour for the unit tests.
        uint128 totalLiq = q.liquidity == 0 ? 1 : q.liquidity;
        amount0 = (q.principal0 * p.liquidity) / totalLiq;
        amount1 = (q.principal1 * p.liquidity) / totalLiq;

        require(amount0 >= p.amount0Min && amount1 >= p.amount1Min, "MockNPM: slippage");

        q.principal0 -= amount0;
        q.principal1 -= amount1;
        q.liquidity  -= p.liquidity;
        q.amount0Owed += uint128(amount0);
        q.amount1Owed += uint128(amount1);
    }

    function collect(CollectParams calldata p)
        external
        payable
        returns (uint256 amount0, uint256 amount1)
    {
        Pos storage q = pos[p.tokenId];
        require(q.owner == msg.sender, "MockNPM: not owner");
        amount0 = q.amount0Owed;
        amount1 = q.amount1Owed;
        if (amount0 > p.amount0Max) amount0 = p.amount0Max;
        if (amount1 > p.amount1Max) amount1 = p.amount1Max;

        if (amount0 > 0) {
            q.amount0Owed -= uint128(amount0);
            IERC20(q.token0).safeTransfer(p.recipient, amount0);
        }
        if (amount1 > 0) {
            q.amount1Owed -= uint128(amount1);
            IERC20(q.token1).safeTransfer(p.recipient, amount1);
        }
    }

    /// @notice Sandbox helper: simulate fee accrual by crediting `tokensOwed` directly.
    function simulateFees(uint256 tokenId, uint128 fees0, uint128 fees1) external {
        Pos storage q = pos[tokenId];
        require(q.owner != address(0), "MockNPM: no position");
        // The fees must already have been transferred to this contract to be transferable on collect.
        q.amount0Owed += fees0;
        q.amount1Owed += fees1;
    }

    function burn(uint256 tokenId) external payable {
        Pos storage q = pos[tokenId];
        require(q.owner == msg.sender, "MockNPM: not owner");
        require(q.liquidity == 0 && q.amount0Owed == 0 && q.amount1Owed == 0, "MockNPM: not empty");
        delete pos[tokenId];
    }

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96  nonce,
            address operator,
            address token0,
            address token1,
            uint24  fee,
            int24   tickLower,
            int24   tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        )
    {
        Pos storage q = pos[tokenId];
        return (
            0, q.owner, q.token0, q.token1, q.fee,
            q.tickLower, q.tickUpper, q.liquidity, 0, 0,
            q.amount0Owed, q.amount1Owed
        );
    }
}

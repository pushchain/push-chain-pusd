// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Test.sol";

import "../../src/PUSD.sol";
import "../../src/PUSDManager.sol";
import "../../src/PUSDPlus.sol";
import "../../src/PUSDLiquidity.sol";

import "../mocks/MockERC20.sol";

/**
 * @title InvariantHandler
 * @notice Stateful handler that drives randomised, bounded mutations across the v2 stack while
 *         the parent test contract checks I-01 (collateralisation), I-01b (PUSD+ pps >= 1.0)
 *         and I-12 (deploy cap) after each call.
 *
 *         Mutation surface:
 *           - Plain mint / redeem against PUSDManager (par slice).
 *           - Vault deposit / redeem against PUSDPlus (yield slice).
 *           - Admin push from Manager.yieldShareReserve into PUSDLiquidity (deploy capital).
 *
 *         Two tokens (`tokenA`, `tokenB`) and two actors (`alice`, `bob`) are pre-funded so the
 *         fuzzer has enough freedom to exercise slice isolation without exhausting balances.
 *
 *         LP position lifecycle (mintPosition / closePosition) is NOT exposed — the Uniswap V3
 *         mocks model balance flow but not realistic price/liquidity dynamics, so position math
 *         under fuzz would be dominated by mock artefacts rather than true invariants.
 */
contract InvariantHandler is Test {
    PUSD          public immutable pusd;
    PUSDManager   public immutable manager;
    PUSDPlus      public immutable plus;
    PUSDLiquidity public immutable liq;
    MockERC20     public immutable tokenA;
    MockERC20     public immutable tokenB;

    address public immutable admin;
    address public immutable alice;
    address public immutable bob;

    // Bounds — kept generous but inside MockERC20 mint headroom (1e6 PUSD per actor per token).
    uint256 public constant MAX_PUSD_AMOUNT  = 100_000 * 1e6; // 100k PUSD-equivalent
    uint256 public constant MAX_TOKEN_AMOUNT = 100_000 * 1e6; // 100k stable

    // Ghost counters for traceability — not asserted, but printed on failure.
    uint256 public callsDepositPlain;
    uint256 public callsRedeemPlain;
    uint256 public callsDepositVault;
    uint256 public callsRedeemVault;
    uint256 public callsPushToLiq;

    constructor(
        PUSD          _pusd,
        PUSDManager   _manager,
        PUSDPlus      _plus,
        PUSDLiquidity _liq,
        MockERC20     _tokenA,
        MockERC20     _tokenB,
        address       _admin,
        address       _alice,
        address       _bob
    ) {
        pusd = _pusd; manager = _manager; plus = _plus; liq = _liq;
        tokenA = _tokenA; tokenB = _tokenB;
        admin = _admin; alice = _alice; bob = _bob;
    }

    // -------------------------------------------------------------------------
    //                      Internal helpers
    // -------------------------------------------------------------------------

    function _pickActor(uint256 seed) internal view returns (address) {
        return (seed & 1 == 0) ? alice : bob;
    }

    function _pickToken(uint256 seed) internal view returns (MockERC20) {
        return (seed & 1 == 0) ? tokenA : tokenB;
    }

    // -------------------------------------------------------------------------
    //                      Mutation surface
    // -------------------------------------------------------------------------

    /// @notice Plain mint of PUSD by depositing a stable into the par slice.
    function depositPlain(uint256 actorSeed, uint256 tokenSeed, uint256 amount) external {
        amount = bound(amount, 1, MAX_TOKEN_AMOUNT);
        address actor = _pickActor(actorSeed);
        MockERC20 token = _pickToken(tokenSeed);

        token.mint(actor, amount);
        vm.startPrank(actor);
        token.approve(address(manager), amount);
        try manager.deposit(address(token), amount, actor) { callsDepositPlain++; }
        catch { /* swallow — handler stays alive */ }
        vm.stopPrank();
    }

    /// @notice Plain redemption of PUSD against the par slice in `tokenOut`.
    function redeemPlain(uint256 actorSeed, uint256 tokenSeed, uint256 amount) external {
        address actor = _pickActor(actorSeed);
        MockERC20 token = _pickToken(tokenSeed);

        uint256 bal = pusd.balanceOf(actor);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);

        vm.prank(actor);
        try manager.redeem(amount, address(token), true, actor) { callsRedeemPlain++; }
        catch { /* path unavailable / fee-rounded out — fine */ }
    }

    /// @notice Vault deposit (stable -> PUSD+ shares).
    function depositVault(uint256 actorSeed, uint256 tokenSeed, uint256 amount) external {
        amount = bound(amount, 1, MAX_TOKEN_AMOUNT);
        address actor = _pickActor(actorSeed);
        MockERC20 token = _pickToken(tokenSeed);

        token.mint(actor, amount);
        vm.startPrank(actor);
        token.approve(address(plus), amount);
        try plus.depositStable(address(token), amount, actor) { callsDepositVault++; }
        catch { /* swallow */ }
        vm.stopPrank();
    }

    /// @notice Vault redemption (PUSD+ shares -> stable).
    function redeemVault(uint256 actorSeed, uint256 tokenSeed, uint256 shareAmount) external {
        address actor = _pickActor(actorSeed);
        MockERC20 token = _pickToken(tokenSeed);

        uint256 sBal = plus.balanceOf(actor);
        if (sBal == 0) return;
        shareAmount = bound(shareAmount, 1, sBal);

        vm.prank(actor);
        try plus.redeemToStable(shareAmount, address(token), actor) { callsRedeemVault++; }
        catch { /* insufficient liquidity / cap revert / etc. — fine */ }
    }

    /// @notice Admin pushes idle yield-slice capital into PUSDLiquidity. Bounded by current
    ///         yieldShareReserve so it never reverts on under-balance.
    function pushToLiquidity(uint256 tokenSeed, uint256 amount) external {
        MockERC20 token = _pickToken(tokenSeed);
        uint256 reserve = manager.yieldShareReserve(address(token));
        if (reserve == 0) return;
        amount = bound(amount, 1, reserve);

        vm.prank(admin);
        try manager.transferYieldToLiquidity(address(token), amount) { callsPushToLiq++; }
        catch { /* deploy cap — fine */ }
    }
}

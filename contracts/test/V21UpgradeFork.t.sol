// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Test.sol";

import "../src/PUSD.sol";
import "../src/PUSDManager.sol";
import "../src/PUSDPlusVault.sol";

/**
 * @notice Fork test against the live Donut testnet — loads Deployment 4 state
 *         (PUSD, PUSDManager v2, PUSDPlusVault, InsuranceFund all deployed)
 *         and exercises the v2.1 PUSDManager impl swap. Verifies storage
 *         preservation, role preservation, direct-deposit semantics, and
 *         legacy PUSD-in-vault handling.
 *
 *         Run with:
 *           forge test --match-contract V21UpgradeFork \
 *             --fork-url https://evm.donut.rpc.push.org/ -vv
 *
 *         Skipped when not running on a fork.
 */
contract V21UpgradeForkTest is Test {
    address constant ADMIN = 0xA1c1AF949C5752E9714cFE54f444cE80f078069A;
    address constant PUSD_PROXY = 0x488d080e16386379561a47A4955D22001d8A9D89;
    address constant MANAGER_PROXY = 0x7A24Eea43a1095e9Dc652AB9Cba156a93Ed5Ed46;
    address constant VAULT_PROXY = 0xb55a5B36d82D3B7f18Afe42F390De565080A49a1;
    address constant IF_PROXY = 0xFF7E741621ad5d39015759E3d606A631Fa319a62;

    function setUp() public {
        // Skip if not on a fork — `forge test` without --fork-url has block.chainid=31337.
        vm.skip(block.chainid != 42101);
    }

    function _runV21Upgrade() internal {
        PUSDManager newImpl = new PUSDManager();
        emit log_named_address("New PUSDManager v2.1 impl", address(newImpl));

        vm.prank(ADMIN);
        (bool ok, bytes memory ret) =
            MANAGER_PROXY.call(abi.encodeWithSignature("upgradeToAndCall(address,bytes)", address(newImpl), bytes("")));
        if (!ok) {
            emit log_bytes(ret);
            revert("upgradeToAndCall reverted");
        }
    }

    /// @dev Critical — pre-existing PUSD+ holders' NAV must not change across
    ///      the v2.1 impl swap. Storage layout is preserved; vault state is
    ///      untouched; only PUSDManager.depositToPlus body changes.
    function testFork_v21UpgradePreservesNAV() public {
        PUSDPlusVault vault = PUSDPlusVault(VAULT_PROXY);
        uint256 navBefore = vault.nav();
        uint256 supplyBefore = vault.totalSupply();
        uint256 totalAssetsBefore = vault.totalAssets();

        _runV21Upgrade();

        assertEq(vault.nav(), navBefore, "NAV changed across upgrade");
        assertEq(vault.totalSupply(), supplyBefore, "totalSupply changed");
        assertEq(vault.totalAssets(), totalAssetsBefore, "totalAssets changed");
    }

    /// @dev Roles preserved across the impl swap (UUPS doesn't touch storage).
    function testFork_v21RolesPreserved() public {
        PUSDManager m = PUSDManager(MANAGER_PROXY);
        PUSDPlusVault vault = PUSDPlusVault(VAULT_PROXY);

        address plusVaultBefore = m.plusVault();
        bool feeExemptBefore = m.feeExempt(VAULT_PROXY);
        bool managerRoleBefore = vault.hasRole(vault.MANAGER_ROLE(), MANAGER_PROXY);

        _runV21Upgrade();

        assertEq(m.plusVault(), plusVaultBefore, "plusVault changed");
        assertEq(m.feeExempt(VAULT_PROXY), feeExemptBefore, "feeExempt revoked");
        assertEq(vault.hasRole(vault.MANAGER_ROLE(), MANAGER_PROXY), managerRoleBefore, "MANAGER_ROLE revoked");
    }

    /// @dev Pre-upgrade vault PUSD balance is preserved (legacy state from v2
    ///      deposits) and continues to count toward NAV.
    function testFork_v21LegacyPusdInVaultStillCounted() public {
        PUSDPlusVault vault = PUSDPlusVault(VAULT_PROXY);
        IPUSD pusd = IPUSD(PUSD_PROXY);

        uint256 legacyPusd = pusd.balanceOf(VAULT_PROXY);
        uint256 idleBefore = vault.idleReservesPusd();

        _runV21Upgrade();

        assertEq(pusd.balanceOf(VAULT_PROXY), legacyPusd, "legacy PUSD balance changed");
        assertEq(vault.idleReservesPusd(), idleBefore, "idleReservesPusd changed");
    }

    /// @dev v2.1 — depositToPlus direct path lands tokens directly in vault,
    ///      no PUSD minted. Requires the vault basket to include the token.
    function testFork_v21NewDirectDepositGoesToVault() public {
        _runV21Upgrade();

        PUSDManager m = PUSDManager(MANAGER_PROXY);
        PUSDPlusVault vault = PUSDPlusVault(VAULT_PROXY);
        IPUSD pusd = IPUSD(PUSD_PROXY);

        // Pick a token that's both supported by manager AND already in vault basket.
        // If basket is empty (POOL_ADMIN hasn't run PopulateVaultBasket yet),
        // skip — that's a runbook ordering issue, not a v2.1 contract bug.
        uint256 n = m.getSupportedTokensCount();
        address token;
        for (uint256 i = 0; i < n; i++) {
            address candidate = m.getSupportedTokenAt(i);
            if (vault.inBasket(candidate)) {
                token = candidate;
                break;
            }
        }
        if (token == address(0)) {
            emit log("Skipping direct-deposit fork test: no manager-supported token is in vault basket");
            emit log("Run PopulateVaultBasket.s.sol against the vault before upgrading PUSDManager");
            return;
        }

        // Simulate a user deposit
        address user = vm.addr(0xBEEF);
        deal(token, user, 1_000e6);

        uint256 vaultBalBefore = IERC20Like(token).balanceOf(VAULT_PROXY);
        uint256 mgrBalBefore = IERC20Like(token).balanceOf(MANAGER_PROXY);
        uint256 supplyBefore = pusd.totalSupply();

        vm.startPrank(user);
        IERC20Like(token).approve(MANAGER_PROXY, 1_000e6);
        m.depositToPlus(token, 1_000e6, user);
        vm.stopPrank();

        // Direct path: token to vault, no PUSD minted.
        // Manager retains only the haircut amount (currently 0 across all tokens).
        PUSDManager.TokenInfo memory info = m.getTokenInfo(token);
        uint256 haircut = (1_000e6 * info.surplusHaircutBps) / 10_000;

        assertEq(IERC20Like(token).balanceOf(VAULT_PROXY), vaultBalBefore + 1_000e6 - haircut, "vault token balance");
        assertEq(IERC20Like(token).balanceOf(MANAGER_PROXY), mgrBalBefore + haircut, "manager retains only haircut");
        assertEq(pusd.totalSupply(), supplyBefore, "PUSD supply unchanged");
        assertEq(vault.balanceOf(user), 1_000e6 - haircut, "user PUSD+");
    }
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

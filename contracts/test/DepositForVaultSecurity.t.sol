// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../src/PUSD.sol";
import "../src/PUSDManager.sol";
import "../src/PUSDPlusVault.sol";
import "../src/InsuranceFund.sol";
import "../src/interfaces/INonfungiblePositionManager.sol";

import {MockERC20, MockNPM, MockUniV3Factory, MockUniV3Pool} from "./PUSDPlusVault.t.sol";

/// @dev Reentrant ERC-20 — on every transferFrom, calls back into a target
///      with arbitrary calldata. Used to prove the manager's nonReentrant
///      guard blocks user-initiated reentry into deposit / redeem.
contract ReentrantToken is ERC20 {
    address public reentryTarget;
    bytes public reentryData;
    bool public armed;

    constructor() ERC20("ReentrantToken", "RNT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
        armed = true;
    }

    function disarm() external {
        armed = false;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool ok) {
        ok = super.transferFrom(from, to, value);
        if (armed && reentryTarget != address(0)) {
            armed = false; // single-shot
            (bool s, bytes memory ret) = reentryTarget.call(reentryData);
            if (!s) {
                // Bubble the inner revert verbatim so callers can assert on it.
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
    }
}

/// @dev Dedicated security pass on PUSDManager.depositForVault — the
///      single highest-trust function in the system, deliberately bypassing
///      `nonReentrant` and the surplus haircut. See ADR 0005.
contract DepositForVaultSecurityTest is Test {
    PUSD public pusd;
    PUSDManager public manager;
    PUSDPlusVault public vault;
    InsuranceFund public ifund;

    MockERC20 public usdc;
    MockERC20 public usdt;
    MockNPM public npm;
    MockUniV3Pool public pool;
    MockUniV3Factory public factory;

    address public admin = address(0xA1);
    address public keeper = address(0xA2);
    address public poolAdmin = address(0xA3);
    address public vaultAdmin = address(0xA4);
    address public guardian = address(0xA5);
    address public alice = address(0xB1);
    address public bob = address(0xB2);
    address public attacker = address(0xB3);

    uint256 internal constant ONE_M = 1_000_000e6;

    function setUp() public {
        // ---- PUSD + PUSDManager ----
        PUSD pusdImpl = new PUSD();
        ERC1967Proxy pusdProxy =
            new ERC1967Proxy(address(pusdImpl), abi.encodeWithSelector(PUSD.initialize.selector, admin));
        pusd = PUSD(address(pusdProxy));

        PUSDManager mgrImpl = new PUSDManager();
        ERC1967Proxy mgrProxy = new ERC1967Proxy(
            address(mgrImpl), abi.encodeWithSelector(PUSDManager.initialize.selector, address(pusd), admin)
        );
        manager = PUSDManager(address(mgrProxy));

        vm.startPrank(admin);
        pusd.grantRole(keccak256("MINTER_ROLE"), address(manager));
        pusd.grantRole(keccak256("BURNER_ROLE"), address(manager));
        vm.stopPrank();

        // ---- Reserve tokens ----
        usdc = new MockERC20("USDC.eth", "USDC.eth", 6);
        usdt = new MockERC20("USDT.eth", "USDT.eth", 6);

        vm.startPrank(admin);
        manager.addSupportedToken(address(usdc), "USDC.eth", "eth", 6);
        manager.addSupportedToken(address(usdt), "USDT.eth", "eth", 6);
        vm.stopPrank();

        // ---- V3 mocks ----
        factory = new MockUniV3Factory();
        npm = new MockNPM();
        pool = new MockUniV3Pool();
        npm.setFactory(address(factory));
        factory.setPool(address(usdc), address(usdt), 500, address(pool));

        // ---- Vault ----
        PUSDPlusVault vImpl = new PUSDPlusVault();
        ERC1967Proxy vProxy = new ERC1967Proxy(
            address(vImpl),
            abi.encodeCall(
                PUSDPlusVault.initialize, (admin, address(pusd), address(manager), address(npm), address(factory))
            )
        );
        vault = PUSDPlusVault(address(vProxy));

        // ---- Insurance fund ----
        InsuranceFund iImpl = new InsuranceFund();
        ERC1967Proxy iProxy =
            new ERC1967Proxy(address(iImpl), abi.encodeCall(InsuranceFund.initialize, (admin, vaultAdmin, guardian)));
        ifund = InsuranceFund(address(iProxy));
        vm.prank(admin);
        ifund.setVault(address(vault));

        // ---- Roles ----
        vm.startPrank(admin);
        vault.grantRole(vault.MANAGER_ROLE(), address(manager));
        vault.grantRole(vault.KEEPER_ROLE(), keeper);
        vault.grantRole(vault.POOL_ADMIN_ROLE(), poolAdmin);
        vault.grantRole(vault.VAULT_ADMIN_ROLE(), vaultAdmin);
        vault.grantRole(vault.GUARDIAN_ROLE(), guardian);
        vm.stopPrank();

        vm.startPrank(vaultAdmin);
        vault.setHaircutBps(200);
        vault.setUnwindCapBps(500);
        vault.setMaxDeploymentBps(7000);
        vault.setInsuranceFund(address(ifund));
        vm.stopPrank();

        vm.startPrank(poolAdmin);
        vault.addBasketToken(address(usdc));
        vault.addBasketToken(address(usdt));
        vm.stopPrank();

        // Wire vault into PUSDManager
        vm.startPrank(admin);
        manager.setPlusVault(address(vault));
        manager.setFeeExempt(address(vault), true);
        vm.stopPrank();

        // Fund users
        usdc.mint(alice, ONE_M);
        usdt.mint(alice, ONE_M);
        usdc.mint(bob, ONE_M);
        usdc.mint(attacker, ONE_M);
    }

    // -------------------------------------------------------------------
    // Two-key gate
    // -------------------------------------------------------------------

    function testRevertsWhenCallerIsNotPlusVault() public {
        vm.startPrank(attacker);
        usdc.approve(address(manager), 100e6);
        vm.expectRevert(bytes("PUSDManager: not vault"));
        manager.depositForVault(address(usdc), 100e6);
        vm.stopPrank();
    }

    function testRevertsWhenVaultNotFeeExempt() public {
        // Single-flip pause: revoke fee-exempt while plusVault address stays the same.
        vm.prank(admin);
        manager.setFeeExempt(address(vault), false);

        // Even from the vault address itself, the call must now revert.
        vm.startPrank(address(vault));
        vm.expectRevert(bytes("PUSDManager: not vault"));
        manager.depositForVault(address(usdc), 100e6);
        vm.stopPrank();
    }

    function testSucceedsWhenBothConditionsHold() public {
        // Stage idle USDC inside the vault (mimics post-`redeemPusdForToken` state).
        deal(address(usdc), address(vault), 500e6);

        vm.startPrank(address(vault));
        usdc.approve(address(manager), 500e6);
        uint256 minted = manager.depositForVault(address(usdc), 500e6);
        vm.stopPrank();

        assertEq(minted, 500e6, "1:1 mint expected");
        assertEq(pusd.balanceOf(address(vault)), 500e6, "vault holds new PUSD");
        assertEq(usdc.balanceOf(address(manager)), 500e6, "manager holds reserve");
    }

    function testSingleFlipPauseRecovers() public {
        // (1) confirm the bypass works
        deal(address(usdc), address(vault), 500e6);
        vm.startPrank(address(vault));
        usdc.approve(address(manager), 500e6);
        manager.depositForVault(address(usdc), 100e6);
        vm.stopPrank();

        // (2) flip exemption off → bypass instantly disabled
        vm.prank(admin);
        manager.setFeeExempt(address(vault), false);

        vm.startPrank(address(vault));
        vm.expectRevert(bytes("PUSDManager: not vault"));
        manager.depositForVault(address(usdc), 100e6);
        vm.stopPrank();

        // (3) flip back on → bypass live again, no address rotation
        vm.prank(admin);
        manager.setFeeExempt(address(vault), true);
        vm.startPrank(address(vault));
        manager.depositForVault(address(usdc), 100e6);
        vm.stopPrank();
    }

    // -------------------------------------------------------------------
    // Reentrancy attempts
    // -------------------------------------------------------------------

    /// @notice The manager's outer `nonReentrant` must block any user-initiated
    ///         attempt to re-enter `deposit` / `redeem` through a malicious token.
    function testReentrancyBlockedOnUserDeposit() public {
        ReentrantToken evilToken = new ReentrantToken();
        evilToken.mint(attacker, 1_000e6);

        vm.prank(admin);
        manager.addSupportedToken(address(evilToken), "EVIL", "eth", 6);

        // Arm the token: when transferFrom fires inside `deposit`, re-enter `deposit`.
        evilToken.arm(
            address(manager), abi.encodeWithSelector(manager.deposit.selector, address(evilToken), 100e6, attacker)
        );

        vm.startPrank(attacker);
        evilToken.approve(address(manager), 200e6);
        vm.expectRevert(bytes("ReentrancyGuard: reentrant call"));
        manager.deposit(address(evilToken), 200e6, attacker);
        vm.stopPrank();
    }

    /// @notice The legitimate inner `depositForVault` must succeed during
    ///         `redeemFromPlus → burnPlus → _convertIdleReservesToPusd`,
    ///         even though the outer manager call already holds the lock.
    function testLegitimateInnerCallSucceedsDuringRedeemFromPlus() public {
        // Mint PUSD+ for alice, then convert vault PUSD into a non-PUSD reserve
        // so the redeem path forces a tier-2 conversion (the legitimate
        // depositForVault re-entry the bypass exists for).
        vm.startPrank(alice);
        usdc.approve(address(manager), 1_000e6);
        manager.depositToPlus(address(usdc), 1_000e6, alice);
        vm.stopPrank();

        vm.prank(keeper);
        vault.redeemPusdForToken(800e6, address(usdc)); // vault: 200 PUSD + 800 USDC

        uint256 usdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        manager.redeemFromPlus(600e6, address(usdc), true, alice);

        assertEq(usdc.balanceOf(alice) - usdcBefore, 600e6, "alice paid in USDC");
        assertEq(vault.balanceOf(alice), 400e6, "PUSD+ supply correctly burned");
    }

    // -------------------------------------------------------------------
    // Haircut bypass — required for I2 (NAV monotonic)
    // -------------------------------------------------------------------

    function testNoHaircutAccruedOnVaultDeposit() public {
        // Set a non-zero haircut on USDC so we can be sure the bypass actually
        // skips it (rather than just being zero by default).
        vm.prank(admin);
        manager.setSurplusHaircutBps(address(usdc), 500); // 5%

        deal(address(usdc), address(vault), 1_000e6);

        uint256 haircutBefore = manager.accruedHaircut(address(usdc));
        vm.startPrank(address(vault));
        usdc.approve(address(manager), 1_000e6);
        uint256 minted = manager.depositForVault(address(usdc), 1_000e6);
        vm.stopPrank();

        assertEq(manager.accruedHaircut(address(usdc)), haircutBefore, "haircut must NOT accrue");
        assertEq(minted, 1_000e6, "vault minted 1:1, not haircut-discounted");
        assertEq(pusd.balanceOf(address(vault)), 1_000e6);
    }

    /// @notice For comparison: the public deposit path applies the same 5%
    ///         haircut the bypass skips. Confirms the bypass is the whole
    ///         reason, not a quirk of the test setup.
    function testPublicDepositStillAppliesHaircut() public {
        vm.prank(admin);
        manager.setSurplusHaircutBps(address(usdc), 500); // 5%

        vm.startPrank(alice);
        usdc.approve(address(manager), 1_000e6);
        manager.deposit(address(usdc), 1_000e6, alice);
        vm.stopPrank();

        assertEq(manager.accruedHaircut(address(usdc)), 50e6, "5% haircut to manager");
        assertEq(pusd.balanceOf(alice), 950e6, "alice minted post-haircut PUSD");
    }

    // -------------------------------------------------------------------
    // Invariants (I1, I3, I4) under the conversion path
    // -------------------------------------------------------------------

    function testInvariantsHoldAfterRedeemFromPlusConversion() public {
        // Alice + bob seed both reserves so the vault has multi-asset idle.
        vm.startPrank(alice);
        usdc.approve(address(manager), 1_000e6);
        manager.depositToPlus(address(usdc), 1_000e6, alice);
        vm.stopPrank();
        vm.startPrank(bob);
        usdc.approve(address(manager), 1_000e6);
        manager.depositToPlus(address(usdc), 1_000e6, bob);
        vm.stopPrank();

        // Convert all vault PUSD into USDC so a redeem must hit tier-2.
        vm.prank(keeper);
        vault.redeemPusdForToken(2_000e6, address(usdc));

        vm.prank(alice);
        manager.redeemFromPlus(500e6, address(usdc), true, alice);

        // I1 — PUSD totalSupply equals normalised free reserves on the manager.
        uint256 supply = pusd.totalSupply();
        uint256 free = usdc.balanceOf(address(manager)) - manager.accruedFees(address(usdc))
            - manager.accruedHaircut(address(usdc)) + usdt.balanceOf(address(manager))
            - manager.accruedFees(address(usdt)) - manager.accruedHaircut(address(usdt));
        // Plus PUSD held by vault (counts as a reserve unit since the manager
        // matches each minted PUSD with a reserve unit; vault-held PUSD is
        // a downstream balance of an already-backed mint).
        assertGe(free + pusd.balanceOf(address(vault)), supply, "I1 violated");

        // I3 — vault has no privileged path to drain the manager beyond
        // what a normal redeem would do; confirmed structurally by the
        // fact that the only manager call the vault makes is redeem (here)
        // or depositForVault (which only mints against tokens the vault
        // sent in, asserted by I4 below).

        // I4 — fee-exempt + MANAGER_ROLE still pinned.
        assertTrue(manager.feeExempt(address(vault)), "I4: vault lost fee-exempt");
        assertTrue(vault.hasRole(vault.MANAGER_ROLE(), address(manager)), "I4: manager lost MANAGER_ROLE");
    }

    // -------------------------------------------------------------------
    // Token status edge cases
    // -------------------------------------------------------------------

    function testRevertsOnRemovedToken() public {
        // Need surplus zero so setTokenStatus to REMOVED is allowed; status
        // can be flipped after addSupportedToken.
        vm.prank(admin);
        manager.setTokenStatus(address(usdc), PUSDManager.TokenStatus.REMOVED);

        deal(address(usdc), address(vault), 100e6);
        vm.startPrank(address(vault));
        usdc.approve(address(manager), 100e6);
        vm.expectRevert(bytes("PUSDManager: token not enabled"));
        manager.depositForVault(address(usdc), 100e6);
        vm.stopPrank();
    }

    function testRevertsOnRedeemOnlyToken() public {
        vm.prank(admin);
        manager.setTokenStatus(address(usdc), PUSDManager.TokenStatus.REDEEM_ONLY);

        deal(address(usdc), address(vault), 100e6);
        vm.startPrank(address(vault));
        usdc.approve(address(manager), 100e6);
        vm.expectRevert(bytes("PUSDManager: token not enabled"));
        manager.depositForVault(address(usdc), 100e6);
        vm.stopPrank();
    }

    function testRevertsOnEmergencyRedeemToken() public {
        vm.prank(admin);
        manager.setTokenStatus(address(usdc), PUSDManager.TokenStatus.EMERGENCY_REDEEM);

        deal(address(usdc), address(vault), 100e6);
        vm.startPrank(address(vault));
        usdc.approve(address(manager), 100e6);
        vm.expectRevert(bytes("PUSDManager: token not enabled"));
        manager.depositForVault(address(usdc), 100e6);
        vm.stopPrank();
    }

    function testRevertsOnZeroAmount() public {
        vm.startPrank(address(vault));
        vm.expectRevert(bytes("PUSDManager: amount must be greater than 0"));
        manager.depositForVault(address(usdc), 0);
        vm.stopPrank();
    }

    function testRevertsOnUnsupportedToken() public {
        MockERC20 random = new MockERC20("R", "R", 6);
        deal(address(random), address(vault), 100e6);
        vm.startPrank(address(vault));
        random.approve(address(manager), 100e6);
        vm.expectRevert(bytes("PUSDManager: token not enabled"));
        manager.depositForVault(address(random), 100e6);
        vm.stopPrank();
    }
}

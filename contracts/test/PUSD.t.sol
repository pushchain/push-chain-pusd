// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/PUSD.sol";

contract PUSDTest is Test {
    PUSD public pusd;
    ERC1967Proxy public proxy;

    address public admin = address(1);
    address public protocol = address(2);
    address public user = address(4);

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    function setUp() public {
        PUSD implementation = new PUSD();

        bytes memory initData = abi.encodeWithSelector(PUSD.initialize.selector, admin);

        proxy = new ERC1967Proxy(address(implementation), initData);
        pusd = PUSD(address(proxy));

        vm.startPrank(admin);
        pusd.grantRole(MINTER_ROLE, protocol);
        pusd.grantRole(BURNER_ROLE, protocol);
        vm.stopPrank();
    }

    function testInitialization() public {
        assertEq(pusd.name(), "Push USD");
        assertEq(pusd.symbol(), "PUSD");
        assertEq(pusd.decimals(), 6);
        assertTrue(pusd.hasRole(pusd.DEFAULT_ADMIN_ROLE(), admin));
        assertFalse(pusd.hasRole(MINTER_ROLE, admin));
        assertFalse(pusd.hasRole(BURNER_ROLE, admin));
        assertTrue(pusd.hasRole(UPGRADER_ROLE, admin));
        assertTrue(pusd.hasRole(MINTER_ROLE, protocol));
        assertTrue(pusd.hasRole(BURNER_ROLE, protocol));
    }

    function testMint() public {
        uint256 amount = 1000 * 10 ** 6;

        vm.prank(protocol);
        pusd.mint(user, amount);

        assertEq(pusd.balanceOf(user), amount);
        assertEq(pusd.totalSupply(), amount);
    }

    function testMintOnlyMinterRole() public {
        uint256 amount = 1000 * 10 ** 6;

        vm.prank(user);
        vm.expectRevert();
        pusd.mint(user, amount);
    }

    function testMintToZeroAddress() public {
        uint256 amount = 1000 * 10 ** 6;

        vm.prank(protocol);
        vm.expectRevert("PUSD: mint to zero address");
        pusd.mint(address(0), amount);
    }

    function testMintZeroAmount() public {
        vm.prank(protocol);
        vm.expectRevert("PUSD: mint amount must be greater than 0");
        pusd.mint(user, 0);
    }

    function testBurn() public {
        uint256 amount = 1000 * 10 ** 6;

        vm.prank(protocol);
        pusd.mint(user, amount);

        vm.prank(protocol);
        pusd.burn(user, amount);

        assertEq(pusd.balanceOf(user), 0);
        assertEq(pusd.totalSupply(), 0);
    }

    function testBurnOnlyBurnerRole() public {
        uint256 amount = 1000 * 10 ** 6;

        vm.prank(protocol);
        pusd.mint(user, amount);

        vm.prank(user);
        vm.expectRevert();
        pusd.burn(user, amount);
    }

    function testBurnFromZeroAddress() public {
        uint256 amount = 1000 * 10 ** 6;

        vm.prank(protocol);
        vm.expectRevert("PUSD: burn from zero address");
        pusd.burn(address(0), amount);
    }

    function testBurnZeroAmount() public {
        vm.prank(protocol);
        vm.expectRevert("PUSD: burn amount must be greater than 0");
        pusd.burn(user, 0);
    }

    function testBurnExceedsBalance() public {
        uint256 mintAmount = 1000 * 10 ** 6;
        uint256 burnAmount = 2000 * 10 ** 6;

        vm.prank(protocol);
        pusd.mint(user, mintAmount);

        vm.prank(protocol);
        vm.expectRevert("PUSD: burn amount exceeds balance");
        pusd.burn(user, burnAmount);
    }

    function testAdminCannotMint() public {
        uint256 amount = 1000 * 10 ** 6;

        vm.prank(admin);
        vm.expectRevert();
        pusd.mint(user, amount);
    }

    function testAdminCannotBurn() public {
        uint256 amount = 1000 * 10 ** 6;

        vm.prank(protocol);
        pusd.mint(user, amount);

        vm.prank(admin);
        vm.expectRevert();
        pusd.burn(user, amount);
    }

    function testTransfer() public {
        uint256 amount = 1000 * 10 ** 6;

        vm.prank(protocol);
        pusd.mint(user, amount);

        vm.prank(user);
        pusd.transfer(address(6), amount);

        assertEq(pusd.balanceOf(user), 0);
        assertEq(pusd.balanceOf(address(6)), amount);
    }

    function testMintEvent() public {
        uint256 amount = 1000 * 10 ** 6;

        vm.expectEmit(true, true, false, true);
        emit PUSD.Minted(user, amount, protocol);

        vm.prank(protocol);
        pusd.mint(user, amount);
    }

    function testBurnEvent() public {
        uint256 amount = 1000 * 10 ** 6;

        vm.prank(protocol);
        pusd.mint(user, amount);

        vm.expectEmit(true, true, false, true);
        emit PUSD.Burned(user, amount, protocol);

        vm.prank(protocol);
        pusd.burn(user, amount);
    }
}

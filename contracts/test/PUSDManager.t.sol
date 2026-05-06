// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../src/PUSD.sol";
import "../src/PUSDManager.sol";

contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PUSDManagerTest is Test {
    PUSD public pusd;
    PUSDManager public manager;
    ERC1967Proxy public pusdProxy;
    ERC1967Proxy public managerProxy;

    MockERC20 public usdtEth;
    MockERC20 public usdcEth;
    MockERC20 public usdtSol;
    MockERC20 public usdcSol;
    MockERC20 public usdtBase;
    MockERC20 public usdcBase;
    MockERC20 public usdtArb;
    MockERC20 public usdcArb;
    MockERC20 public usdtBnb;
    MockERC20 public dai;

    address public admin = address(1);
    address public user = address(2);

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    function setUp() public {
        PUSD pusdImpl = new PUSD();
        bytes memory pusdInitData = abi.encodeWithSelector(PUSD.initialize.selector, admin);
        pusdProxy = new ERC1967Proxy(address(pusdImpl), pusdInitData);
        pusd = PUSD(address(pusdProxy));

        PUSDManager managerImpl = new PUSDManager();
        bytes memory managerInitData = abi.encodeWithSelector(PUSDManager.initialize.selector, address(pusd), admin);
        managerProxy = new ERC1967Proxy(address(managerImpl), managerInitData);
        manager = PUSDManager(address(managerProxy));

        vm.startPrank(admin);
        pusd.grantRole(MINTER_ROLE, address(manager));
        pusd.grantRole(BURNER_ROLE, address(manager));
        vm.stopPrank();

        usdtEth = new MockERC20("USDT.eth", "USDT.eth", 6);
        usdcEth = new MockERC20("USDC.eth", "USDC.eth", 6);
        usdtSol = new MockERC20("USDT.sol", "USDT.sol", 6);
        usdcSol = new MockERC20("USDC.sol", "USDC.sol", 6);
        usdtBase = new MockERC20("USDT.base", "USDT.base", 6);
        usdcBase = new MockERC20("USDC.base", "USDC.base", 6);
        usdtArb = new MockERC20("USDT.arb", "USDT.arb", 6);
        usdcArb = new MockERC20("USDC.arb", "USDC.arb", 6);
        usdtBnb = new MockERC20("USDT.bnb", "USDT.bnb", 18);
        dai = new MockERC20("DAI", "DAI", 18);
    }

    function testInitialization() public {
        assertEq(address(manager.pusd()), address(pusd));
        assertTrue(manager.hasRole(manager.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(manager.hasRole(manager.ADMIN_ROLE(), admin));
        assertTrue(manager.hasRole(manager.UPGRADER_ROLE(), admin));
    }

    function testAddSupportedToken() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        assertTrue(manager.isTokenSupported(address(usdtEth)));
        assertEq(manager.getSupportedTokensCount(), 1);
        assertEq(manager.getSupportedTokenAt(0), address(usdtEth));

        PUSDManager.TokenInfo memory info = manager.getTokenInfo(address(usdtEth));
        assertEq(uint256(info.status), uint256(PUSDManager.TokenStatus.ENABLED));
        assertEq(info.decimals, 6);
        assertEq(info.name, "USDT.eth");
        assertEq(info.chainNamespace, "Ethereum_Sepolia");
    }

    function testAddMultipleSupportedTokens() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdtSol), "USDT.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdcSol), "USDC.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdtBase), "USDT.base", "Base_Testnet", 6);
        manager.addSupportedToken(address(usdcBase), "USDC.base", "Base_Testnet", 6);
        manager.addSupportedToken(address(usdtArb), "USDT.arb", "Arbitrum_Sepolia", 6);
        manager.addSupportedToken(address(usdcArb), "USDC.arb", "Arbitrum_Sepolia", 6);
        manager.addSupportedToken(address(usdtBnb), "USDT.bnb", "BNB_Testnet", 18);
        vm.stopPrank();

        assertEq(manager.getSupportedTokensCount(), 9);
        assertTrue(manager.isTokenSupported(address(usdtEth)));
        assertTrue(manager.isTokenSupported(address(usdcEth)));
        assertTrue(manager.isTokenSupported(address(usdtSol)));
        assertTrue(manager.isTokenSupported(address(usdcSol)));
        assertTrue(manager.isTokenSupported(address(usdtBase)));
        assertTrue(manager.isTokenSupported(address(usdcBase)));
        assertTrue(manager.isTokenSupported(address(usdtArb)));
        assertTrue(manager.isTokenSupported(address(usdcArb)));
        assertTrue(manager.isTokenSupported(address(usdtBnb)));
    }

    function testAddSupportedTokenOnlyAdmin() public {
        vm.prank(user);
        vm.expectRevert();
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
    }

    function testAddSupportedTokenZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert("PUSDManager: token address cannot be zero");
        manager.addSupportedToken(address(0), "USDT.eth", "Ethereum_Sepolia", 6);
    }

    function testAddSupportedTokenAlreadySupported() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        vm.expectRevert("PUSDManager: token already added");
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        vm.stopPrank();
    }

    function testSetTokenStatusToRedeemOnly() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.setTokenStatus(address(usdtEth), PUSDManager.TokenStatus.REDEEM_ONLY);
        vm.stopPrank();

        assertEq(uint256(manager.getTokenStatus(address(usdtEth))), uint256(PUSDManager.TokenStatus.REDEEM_ONLY));
        assertTrue(manager.isTokenSupported(address(usdtEth)));
    }

    function testSetTokenStatusToRemoved() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.setTokenStatus(address(usdtEth), PUSDManager.TokenStatus.REMOVED);
        vm.stopPrank();

        assertEq(uint256(manager.getTokenStatus(address(usdtEth))), uint256(PUSDManager.TokenStatus.REMOVED));
        assertFalse(manager.isTokenSupported(address(usdtEth)));
    }

    function testSetTokenStatusNotAdded() public {
        vm.prank(admin);
        vm.expectRevert("PUSDManager: token not added");
        manager.setTokenStatus(address(usdtEth), PUSDManager.TokenStatus.REDEEM_ONLY);
    }

    function testSetTokenStatusUnchanged() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        vm.expectRevert("PUSDManager: status unchanged");
        manager.setTokenStatus(address(usdtEth), PUSDManager.TokenStatus.ENABLED);
        vm.stopPrank();
    }

    function testCannotReAddTokenAfterRemoving() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        assertEq(manager.getSupportedTokensCount(), 1);
        assertEq(manager.getSupportedTokenAt(0), address(usdtEth));

        manager.setTokenStatus(address(usdtEth), PUSDManager.TokenStatus.REMOVED);

        vm.expectRevert("PUSDManager: token already added");
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        assertEq(manager.getSupportedTokensCount(), 1, "Token count should remain 1");
        assertEq(manager.getSupportedTokenAt(0), address(usdtEth), "Token list should not be corrupted");
        vm.stopPrank();
    }

    function testDepositRedeemOnlyToken() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.setTokenStatus(address(usdtEth), PUSDManager.TokenStatus.REDEEM_ONLY);
        vm.stopPrank();

        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        vm.expectRevert("PUSDManager: token not enabled for deposits");
        manager.deposit(address(usdtEth), depositAmount, user);
        vm.stopPrank();
    }

    function testDeposit() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);
        vm.stopPrank();

        assertEq(pusd.balanceOf(user), depositAmount);
        assertEq(usdtEth.balanceOf(address(manager)), depositAmount);
        assertEq(usdtEth.balanceOf(user), 0);
    }

    function testDepositWithDifferentDecimals() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtBnb), "USDT.bnb", "BNB_Testnet", 18);

        uint256 depositAmount = 1000 * 10 ** 18;
        usdtBnb.mint(user, depositAmount);

        vm.startPrank(user);
        usdtBnb.approve(address(manager), depositAmount);
        manager.deposit(address(usdtBnb), depositAmount, user);
        vm.stopPrank();

        uint256 expectedPUSD = 1000 * 10 ** 6;
        assertEq(pusd.balanceOf(user), expectedPUSD);
        assertEq(usdtBnb.balanceOf(address(manager)), depositAmount);
    }

    function testDepositUnsupportedToken() public {
        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        vm.expectRevert("PUSDManager: token not enabled for deposits");
        manager.deposit(address(usdtEth), depositAmount, user);
        vm.stopPrank();
    }

    function testDepositZeroAmount() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        vm.prank(user);
        vm.expectRevert("PUSDManager: amount must be greater than 0");
        manager.deposit(address(usdtEth), 0, user);
    }

    function testDepositZeroAddressRecipientReverts() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount = 500 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        vm.expectRevert("PUSDManager: recipient cannot be zero address");
        manager.deposit(address(usdtEth), depositAmount, address(0));
        vm.stopPrank();
    }

    function testRedeemToRecipient() public {
        address recipient = address(42);
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);

        uint256 redeemAmount = 500 * 10 ** 6;
        manager.redeem(redeemAmount, address(usdtEth), false, recipient);
        vm.stopPrank();

        assertEq(usdtEth.balanceOf(recipient), redeemAmount, "recipient should receive tokens");
        assertEq(usdtEth.balanceOf(user), 0, "redeemer should receive nothing");
        assertEq(pusd.balanceOf(user), depositAmount - redeemAmount, "redeemer PUSD burned correctly");
    }

    function testRedeemZeroAddressRecipientReverts() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount = 500 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);
        vm.expectRevert("PUSDManager: recipient cannot be zero address");
        manager.redeem(depositAmount, address(usdtEth), false, address(0));
        vm.stopPrank();
    }

    function testRedeemToRecipientEmitsCorrectEvent() public {
        address recipient = address(42);
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount = 500 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);

        vm.expectEmit(true, true, true, true);
        emit PUSDManager.Redeemed(user, address(usdtEth), depositAmount, depositAmount, recipient);
        manager.redeem(depositAmount, address(usdtEth), false, recipient);
        vm.stopPrank();
    }

    function testDepositToSelfExplicitly() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount = 200 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);
        vm.stopPrank();

        assertEq(pusd.balanceOf(user), depositAmount, "depositor should receive PUSD when passing own address");
    }

    function testRedeem() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);

        uint256 redeemAmount = 500 * 10 ** 6;
        manager.redeem(redeemAmount, address(usdtEth), false, user);
        vm.stopPrank();

        assertEq(pusd.balanceOf(user), 500 * 10 ** 6);
        assertEq(usdtEth.balanceOf(user), 500 * 10 ** 6);
        assertEq(usdtEth.balanceOf(address(manager)), 500 * 10 ** 6);
    }

    function testRedeemWithDifferentDecimals() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtBnb), "USDT.bnb", "BNB_Testnet", 18);

        uint256 depositAmount = 1000 * 10 ** 18;
        usdtBnb.mint(user, depositAmount);

        vm.startPrank(user);
        usdtBnb.approve(address(manager), depositAmount);
        manager.deposit(address(usdtBnb), depositAmount, user);

        uint256 redeemPUSD = 500 * 10 ** 6;
        manager.redeem(redeemPUSD, address(usdtBnb), false, user);
        vm.stopPrank();

        assertEq(pusd.balanceOf(user), 500 * 10 ** 6);
        assertEq(usdtBnb.balanceOf(user), 500 * 10 ** 18);
        assertEq(usdtBnb.balanceOf(address(manager)), 500 * 10 ** 18);
    }

    function testRedeemUnsupportedToken() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount = 100 * 10 ** 6;
        usdcEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdcEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdcEth), depositAmount, user);

        vm.expectRevert("PUSDManager: preferred asset unavailable and basket not allowed");
        manager.redeem(100 * 10 ** 6, address(usdtEth), false, user);
        vm.stopPrank();
    }

    function testRedeemInsufficientPUSD() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        vm.prank(user);
        vm.expectRevert("PUSDManager: insufficient PUSD balance");
        manager.redeem(100 * 10 ** 6, address(usdtEth), false, user);
    }

    function testRedeemInsufficientLiquidity() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        vm.stopPrank();

        uint256 depositAmount = 500 * 10 ** 6;

        usdtEth.mint(user, depositAmount);
        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);
        vm.stopPrank();

        vm.prank(user);
        vm.expectRevert("PUSDManager: preferred asset unavailable and basket not allowed");
        manager.redeem(depositAmount, address(usdcEth), false, user);
    }

    function testDepositEvent() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);

        vm.expectEmit(true, true, true, true);
        emit PUSDManager.Deposited(user, address(usdtEth), depositAmount, depositAmount, 0, user);
        manager.deposit(address(usdtEth), depositAmount, user);
        vm.stopPrank();
    }

    function testRedeemEvent() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);

        uint256 redeemAmount = 500 * 10 ** 6;
        vm.expectEmit(true, true, true, true);
        emit PUSDManager.Redeemed(user, address(usdtEth), redeemAmount, redeemAmount, user);
        manager.redeem(redeemAmount, address(usdtEth), false, user);
        vm.stopPrank();
    }

    function testMultipleUsersDepositAndRedeem() public {
        address user2 = address(3);

        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount1 = 1000 * 10 ** 6;
        uint256 depositAmount2 = 2000 * 10 ** 6;

        usdtEth.mint(user, depositAmount1);
        usdtEth.mint(user2, depositAmount2);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount1);
        manager.deposit(address(usdtEth), depositAmount1, user);
        vm.stopPrank();

        vm.startPrank(user2);
        usdtEth.approve(address(manager), depositAmount2);
        manager.deposit(address(usdtEth), depositAmount2, user2);
        vm.stopPrank();

        assertEq(pusd.balanceOf(user), depositAmount1);
        assertEq(pusd.balanceOf(user2), depositAmount2);
        assertEq(usdtEth.balanceOf(address(manager)), depositAmount1 + depositAmount2);

        vm.prank(user);
        manager.redeem(depositAmount1, address(usdtEth), false, user);

        assertEq(pusd.balanceOf(user), 0);
        assertEq(usdtEth.balanceOf(user), depositAmount1);
        assertEq(usdtEth.balanceOf(address(manager)), depositAmount2);
    }

    function testRedeemWithFallback() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        vm.stopPrank();

        uint256 depositAmount = 1000 * 10 ** 6;

        usdcEth.mint(user, depositAmount);
        vm.startPrank(user);
        usdcEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdcEth), depositAmount, user);
        vm.stopPrank();

        vm.prank(user);
        manager.redeem(depositAmount, address(usdtEth), true, user);

        assertEq(pusd.balanceOf(user), 0);
        assertEq(usdcEth.balanceOf(user), depositAmount);
        assertEq(usdcEth.balanceOf(address(manager)), 0);
    }

    function testRedeemWithFallbackMultipleTokens() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdtBnb), "USDT.bnb", "BNB_Testnet", 18);
        vm.stopPrank();

        uint256 depositUSDC = 500 * 10 ** 6;
        uint256 depositBNB = 500 * 10 ** 18;

        usdcEth.mint(user, depositUSDC);
        usdtBnb.mint(user, depositBNB);

        vm.startPrank(user);
        usdcEth.approve(address(manager), depositUSDC);
        manager.deposit(address(usdcEth), depositUSDC, user);

        usdtBnb.approve(address(manager), depositBNB);
        manager.deposit(address(usdtBnb), depositBNB, user);
        vm.stopPrank();

        uint256 redeemAmount = 500 * 10 ** 6;
        vm.prank(user);
        manager.redeem(redeemAmount, address(usdtEth), true, user);

        assertEq(pusd.balanceOf(user), 500 * 10 ** 6);
        assertTrue(usdcEth.balanceOf(user) > 0 || usdtBnb.balanceOf(user) > 0);
    }

    function testRedeemPreferredAssetAvailable() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        vm.stopPrank();

        uint256 depositAmount = 1000 * 10 ** 6;

        usdtEth.mint(user, depositAmount);
        usdcEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);

        usdcEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdcEth), depositAmount, user);
        vm.stopPrank();

        uint256 redeemAmount = 500 * 10 ** 6;
        vm.prank(user);
        manager.redeem(redeemAmount, address(usdtEth), true, user);

        assertEq(pusd.balanceOf(user), 1500 * 10 ** 6);
        assertEq(usdtEth.balanceOf(user), 500 * 10 ** 6);
        assertEq(usdcEth.balanceOf(user), 0);
    }

    function testBasketRedeemRoundingFix() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdtSol), "USDT.sol", "Solana_Devnet", 6);
        vm.stopPrank();

        usdtEth.mint(user, 333 * 10 ** 6);
        usdcEth.mint(user, 333 * 10 ** 6);
        usdtSol.mint(user, 334 * 10 ** 6);

        vm.startPrank(user);
        usdtEth.approve(address(manager), 333 * 10 ** 6);
        manager.deposit(address(usdtEth), 333 * 10 ** 6, user);

        usdcEth.approve(address(manager), 333 * 10 ** 6);
        manager.deposit(address(usdcEth), 333 * 10 ** 6, user);

        usdtSol.approve(address(manager), 334 * 10 ** 6);
        manager.deposit(address(usdtSol), 334 * 10 ** 6, user);
        vm.stopPrank();

        uint256 userPUSDBefore = pusd.balanceOf(user);
        assertEq(userPUSDBefore, 1000 * 10 ** 6);

        uint256 redeemAmount = 100 * 10 ** 6;

        vm.prank(user);
        manager.redeem(redeemAmount, address(usdtArb), true, user);

        uint256 userPUSDAfter = pusd.balanceOf(user);
        assertEq(userPUSDAfter, userPUSDBefore - redeemAmount, "User should have exactly redeemAmount less PUSD");

        uint256 totalTokensReceived = usdtEth.balanceOf(user) + usdcEth.balanceOf(user) + usdtSol.balanceOf(user);
        assertEq(totalTokensReceived, redeemAmount, "User should receive tokens worth exactly the PUSD burned");
    }

    function testBasketRedeemWithOddAmounts() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdtSol), "USDT.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdcSol), "USDC.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdtBase), "USDT.base", "Base_Testnet", 6);
        vm.stopPrank();

        usdtEth.mint(user, 1234567);
        usdcEth.mint(user, 2345678);
        usdtSol.mint(user, 3456789);
        usdcSol.mint(user, 4567890);
        usdtBase.mint(user, 5678901);

        vm.startPrank(user);
        usdtEth.approve(address(manager), 1234567);
        manager.deposit(address(usdtEth), 1234567, user);

        usdcEth.approve(address(manager), 2345678);
        manager.deposit(address(usdcEth), 2345678, user);

        usdtSol.approve(address(manager), 3456789);
        manager.deposit(address(usdtSol), 3456789, user);

        usdcSol.approve(address(manager), 4567890);
        manager.deposit(address(usdcSol), 4567890, user);

        usdtBase.approve(address(manager), 5678901);
        manager.deposit(address(usdtBase), 5678901, user);
        vm.stopPrank();

        uint256 userPUSDBefore = pusd.balanceOf(user);
        uint256 redeemAmount = 9876543;

        vm.prank(user);
        manager.redeem(redeemAmount, address(usdtArb), true, user);

        uint256 userPUSDAfter = pusd.balanceOf(user);
        assertEq(userPUSDAfter, userPUSDBefore - redeemAmount, "User should have exactly redeemAmount less PUSD");

        uint256 totalTokensReceived = usdtEth.balanceOf(user) + usdcEth.balanceOf(user) + usdtSol.balanceOf(user)
            + usdcSol.balanceOf(user) + usdtBase.balanceOf(user);
        assertEq(totalTokensReceived, redeemAmount, "User should receive tokens worth exactly the PUSD burned");
    }

    function testEmergencyRedeemProportionalDistribution() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdcSol), "USDC.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdcBase), "USDC.base", "Base_Testnet", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdtBase), "USDT.base", "Base_Testnet", 6);
        vm.stopPrank();

        uint256 depositAmount = 100 * 10 ** 6;
        usdcSol.mint(user, depositAmount);
        usdcBase.mint(user, depositAmount);
        usdcEth.mint(user, depositAmount);
        usdtEth.mint(user, depositAmount);
        usdtBase.mint(user, depositAmount);

        vm.startPrank(user);
        usdcSol.approve(address(manager), depositAmount);
        manager.deposit(address(usdcSol), depositAmount, user);

        usdcBase.approve(address(manager), depositAmount);
        manager.deposit(address(usdcBase), depositAmount, user);

        usdcEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdcEth), depositAmount, user);

        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);

        usdtBase.approve(address(manager), depositAmount);
        manager.deposit(address(usdtBase), depositAmount, user);
        vm.stopPrank();

        vm.prank(admin);
        manager.setTokenStatus(address(usdcSol), PUSDManager.TokenStatus.EMERGENCY_REDEEM);

        uint256 redeemAmount = 50 * 10 ** 6;

        vm.prank(user);
        manager.redeem(redeemAmount, address(usdcBase), false, user);

        uint256 usdcSolReceived = usdcSol.balanceOf(user);
        uint256 usdcBaseReceived = usdcBase.balanceOf(user);

        assertGt(usdcSolReceived, 0, "Should receive some USDC.sol (emergency token)");
        assertGt(usdcBaseReceived, 0, "Should receive some USDC.base (preferred token)");

        uint256 totalReceived = usdcSolReceived + usdcBaseReceived;
        assertEq(totalReceived, redeemAmount, "Total should equal redeem amount");

        assertEq(usdcSolReceived, 25 * 10 ** 6, "Should receive 50% from emergency token (100/200)");
        assertEq(usdcBaseReceived, 25 * 10 ** 6, "Should receive 50% from preferred token (100/200)");
    }

    function testEmergencyRedeemMultipleEmergencyTokens() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdcSol), "USDC.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdcBase), "USDC.base", "Base_Testnet", 6);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        vm.stopPrank();

        uint256 depositAmount = 100 * 10 ** 6;
        usdcSol.mint(user, depositAmount);
        usdcBase.mint(user, depositAmount);
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdcSol.approve(address(manager), depositAmount);
        manager.deposit(address(usdcSol), depositAmount, user);

        usdcBase.approve(address(manager), depositAmount);
        manager.deposit(address(usdcBase), depositAmount, user);

        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);
        vm.stopPrank();

        vm.startPrank(admin);
        manager.setTokenStatus(address(usdcSol), PUSDManager.TokenStatus.EMERGENCY_REDEEM);
        manager.setTokenStatus(address(usdtEth), PUSDManager.TokenStatus.EMERGENCY_REDEEM);
        vm.stopPrank();

        uint256 redeemAmount = 60 * 10 ** 6;

        vm.prank(user);
        manager.redeem(redeemAmount, address(usdcBase), false, user);

        uint256 totalReceived = usdcSol.balanceOf(user) + usdcBase.balanceOf(user) + usdtEth.balanceOf(user);
        assertEq(totalReceived, redeemAmount, "Total should equal redeem amount");

        assertGt(usdcSol.balanceOf(user), 0, "Should receive USDC.sol");
        assertGt(usdcBase.balanceOf(user), 0, "Should receive USDC.base");
        assertGt(usdtEth.balanceOf(user), 0, "Should receive USDT.eth");
    }

    function testEmergencyRedeemCanUseEmergencyAsPreferred() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdcSol), "USDC.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdcBase), "USDC.base", "Base_Testnet", 6);
        vm.stopPrank();

        uint256 depositAmount = 100 * 10 ** 6;
        usdcSol.mint(user, depositAmount);
        usdcBase.mint(user, depositAmount);

        vm.startPrank(user);
        usdcSol.approve(address(manager), depositAmount);
        manager.deposit(address(usdcSol), depositAmount, user);

        usdcBase.approve(address(manager), depositAmount);
        manager.deposit(address(usdcBase), depositAmount, user);
        vm.stopPrank();

        vm.prank(admin);
        manager.setTokenStatus(address(usdcSol), PUSDManager.TokenStatus.EMERGENCY_REDEEM);

        uint256 redeemAmount = 50 * 10 ** 6;

        vm.prank(user);
        manager.redeem(redeemAmount, address(usdcSol), false, user);

        assertGt(usdcSol.balanceOf(user), 0, "Should be able to redeem emergency token as preferred");
    }

    function testSetTreasuryReserve() public {
        address treasuryReserve = address(0x123);

        vm.prank(admin);
        manager.setTreasuryReserve(treasuryReserve);

        assertEq(manager.treasuryReserve(), treasuryReserve);
    }

    function testSetBaseFee() public {
        vm.prank(admin);
        manager.setBaseFee(5); // 5 bps = 0.05%

        assertEq(manager.baseFee(), 5);
    }

    function testSetPreferredFeeRange() public {
        vm.prank(admin);
        manager.setPreferredFeeRange(5, 15); // 5-15 bps

        assertEq(manager.preferredFeeMin(), 5);
        assertEq(manager.preferredFeeMax(), 15);
    }

    function testPreferredRedemptionWithFees() public {
        address treasuryReserve = address(0x999);

        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.setTreasuryReserve(treasuryReserve);
        manager.setBaseFee(5); // 0.05%
        manager.setPreferredFeeRange(5, 15); // 0.05% - 0.15%
        vm.stopPrank();

        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);

        uint256 redeemAmount = 500 * 10 ** 6;
        manager.redeem(redeemAmount, address(usdtEth), false, user);
        vm.stopPrank();

        // Calculate expected fee (base + preferred)
        // With 100% liquidity in one token, preferred fee should be min (5 bps)
        // Total fee = 5 + 5 = 10 bps = 0.1%
        uint256 expectedFee = (redeemAmount * 10) / 10000;
        uint256 expectedUserAmount = redeemAmount - expectedFee;

        assertEq(usdtEth.balanceOf(user), expectedUserAmount, "User should receive amount minus fees");
        assertEq(usdtEth.balanceOf(treasuryReserve), 0, "Fees stay in contract before sweep");

        // Sweep to collect fees
        vm.prank(admin);
        manager.sweepAllSurplus();

        assertEq(usdtEth.balanceOf(treasuryReserve), expectedFee, "Treasury should receive fees after sweep");
    }

    function testBasketRedemptionWithOnlyBaseFee() public {
        address treasuryReserve = address(0x999);

        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.setTreasuryReserve(treasuryReserve);
        manager.setBaseFee(5); // 0.05%
        manager.setPreferredFeeRange(5, 15);
        vm.stopPrank();

        uint256 depositAmount = 500 * 10 ** 6;
        usdtEth.mint(user, depositAmount);
        usdcEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);

        usdcEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdcEth), depositAmount, user);

        uint256 redeemAmount = 500 * 10 ** 6;
        manager.redeem(redeemAmount, address(usdtBase), true, user); // Basket redemption
        vm.stopPrank();

        // Basket redemption should only charge base fee (5 bps)
        uint256 totalReceived = usdtEth.balanceOf(user) + usdcEth.balanceOf(user);

        // Total fees should be approximately 5 bps of redeemAmount
        uint256 expectedTotalFee = (redeemAmount * 5) / 10000;

        // Fees stay in contract before sweep
        assertEq(usdtEth.balanceOf(treasuryReserve), 0, "No fees in treasury before sweep");
        assertEq(usdcEth.balanceOf(treasuryReserve), 0, "No fees in treasury before sweep");

        // Sweep both tokens
        vm.prank(admin);
        manager.sweepAllSurplus();

        uint256 totalFees = usdtEth.balanceOf(treasuryReserve) + usdcEth.balanceOf(treasuryReserve);
        // Higher tolerance due to rounding in proportional distribution + fee calculations
        assertApproxEqAbs(totalReceived + totalFees, redeemAmount, 100000, "Total should equal redeem amount");
        // Sweep collects fees + rounding remainder, so tolerance is higher
        assertApproxEqAbs(totalFees, expectedTotalFee, 100000, "Fees should be approximately base fee only");
    }

    function testDynamicPreferredFeeCalculation() public {
        address treasuryReserve = address(0x999);

        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.setTreasuryReserve(treasuryReserve);
        manager.setBaseFee(5);
        manager.setPreferredFeeRange(5, 15); // Min 5 bps, Max 15 bps
        vm.stopPrank();

        // Create imbalanced liquidity: 900 USDT, 100 USDC
        usdtEth.mint(user, 900 * 10 ** 6);
        usdcEth.mint(user, 100 * 10 ** 6);

        vm.startPrank(user);
        usdtEth.approve(address(manager), 900 * 10 ** 6);
        manager.deposit(address(usdtEth), 900 * 10 ** 6, user);

        usdcEth.approve(address(manager), 100 * 10 ** 6);
        manager.deposit(address(usdcEth), 100 * 10 ** 6, user);
        vm.stopPrank();

        uint256 userBalanceBefore = usdtEth.balanceOf(user);

        // Redeem USDT (90% liquidity) - should have lower preferred fee (close to min)
        vm.prank(user);
        manager.redeem(100 * 10 ** 6, address(usdtEth), false, user);

        uint256 usdtReceived = usdtEth.balanceOf(user) - userBalanceBefore;
        uint256 usdtFee = 100 * 10 ** 6 - usdtReceived;

        userBalanceBefore = usdcEth.balanceOf(user);

        // Redeem USDC (10% liquidity) - should have higher preferred fee (max)
        vm.prank(user);
        manager.redeem(50 * 10 ** 6, address(usdcEth), false, user);

        uint256 usdcReceived = usdcEth.balanceOf(user) - userBalanceBefore;
        uint256 usdcFee = 50 * 10 ** 6 - usdcReceived;

        // USDC fee rate should be higher than USDT fee rate
        uint256 usdtFeeRate = (usdtFee * 10000) / 100e6;
        uint256 usdcFeeRate = (usdcFee * 10000) / 50e6;

        assertGt(usdcFeeRate, usdtFeeRate, "Low liquidity token should have higher fee");
    }

    function testFeesAccumulateWithoutTreasury() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.setBaseFee(5);
        manager.setPreferredFeeRange(5, 15);
        vm.stopPrank();

        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);

        uint256 redeemAmount = 500 * 10 ** 6;
        manager.redeem(redeemAmount, address(usdtEth), false, user);
        vm.stopPrank();

        // Fees are still deducted even without treasury set
        uint256 expectedFee = (redeemAmount * 10) / 10000; // base + preferred fee
        uint256 expectedUserAmount = redeemAmount - expectedFee;

        assertEq(usdtEth.balanceOf(user), expectedUserAmount, "User should receive amount minus fees");

        // Fees stay in contract (can't be swept without treasury)
        uint256 contractBalance = usdtEth.balanceOf(address(manager));
        assertGt(contractBalance, depositAmount - redeemAmount, "Fees should accumulate in contract");
    }

    function testSetSurplusHaircut() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.setSurplusHaircutBps(address(usdtEth), 500); // 5%
        vm.stopPrank();

        (bool exists,,, uint16 haircut,,) = manager.supportedTokens(address(usdtEth));
        assertTrue(exists);
        assertEq(haircut, 500);
    }

    function testSurplusHaircutTooHigh() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        vm.expectRevert("PUSDManager: haircut too high");
        manager.setSurplusHaircutBps(address(usdtEth), 4001); // > 40%
        vm.stopPrank();
    }

    function testDepositWithSurplusHaircut() public {
        address treasuryReserve = address(0x999);

        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.setTreasuryReserve(treasuryReserve);
        manager.setSurplusHaircutBps(address(usdtEth), 500); // 5% haircut
        vm.stopPrank();

        uint256 depositAmount = 1000 * 10 ** 6; // 1000 USDT
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);
        vm.stopPrank();

        // User should receive PUSD for 95% of tokens (950 USDT -> 950 PUSD)
        // All 1000 USDT stays in contract (surplus not transferred yet)
        uint256 expectedUserPusd = 950 * 10 ** 6;

        assertEq(pusd.balanceOf(user), expectedUserPusd, "User should receive PUSD for 95% of deposit");
        assertEq(usdtEth.balanceOf(address(manager)), depositAmount, "All tokens should be in contract");
        assertEq(usdtEth.balanceOf(treasuryReserve), 0, "Treasury should have nothing before sweep");
    }

    function testSweepSurplusWithHaircut() public {
        address treasuryReserve = address(0x999);

        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.setTreasuryReserve(treasuryReserve);
        manager.setSurplusHaircutBps(address(usdtEth), 500); // 5% haircut
        vm.stopPrank();

        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);
        vm.stopPrank();

        // Expected haircut: 5% of 1000 = 50
        uint256 expectedHaircut = 50 * 10 ** 6;

        // Verify accrued haircut is tracked
        assertEq(manager.getAccruedHaircut(address(usdtEth)), expectedHaircut, "Haircut should be accrued");
        assertEq(manager.getAccruedFees(address(usdtEth)), 0, "No fees yet");
        assertEq(manager.getAccruedSurplus(address(usdtEth)), expectedHaircut, "Total surplus equals haircut");

        // Sweep surplus to treasury
        vm.prank(admin);
        manager.sweepAllSurplus();

        // Treasury should now have the surplus
        assertEq(usdtEth.balanceOf(treasuryReserve), expectedHaircut, "Treasury should receive surplus after sweep");
        assertEq(usdtEth.balanceOf(address(manager)), 950 * 10 ** 6, "Contract should retain backing tokens");

        // Verify tracking updated
        assertEq(manager.getAccruedHaircut(address(usdtEth)), 0, "Accrued haircut reset after sweep");
        assertEq(manager.getSweptHaircut(address(usdtEth)), expectedHaircut, "Swept haircut tracked");
        assertEq(manager.getTotalSwept(address(usdtEth)), expectedHaircut, "Total swept equals haircut");
    }

    function testDepositWithZeroHaircutNoTreasuryRequired() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        // No haircut set (default 0)
        vm.stopPrank();

        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);
        vm.stopPrank();

        // With zero haircut, no surplus should be accrued
        assertEq(manager.getAccruedHaircut(address(usdtEth)), 0, "No haircut accrued");
        assertEq(manager.getAccruedSurplus(address(usdtEth)), 0, "No surplus to sweep");
        assertEq(usdtEth.balanceOf(address(manager)), depositAmount, "All tokens in contract as backing");
    }

    function testSweepAllSurplus() public {
        address treasuryReserve = address(0x999);

        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.setTreasuryReserve(treasuryReserve);
        manager.setSurplusHaircutBps(address(usdtEth), 500); // 5% haircut
        manager.setSurplusHaircutBps(address(usdcEth), 300); // 3% haircut
        manager.setBaseFee(5); // 0.05% base fee
        manager.setPreferredFeeRange(5, 15);
        vm.stopPrank();

        // Deposit USDT with haircut
        uint256 usdtDepositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, usdtDepositAmount);
        vm.startPrank(user);
        usdtEth.approve(address(manager), usdtDepositAmount);
        manager.deposit(address(usdtEth), usdtDepositAmount, user);
        vm.stopPrank();

        // Deposit USDC with haircut
        uint256 usdcDepositAmount = 500 * 10 ** 6;
        usdcEth.mint(user, usdcDepositAmount);
        vm.startPrank(user);
        usdcEth.approve(address(manager), usdcDepositAmount);
        manager.deposit(address(usdcEth), usdcDepositAmount, user);
        vm.stopPrank();

        // Redeem to generate fees
        vm.startPrank(user);
        manager.redeem(100 * 10 ** 6, address(usdtEth), false, user);
        vm.stopPrank();

        // Calculate expected amounts
        uint256 expectedUsdtHaircut = (usdtDepositAmount * 500) / 10000; // 50 USDT
        uint256 expectedUsdcHaircut = (usdcDepositAmount * 300) / 10000; // 15 USDC
        uint256 expectedUsdtFees = (100 * 10 ** 6 * 10) / 10000; // ~1 USDT (base + preferred fee)

        // Verify accrued amounts before sweep
        assertEq(manager.getAccruedHaircut(address(usdtEth)), expectedUsdtHaircut, "USDT haircut accrued");
        assertEq(manager.getAccruedHaircut(address(usdcEth)), expectedUsdcHaircut, "USDC haircut accrued");
        assertGt(manager.getAccruedFees(address(usdtEth)), 0, "USDT fees accrued");

        // Sweep all surplus in one transaction
        vm.prank(admin);
        manager.sweepAllSurplus();

        // Verify all surplus transferred to treasury
        assertGt(usdtEth.balanceOf(treasuryReserve), expectedUsdtHaircut, "USDT surplus in treasury");
        assertEq(usdcEth.balanceOf(treasuryReserve), expectedUsdcHaircut, "USDC surplus in treasury");

        // Verify accrued amounts reset
        assertEq(manager.getAccruedHaircut(address(usdtEth)), 0, "USDT haircut reset");
        assertEq(manager.getAccruedHaircut(address(usdcEth)), 0, "USDC haircut reset");
        assertEq(manager.getAccruedFees(address(usdtEth)), 0, "USDT fees reset");

        // Verify swept totals updated
        assertGt(manager.getSweptHaircut(address(usdtEth)), 0, "USDT swept haircut tracked");
        assertGt(manager.getSweptHaircut(address(usdcEth)), 0, "USDC swept haircut tracked");
        assertGt(manager.getSweptFees(address(usdtEth)), 0, "USDT swept fees tracked");
    }

    function testRedemptionUnaffectedByHaircut() public {
        address treasuryReserve = address(0x999);

        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.setTreasuryReserve(treasuryReserve);
        manager.setSurplusHaircutBps(address(usdtEth), 500); // 5% haircut on deposit
        vm.stopPrank();

        // Deposit with haircut: 1000 USDT -> all to contract, 950 backing PUSD + 50 surplus
        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);

        // User has 950 PUSD (from 950 USDT backing)
        uint256 userPusd = pusd.balanceOf(user);
        assertEq(userPusd, 950 * 10 ** 6);

        // Redeem should be 1:1 (no haircut on redemption)
        manager.redeem(userPusd, address(usdtEth), false, user);
        vm.stopPrank();

        // User should receive 950 USDT (1:1 redemption)
        assertEq(usdtEth.balanceOf(user), 950 * 10 ** 6, "Redemption should be 1:1, unaffected by deposit haircut");
    }

    function testRebalanceSuccess() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        vm.stopPrank();

        // User deposits to create liquidity
        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);
        usdcEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);

        usdcEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdcEth), depositAmount, user);
        vm.stopPrank();

        // Admin rebalances: swap 500 USDT for 500 USDC
        uint256 rebalanceAmount = 500 * 10 ** 6;
        usdtEth.mint(admin, rebalanceAmount);

        vm.startPrank(admin);
        usdtEth.approve(address(manager), rebalanceAmount);
        manager.rebalance(address(usdtEth), rebalanceAmount, address(usdcEth), rebalanceAmount);
        vm.stopPrank();

        // Verify balances
        assertEq(usdtEth.balanceOf(address(manager)), depositAmount + rebalanceAmount, "Manager should have more USDT");
        assertEq(usdcEth.balanceOf(address(manager)), depositAmount - rebalanceAmount, "Manager should have less USDC");
        assertEq(usdcEth.balanceOf(admin), rebalanceAmount, "Admin should receive USDC");
    }

    function testRebalanceProtectsSurplus() public {
        address treasuryReserve = address(0x999);

        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.setTreasuryReserve(treasuryReserve);
        manager.setSurplusHaircutBps(address(usdtEth), 500); // 5% haircut
        manager.setBaseFee(10); // 0.1% fee
        vm.stopPrank();

        // User deposits USDT with haircut
        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);
        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);
        vm.stopPrank();

        // User redeems to generate fees
        vm.startPrank(user);
        manager.redeem(100 * 10 ** 6, address(usdtEth), false, user);
        vm.stopPrank();

        // Check accrued surplus before rebalance
        uint256 accruedSurplus = manager.getAccruedSurplus(address(usdtEth));
        assertGt(accruedSurplus, 0, "Should have accrued surplus");

        // Calculate available balance for rebalance
        uint256 usdtBalance = usdtEth.balanceOf(address(manager));
        uint256 availableForRebalance = usdtBalance - accruedSurplus;

        // Admin rebalances with available amount (not touching surplus)
        usdcEth.mint(admin, availableForRebalance);

        vm.startPrank(admin);
        usdcEth.approve(address(manager), availableForRebalance);

        // Rebalance should succeed without touching surplus
        manager.rebalance(address(usdcEth), availableForRebalance, address(usdtEth), availableForRebalance);
        vm.stopPrank();

        // Verify surplus is still reserved in contract
        assertEq(manager.getAccruedSurplus(address(usdtEth)), accruedSurplus, "Surplus should still be reserved");
        assertEq(usdtEth.balanceOf(treasuryReserve), 0, "Treasury should not receive anything yet");

        // Verify rebalance succeeded
        assertEq(usdcEth.balanceOf(address(manager)), availableForRebalance, "USDC should be in contract");
        assertEq(usdtEth.balanceOf(admin), availableForRebalance, "Admin should receive available USDT");
    }

    function testRebalanceCannotSpendReservedSurplusWithoutTreasury() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.setSurplusHaircutBps(address(usdtEth), 500); // 5% haircut
        manager.setBaseFee(10); // 0.1% fee
        // Intentionally NOT setting treasury
        vm.stopPrank();

        // User deposits USDT with haircut
        uint256 depositAmount = 1000 * 10 ** 6;
        usdtEth.mint(user, depositAmount);
        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount, user);
        vm.stopPrank();

        // User redeems to generate fees
        vm.startPrank(user);
        manager.redeem(100 * 10 ** 6, address(usdtEth), false, user);
        vm.stopPrank();

        // Check accrued surplus (should still be in contract since no treasury)
        uint256 accruedSurplus = manager.getAccruedSurplus(address(usdtEth));
        assertGt(accruedSurplus, 0, "Should have accrued surplus");

        // Calculate available balance for rebalance
        uint256 usdtBalance = usdtEth.balanceOf(address(manager));
        uint256 availableForRebalance = usdtBalance - accruedSurplus;

        // Admin tries to rebalance more than available (would touch surplus)
        uint256 rebalanceAmount = availableForRebalance + 1; // 1 token more than available
        usdcEth.mint(admin, rebalanceAmount);

        vm.startPrank(admin);
        usdcEth.approve(address(manager), rebalanceAmount);

        // Should revert because it would spend reserved surplus
        vm.expectRevert("PUSDManager: rebalance would spend reserved surplus");
        manager.rebalance(address(usdcEth), rebalanceAmount, address(usdtEth), rebalanceAmount);
        vm.stopPrank();

        // Verify surplus is still intact
        assertEq(manager.getAccruedSurplus(address(usdtEth)), accruedSurplus, "Surplus should be unchanged");

        // Now try with exact available amount (should work)
        vm.startPrank(admin);
        manager.rebalance(address(usdcEth), availableForRebalance, address(usdtEth), availableForRebalance);
        vm.stopPrank();

        // Verify rebalance succeeded and surplus is still reserved
        assertEq(manager.getAccruedSurplus(address(usdtEth)), accruedSurplus, "Surplus should still be reserved");
        assertEq(usdtEth.balanceOf(admin), availableForRebalance, "Admin should receive only available amount");
    }

    function testRebalanceWithDifferentDecimals() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(dai), "DAI", "Ethereum_Sepolia", 18);
        vm.stopPrank();

        // User deposits
        usdtEth.mint(user, 1000 * 10 ** 6);
        dai.mint(user, 1000 * 10 ** 18);

        vm.startPrank(user);
        usdtEth.approve(address(manager), 1000 * 10 ** 6);
        manager.deposit(address(usdtEth), 1000 * 10 ** 6, user);

        dai.approve(address(manager), 1000 * 10 ** 18);
        manager.deposit(address(dai), 1000 * 10 ** 18, user);
        vm.stopPrank();

        // Admin rebalances: 500 USDT (6 decimals) for 500 DAI (18 decimals)
        usdtEth.mint(admin, 500 * 10 ** 6);

        vm.startPrank(admin);
        usdtEth.approve(address(manager), 500 * 10 ** 6);
        manager.rebalance(address(usdtEth), 500 * 10 ** 6, address(dai), 500 * 10 ** 18);
        vm.stopPrank();

        assertEq(dai.balanceOf(admin), 500 * 10 ** 18, "Admin should receive DAI");
    }

    function testRebalanceOnlyAdmin() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        vm.stopPrank();

        usdtEth.mint(user, 500 * 10 ** 6);

        vm.startPrank(user);
        usdtEth.approve(address(manager), 500 * 10 ** 6);
        vm.expectRevert();
        manager.rebalance(address(usdtEth), 500 * 10 ** 6, address(usdcEth), 500 * 10 ** 6);
        vm.stopPrank();
    }

    function testRebalanceSameToken() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        usdtEth.mint(admin, 500 * 10 ** 6);
        usdtEth.approve(address(manager), 500 * 10 ** 6);

        vm.expectRevert("PUSDManager: cannot swap same token");
        manager.rebalance(address(usdtEth), 500 * 10 ** 6, address(usdtEth), 500 * 10 ** 6);
        vm.stopPrank();
    }

    function testRebalanceUnequalValue() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        vm.stopPrank();

        usdtEth.mint(user, 1000 * 10 ** 6);
        vm.startPrank(user);
        usdtEth.approve(address(manager), 1000 * 10 ** 6);
        manager.deposit(address(usdtEth), 1000 * 10 ** 6, user);
        vm.stopPrank();

        usdcEth.mint(admin, 500 * 10 ** 6);

        vm.startPrank(admin);
        usdcEth.approve(address(manager), 500 * 10 ** 6);
        vm.expectRevert("PUSDManager: amounts must have equal PUSD value");
        manager.rebalance(address(usdcEth), 500 * 10 ** 6, address(usdtEth), 600 * 10 ** 6);
        vm.stopPrank();
    }

    function testRebalanceInsufficientBalance() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);

        usdtEth.mint(admin, 500 * 10 ** 6);
        usdtEth.approve(address(manager), 500 * 10 ** 6);

        vm.expectRevert("PUSDManager: rebalance would spend reserved surplus");
        manager.rebalance(address(usdtEth), 500 * 10 ** 6, address(usdcEth), 500 * 10 ** 6);
        vm.stopPrank();
    }

    function testRebalanceRemovedToken() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.setTokenStatus(address(usdcEth), PUSDManager.TokenStatus.REMOVED);

        usdtEth.mint(admin, 500 * 10 ** 6);
        usdtEth.approve(address(manager), 500 * 10 ** 6);

        vm.expectRevert("PUSDManager: tokenOut is removed");
        manager.rebalance(address(usdtEth), 500 * 10 ** 6, address(usdcEth), 500 * 10 ** 6);
        vm.stopPrank();
    }
}
